import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { getConfig, getVaultDir } from './config';
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
            console.log('LLeM Bridge listening on port 4825');
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
        const vaultDir = getVaultDir();
        const vaultCount = fs.existsSync(vaultDir) ? provider.getBrainFileCount() : 0;
        writeJson(res, 200, {
            status: 'ok',
            msg: 'LLeM Bridge Ready',
            config: getConfig(),
            vault: { fileCount: vaultCount, enabled: provider._brainEnabled }
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/api/exam') {
        const parsed = await readJsonBody(req);
        const prompt = parsed.prompt || 'Queued bridge task';
        provider.sendPromptFromExtension(`[Bridge task received] ${prompt}`);
        const responseText = await runLocalChatCompletion(prompt);
        writeJson(res, 200, { success: true, rawOutput: responseText });
        return;
    }

    if (req.method === 'POST' && req.url === '/api/evaluate') {
        const parsed = await readJsonBody(req);
        const promptPreview = String(parsed.prompt || '').substring(0, 60);
        const fullPrompt = `Solve the task below. Return only the answer and the reasoning that directly supports it.\n\n[TASK]\n${parsed.prompt}`;

        provider.injectSystemMessage(`**[Benchmark run started]**\n\nLLeM is working through this task in the background:\n> _"${promptPreview}..."_`);

        let responseText = '';
        try {
            responseText = await runLocalChatCompletion(fullPrompt);
        } catch (apiErr: any) {
            const isTimeout = apiErr.code === 'ETIMEDOUT' || apiErr.code === 'ECONNABORTED' || apiErr.message?.includes('timeout');
            const errDetail = isTimeout
                ? 'The model timed out before it could finish. Try a smaller model or raise Request Timeout in Settings.'
                : `Could not reach the local AI engine. (${apiErr.message})`;
            writeJson(res, 500, { error: errDetail });
            return;
        }

        provider.injectSystemMessage(`**[Benchmark run finished]**\n\n${responseText.length > 200 ? responseText.substring(0, 200) + '...' : responseText}`);
        writeJson(res, 200, { rawOutput: responseText });
        return;
    }

    if (req.method === 'GET' && req.url === '/api/evaluate-history') {
        const historyText = provider.getHistoryText();
        if (!historyText || historyText.length < 50) {
            writeJson(res, 400, { error: 'Not enough chat history to score yet. Run a few turns first.' });
            return;
        }

        provider.sendPromptFromExtension('[Bridge review in progress] Sending the latest thread to the local scoring flow.');
        const fullPrompt = `The text below is a chat transcript between a user and a coding assistant.\n\n[TRANSCRIPT START]\n${historyText.slice(-6000)}\n[TRANSCRIPT END]\n\nScore the assistant from 0 to 100 in these four areas:\n1. Mathematical Computation\n2. Logical Reasoning\n3. Creative & Literary Thinking\n4. Software Engineering\n\nIf an area was not demonstrated, score it 0.\nReturn pure JSON only in this shape:\n{ "math": 0, "logic": 0, "creative": 0, "code": 0, "reason": "one-line overall summary" }`;

        const responseText = await runLocalChatCompletion(fullPrompt).catch((apiErr: any) => {
            throw new Error(`AI engine request failed: ${apiErr.message}`);
        });
        const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
        if (!jsonMatch) {
            throw new Error('The scoring run did not return valid JSON.');
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(jsonMatch[0]);
        return;
    }

    if (req.method === 'POST' && (req.url === '/api/brain-inject' || req.url === '/api/vault-drop')) {
        const parsed = await readJsonBody(req);
        const vaultDir = getVaultDir();
        ensureDir(vaultDir);

        const dateStr = safeDateFolderName();
        const dropPath = path.join(vaultDir, 'drops', dateStr);
        ensureDir(dropPath);

        const safeTitle = sanitizeFileName(parsed.title, 'vault_drop').replace(/\./g, '_');
        const filePath = path.join(dropPath, `${safeTitle}.md`);
        fs.writeFileSync(filePath, parsed.markdown, 'utf-8');
        provider.invalidateContextCaches({ brain: true });

        provider.injectSystemMessage(`\`\`\`console\n[LLeM] Vault drop incoming...\n[LLeM] Saved pack: ${parsed.title}\n[LLeM] Path: drops/${dateStr}/${safeTitle}.md\n[LLeM] Status: synced into local context\n\`\`\``);

        setTimeout(() => {
            provider.sendPromptFromExtension(`[LLeM vault drop] You just absorbed a new knowledge pack called "${parsed.title}". Reply with exactly one confident sentence that says you have it in the vault and are ready for questions about it. No extra chatter.`);
        }, 1500);

        tryAutoPushBrain(vaultDir, `Vault drop: ${safeTitle}`, provider);
        writeJson(res, 200, { success: true, filePath });
        return;
    }

    res.writeHead(404);
    res.end();
}
