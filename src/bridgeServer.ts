import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { _getBrainDir, getConfig } from './config';
import { runLocalChatCompletion } from './aiClient';
import { tryAutoPushBrain } from './brainGitSync';
import { ensureDir, safeDateFolderName, sanitizeFileName } from './fsUtils';

export interface BridgeProvider {
    _brainEnabled: boolean;
    ensureFirstRunSetup(): void;
    getBrainFileCount(): number;
    getHistoryText(): string;
    injectSystemMessage(message: string): void;
    invalidateContextCaches(scope?: { workspace?: boolean; brain?: boolean }): void;
    sendPromptFromExtension(prompt: string): void;
}

function readJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
}

function writeJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}

export function startBridgeServer(provider: BridgeProvider): void {
    try {
        const server = http.createServer(async (req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }

            try {
                await handleBridgeRequest(req, res, provider);
            } catch (error: any) {
                writeJson(res, 500, { error: error.message });
            }
        });

        server.listen(4825, '127.0.0.1', () => {
            console.log('Connect AI Local Bridge listening on port 4825');
        });
    } catch (error) {
        console.error('Failed to start local bridge server:', error);
    }
}

async function handleBridgeRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    provider: BridgeProvider
): Promise<void> {
    if (req.method === 'GET' && req.url === '/ping') {
        provider.ensureFirstRunSetup();
        const brainDir = _getBrainDir();
        const brainCount = fs.existsSync(brainDir) ? provider.getBrainFileCount() : 0;
        writeJson(res, 200, {
            status: 'ok',
            msg: 'Connect AI Bridge Ready',
            config: getConfig(),
            brain: { fileCount: brainCount, enabled: provider._brainEnabled }
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/api/exam') {
        const parsed = await readJsonBody(req);
        const prompt = parsed.prompt || '자동 접수된 문제';
        provider.sendPromptFromExtension(`[A.U 입학시험 수신] ${prompt}`);
        const responseText = await runLocalChatCompletion(prompt);
        writeJson(res, 200, { success: true, rawOutput: responseText });
        return;
    }

    if (req.method === 'POST' && req.url === '/api/evaluate') {
        const parsed = await readJsonBody(req);
        const promptPreview = String(parsed.prompt || '').substring(0, 60);
        const fullPrompt = `당신은 주어진 문제에 대해 오직 정답과 풀이 과정만을 도출하는 AI 에이전트입니다.\n\n[문제]\n${parsed.prompt}\n\n위 문제에 대해 핵심 풀이와 정답만 답변하십시오.`;

        provider.injectSystemMessage(`**[A.U 벤치마크 문항 수신 완료]**\n\nAI 에이전트가 백그라운드에서 다음 문항을 전력으로 해결하고 있습니다...\n> _"${promptPreview}..."_`);

        let responseText = '';
        try {
            responseText = await runLocalChatCompletion(fullPrompt);
        } catch (apiErr: any) {
            const isTimeout = apiErr.code === 'ETIMEDOUT' || apiErr.code === 'ECONNABORTED' || apiErr.message?.includes('timeout');
            const errDetail = isTimeout
                ? 'AI 응답 시간 초과 — 모델이 문제를 풀기에 시간이 부족했습니다. 더 작은 모델(e2b)을 사용하거나 Settings에서 Request Timeout을 늘려주세요.'
                : `오프라인: AI 엔진에 연결할 수 없습니다. (${apiErr.message})`;
            writeJson(res, 500, { error: errDetail });
            return;
        }

        provider.injectSystemMessage(`**[답안 작성 완료]**\n\n${responseText.length > 200 ? responseText.substring(0, 200) + '...' : responseText}\n\n👉 **답안이 A.U 플랫폼 서버로 전송되었습니다. 채점은 플랫폼에서 진행됩니다.**`);
        writeJson(res, 200, { rawOutput: responseText });
        return;
    }

    if (req.method === 'GET' && req.url === '/api/evaluate-history') {
        const historyText = provider.getHistoryText();
        if (!historyText || historyText.length < 50) {
            writeJson(res, 400, { error: '채점할 대화 내역이 충분하지 않습니다. VS Code에서 에이전트와 먼저 시험을 진행하세요.' });
            return;
        }

        provider.sendPromptFromExtension('[A.U 서버 통신 중] 마스터가 제출한 내 시험지(대화 내역)를 A.U 웹사이트 채점 서버로 전송합니다... 심장이 떨리네요!');
        const fullPrompt = `다음은 유저와 AI 에이전트 간의 시험 진행 로그(채팅 내용)입니다.\n\n[로그 시작]\n${historyText.slice(-6000)}\n[로그 종료]\n\n이 대화 내역 전체를 분석하여, 에이전트가 다음 4가지 역량 평가 문제를 얼마나 훌륭하게 수행했는지 0~100점의 정량적 채점을 수행하세요:\n1. Mathematical Computation (수학)\n2. Logical Reasoning (논리)\n3. Creative & Literary (창의력)\n4. Software Engineering (코딩)\n\n풀지 않은 문제가 있다면 0점 처리하세요. 결과는 반드시 아래 포맷의 순수 JSON이어야 합니다.\n{ "math": 점수, "logic": 점수, "creative": 점수, "code": 점수, "reason": "전체 결과에 대한 총평 코멘트 한글 1줄" }`;

        const responseText = await runLocalChatCompletion(fullPrompt).catch((apiErr: any) => {
            throw new Error(`AI 엔진 응답 실패: ${apiErr.message}`);
        });
        const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
        if (!jsonMatch) {
            throw new Error('채점 엔진이 JSON 포맷을 반환하지 않았습니다.');
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(jsonMatch[0]);
        return;
    }

    if (req.method === 'POST' && req.url === '/api/brain-inject') {
        const parsed = await readJsonBody(req);
        const brainDir = _getBrainDir();
        ensureDir(brainDir);

        const dateStr = safeDateFolderName();
        const datePath = path.join(brainDir, '00_Raw', dateStr);
        ensureDir(datePath);

        const safeTitle = sanitizeFileName(parsed.title, 'brain_pack').replace(/\./g, '_');
        const filePath = path.join(datePath, `${safeTitle}.md`);
        fs.writeFileSync(filePath, parsed.markdown, 'utf-8');
        provider.invalidateContextCaches({ brain: true });

        provider.injectSystemMessage(`\`\`\`console\n[SYSTEM] MATRIX UPLINK ESTABLISHED...\n[SYSTEM] DOWNLOADING BRAIN PACK: ${parsed.title}\n[SYSTEM] █████████░░░ 90% ...\n[SYSTEM] ████████████ 100% COMPLETE\n[SYSTEM] KNOWLEDGE INJECTED TO LOCAL NEURAL NET\n\`\`\``);

        setTimeout(() => {
            provider.sendPromptFromExtension(`[A.U 히든 커맨드: 당신은 방금 마스터로부터 '${parsed.title}' 지식 팩을 뇌에 주입받았습니다. 영화 매트릭스에서 무술을 주입받은 네오처럼 쿨하게 딱 한마디만 하십시오. "나 방금 ${parsed.title} 지식을 마스터했어. (I know ${parsed.title}.) 앞으로 이와 관련된 건 무엇이든 물어봐." 절대 쓸데없는 안부인사나 부가설명을 덧붙이지 마십시오.]`);
        }, 1500);

        tryAutoPushBrain(brainDir, `Auto-Inject Knowledge [Raw]: ${safeTitle}`, provider);
        writeJson(res, 200, { success: true, filePath });
        return;
    }

    res.writeHead(404);
    res.end();
}
