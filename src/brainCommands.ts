import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { _getBrainDir, getConnectAiSettings } from './config';
import { queueBrainGitSync } from './brainGitSync';
import { ensureDir, safeDateFolderName, sanitizeFileName } from './fsUtils';
import { runGit } from './gitUtils';
import type { ChatMessage } from './types';

interface BrainInjectFile {
    name: string;
    data: string;
}

export interface BrainCommandsHost {
    findBrainFiles(dir: string): string[];
    getBrainFiles(brainDir?: string): string[];
    injectSystemMessage(message: string): void;
    invalidateContextCaches(scope?: { workspace?: boolean; brain?: boolean }): void;
    isSyncingBrain(): boolean;
    postWebviewMessage(message: unknown): void;
    pushChatMessage(message: ChatMessage): void;
    setBrainEnabled(enabled: boolean): void;
    setSyncingBrain(value: boolean): void;
}

export async function handleInjectLocalBrain(files: BrainInjectFile[], host: BrainCommandsHost): Promise<void> {
    const brainDir = _getBrainDir();
    if (!fs.existsSync(brainDir)) {
        vscode.window.showErrorMessage('Second Brain이 연동되지 않았습니다. 채팅창 ⚙버튼이나 헤더에서 🧠버튼을 누른 후 깃허브 레포지토리를 먼저 연동해주세요.');
        return;
    }

    const dateStr = safeDateFolderName();
    const datePath = path.join(brainDir, '00_Raw', dateStr);
    ensureDir(datePath);

    const injectedTitles: string[] = [];

    host.postWebviewMessage({ type: 'response', value: `🧠 **[P-Reinforce 연동 준비]**\n첨부하신 ${files.length}개의 파일을 로컬 두뇌(\`00_Raw/${dateStr}\`)에 입수하고 자동 푸시를 진행합니다.` });

    for (const file of files) {
        try {
            const fileContent = Buffer.from(file.data, 'base64').toString('utf-8');
            const safeTitle = sanitizeFileName(file.name, 'brain_pack');
            const filePath = path.join(datePath, safeTitle);
            await fs.promises.writeFile(filePath, fileContent, 'utf-8');
            injectedTitles.push(safeTitle);
        } catch (err) {
            console.error('Failed to write brain file:', err);
        }
    }
    host.invalidateContextCaches({ brain: true });

    const safeTitles = injectedTitles.join(', ');

    try {
        await queueBrainGitSync(brainDir, `Auto-Inject Knowledge [Raw]: ${safeTitles}`);
        scheduleReinforcePrompt(host, brainDir, datePath, dateStr, injectedTitles, safeTitles, true);
    } catch {
        scheduleReinforcePrompt(host, brainDir, datePath, dateStr, injectedTitles, safeTitles, false);
    }
}

export async function handleBrainMenu(host: BrainCommandsHost): Promise<void> {
    const brainDir = _getBrainDir();
    const brainFiles = host.getBrainFiles(brainDir);
    const fileCount = brainFiles.length;

    const currentRepo = getConnectAiSettings().get<string>('secondBrainRepo', '');
    const repoLabel = currentRepo ? currentRepo.split('/').pop() : '없음';

    const items: any[] = [
        { label: `📂 내 지식 목록 (${fileCount}개)`, description: '클릭하면 파일 내용 열기', action: 'listFiles' },
        { label: '🔄 깃허브 동기화', description: `${repoLabel} — 로컬↔깃허브 양방향 최신화`, action: 'githubSync' },
        { label: '📁 폴더 위치 바꾸기', description: `현재: ${brainDir}`, action: 'changeFolder' },
        { label: '🌐 지식 지도', description: '내 지식의 연결 관계 시각화', action: 'viewGraph' },
    ];

    const pick = await vscode.window.showQuickPick(items, { placeHolder: '🧠 내 지식 관리' });
    if (!pick) return;

    switch (pick.action) {
        case 'listFiles':
            await showBrainFileList(brainDir, brainFiles, fileCount);
            break;
        case 'changeFolder':
            await changeBrainFolder(host);
            break;
        case 'resync':
            resyncBrainFolder(host, brainDir);
            break;
        case 'viewGraph':
            vscode.commands.executeCommand('connect-ai-lab.showBrainNetwork');
            break;
        case 'githubSync':
            await syncSecondBrain(host);
            break;
    }
}

async function showBrainFileList(brainDir: string, brainFiles: string[], fileCount: number): Promise<void> {
    if (fileCount === 0) {
        const action = await vscode.window.showInformationMessage(
            '📂 아직 지식이 없습니다. 뇌 폴더에 .md 파일을 넣어주세요!',
            '📁 뇌 폴더 열기'
        );
        if (action === '📁 뇌 폴더 열기') {
            ensureDir(brainDir);
            vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(brainDir));
        }
        return;
    }

    const fileItems = await Promise.all(brainFiles.slice(0, 50).map(async f => {
        const rel = path.relative(brainDir, f);
        const title = await readBrainFileTitle(f);
        return { label: `📄 ${rel}`, description: title, filePath: f };
    }));

    const selected = await vscode.window.showQuickPick(fileItems, {
        placeHolder: `📂 내 지식 파일 (총 ${fileCount}개) — 클릭하면 내용을 볼 수 있어요`
    });
    if (selected) {
        const doc = await vscode.workspace.openTextDocument(selected.filePath);
        vscode.window.showTextDocument(doc);
    }
}

async function changeBrainFolder(host: BrainCommandsHost): Promise<void> {
    const folders = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: '이 폴더를 내 뇌로 사용하기',
        title: '📁 AI에게 읽혀줄 지식(.md 파일)이 들어있는 폴더를 선택하세요'
    });
    if (!folders || folders.length === 0) {
        return;
    }

    const selectedPath = folders[0].fsPath;
    await getConnectAiSettings().update('localBrainPath', selectedPath, vscode.ConfigurationTarget.Global);
    host.setBrainEnabled(true);
    host.invalidateContextCaches({ brain: true });

    const newFiles = host.findBrainFiles(selectedPath);
    vscode.window.showInformationMessage(`✅ 뇌 폴더가 변경되었습니다! (${newFiles.length}개 지식 파일 발견)`);
    host.postWebviewMessage({ type: 'response', value: `🧠 **뇌 폴더 연결 완료!**\n📁 ${selectedPath}\n📄 ${newFiles.length}개의 지식 파일을 읽어들이고 있습니다.` });
}

function resyncBrainFolder(host: BrainCommandsHost, brainDir: string): void {
    host.setBrainEnabled(true);
    host.invalidateContextCaches({ brain: true });
    const refreshedFiles = host.findBrainFiles(brainDir);
    vscode.window.showInformationMessage(`🔄 지식 새로고침 완료! (${refreshedFiles.length}개 파일)`);
    host.postWebviewMessage({ type: 'response', value: `🔄 **지식 새로고침 완료!** ${refreshedFiles.length}개 파일이 연결되어 있습니다.\n\n지식 모드가 ON 되었습니다.` });
}

async function syncSecondBrain(host: BrainCommandsHost): Promise<void> {
    if (host.isSyncingBrain()) {
        vscode.window.showWarningMessage('동기화가 이미 진행 중입니다. 잠시만 기다려주세요!');
        return;
    }

    let secondBrainRepo = getConnectAiSettings().get<string>('secondBrainRepo', '');

    if (!secondBrainRepo) {
        const inputUrl = await vscode.window.showInputBox({
            prompt: '🧠 뇌를 연결할 깃허브 저장소 주소를 입력하세요',
            placeHolder: '예: https://github.com/사용자/레포지토리'
        });
        if (!inputUrl) { return; }

        await getConnectAiSettings().update('secondBrainRepo', inputUrl, vscode.ConfigurationTarget.Global);
        secondBrainRepo = inputUrl;
    }

    host.setSyncingBrain(true);
    const brainDir = _getBrainDir();
    try {
        host.postWebviewMessage({ type: 'response', value: '🔄 **지식 동기화 진행 중...** 내 지식 폴더와 깃허브를 가장 최신 상태로 조율하고 있습니다.' });
        ensureDir(brainDir);

        const gitDir = path.join(brainDir, '.git');
        const remoteRepo = secondBrainRepo.trim();

        if (!fs.existsSync(gitDir)) {
            await runGit(brainDir, ['init']);
        }

        await runGit(brainDir, ['remote', 'remove', 'origin']).catch(() => {});
        await runGit(brainDir, ['remote', 'add', 'origin', remoteRepo]);

        try {
            await runGit(brainDir, ['add', '.']);
            await runGit(brainDir, ['commit', '-m', 'Auto-sync local brain']).catch(() => {});

            try {
                await runGit(brainDir, ['fetch', 'origin']);
                await runGit(brainDir, ['pull', 'origin', 'main', '--no-edit', '--allow-unrelated-histories']).catch(async () => {
                    await runGit(brainDir, ['pull', 'origin', 'master', '--no-edit', '--allow-unrelated-histories']);
                });
            } catch {
                // 원격 저장소가 비어있거나 pull 실패 시 무시합니다.
            }

            await runGit(brainDir, ['push', '-u', 'origin', 'main']).catch(async () => {
                await runGit(brainDir, ['push', '-u', 'origin', 'master']).catch(() => {});
            });
        } catch (syncErr: any) {
            const msg = syncErr.message || '';
            if (msg.includes('Authentication') || msg.includes('403') || msg.includes('404')) {
                throw new Error('깃허브 저장소에 접근할 수 없습니다. URL 및 권한을 확인해주세요.');
            }
            console.warn('Sync warning:', syncErr);
        }

        host.setBrainEnabled(true);
        host.invalidateContextCaches({ brain: true });

        vscode.window.showInformationMessage('✅ 깃허브 지식과 내 지식 폴더가 완벽히 동기화(병합) 되었습니다!');
        host.postWebviewMessage({ type: 'response', value: '✅ **지식 동기화 완료!** 이제 내 PC의 폴더와 깃허브가 완벽하게 동일한 최신 상태가 되었습니다.\n\n지금부터 이 지식들을 바탕으로 맥락에 맞는 스마트한 답변을 제공합니다. (지식 모드: 🟢 ON)' });
    } catch (error: any) {
        const errMsg = error.message || '';
        let userMsg = errMsg;
        if (errMsg.includes('not found') || errMsg.includes('does not exist')) {
            userMsg = '깃허브 저장소를 찾을 수 없습니다. URL을 다시 확인해주세요.';
        } else if (errMsg.includes('Authentication') || errMsg.includes('permission')) {
            userMsg = '깃허브 인증에 실패했습니다. 저장소가 Public(공개)인지 확인해주세요.';
        }
        vscode.window.showErrorMessage(`Second Brain 동기화 실패: ${userMsg}`);
        host.postWebviewMessage({ type: 'error', value: `⚠️ 동기화 실패: ${userMsg}\n\n💡 **해결 방법:**\n1. 깃허브 저장소가 **Public(공개)** 상태인지 확인\n2. URL 형식: \`https://github.com/사용자이름/저장소이름\`\n3. 새로 만든 빈 저장소도 연결 가능합니다!` });
    } finally {
        host.setSyncingBrain(false);
    }
}

function scheduleReinforcePrompt(
    host: BrainCommandsHost,
    brainDir: string,
    datePath: string,
    dateStr: string,
    injectedTitles: string[],
    safeTitles: string,
    pushed: boolean
): void {
    setTimeout(async () => {
        const combinedContent = await readInjectedContent(datePath, injectedTitles);
        const syncStatus = pushed
            ? '글로벌 두뇌(Second Brain)에 입수 및 클라우드 백업 완료되었습니다.'
            : '글로벌 두뇌에 다운로드 되었습니다.(원격 푸시 보류됨)';
        const uiMsg = pushed
            ? '🧠 데이터가 완벽하게 입수되었습니다! 즉시 P-Reinforce 구조화를 시작할까요?'
            : '🧠 로컬 데이터가 입수되었습니다! 곧바로 P-Reinforce 구조화를 시작할까요?';

        host.pushChatMessage({
            role: 'system',
            content: buildReinforcePrompt(brainDir, dateStr, safeTitles, combinedContent, syncStatus, pushed)
        });
        host.injectSystemMessage(uiMsg);
    }, 3000);
}

async function readBrainFileTitle(filePath: string): Promise<string> {
    try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        return content
            .split('\n')
            .find(line => line.trim().length > 0)
            ?.replace(/^#+\s*/, '')
            .slice(0, 60) || '';
    } catch {
        return '';
    }
}

async function readInjectedContent(datePath: string, injectedTitles: string[]): Promise<string> {
    let combinedContent = '';
    for (const title of injectedTitles) {
        try {
            const content = await fs.promises.readFile(path.join(datePath, title), 'utf-8');
            combinedContent += `\n\n[원본 데이터: ${title}]\n\`\`\`\n${content.slice(0, 10000)}\n\`\`\``;
        } catch {}
    }
    return combinedContent;
}

function buildReinforcePrompt(
    brainDir: string,
    dateStr: string,
    safeTitles: string,
    combinedContent: string,
    syncStatus: string,
    pushed: boolean
): string {
    const completionLine = pushed ? ' 완료 후 잘라낸 결과를 보고하십시오.' : '';
    return `[A.U 시스템 지시: P-Reinforce Architect 모드 활성화]\n새로운 비정형 데이터('${safeTitles}')가 ${syncStatus}\n\n방금 입수된 데이터의 원본 내용은 아래와 같습니다:${combinedContent}\n\n여기서부터 중요합니다! 마스터가 ${pushed ? "'응'이나 '진행해' 등으로 " : ''}동의할 경우, 당신은 절대 대화만으로 대답하지 말고 아래의 [P-Reinforce 구조화 규격]에 따라 곧바로 <create_file> Tool들을 사용하십시오.\n\n[P-Reinforce 구조화 규격]\n1. 폴더 생성: 원본 데이터를 주제별로 쪼개어 절대 경로인 \`${brainDir}/10_Wiki/\` 하위의 적절한 폴더(예: 🛠️ Projects, 💡 Topics, ⚖️ Decisions, 🚀 Skills)에 저장하십시오.\n2. 마크다운 양식 준수: 생성되는 각 문서 파일은 반드시 아래 포맷을 따라야 합니다.\n---\nid: {{UUID}}\ncategory: "[[10_Wiki/설정한_폴더]]"\nconfidence_score: 0.9\ntags: [관련태그]\nlast_reinforced: ${dateStr}\n---\n# [[문서 제목]]\n## 📌 한 줄 통찰\n> (핵심 요약)\n## 📖 구조화된 지식\n- (세부 내용 불렛 포인트)\n## 🔗 지식 연결\n- Parent: [[상위_카테고리]]\n- Related: [[연관_개념]]\n- Raw Source: [[00_Raw/${dateStr}/${safeTitles}]]\n\n지시를 숙지했다면 묻지 말고 즉각 \`<create_file path="${brainDir}/10_Wiki/새폴더/새문서.md">\`를 사용하여 지식을 분해 후 생성하십시오.${completionLine}`;
}
