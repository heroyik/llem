import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { EXCLUDED_DIRS, _getBrainDir } from './config';
import { tryAutoPushBrain } from './brainGitSync';
import { openDocument, pathExists } from './fsUtils';
import type { ChatMessage } from './types';

export interface ActionExecutionHost {
    appendChatMessage(message: ChatMessage): void;
    getTerminal(): vscode.Terminal | undefined;
    injectSystemMessage(message: string): void;
    invalidateContextCaches(scope?: { workspace?: boolean; brain?: boolean }): void;
    setTerminal(terminal: vscode.Terminal): void;
}

export async function executeActions(aiMessage: string, host: ActionExecutionHost): Promise<string[]> {
    const report: string[] = [];
    let brainModified = false;
    let workspaceModified = false;
    let rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!rootPath && vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.scheme === 'file') {
        rootPath = path.dirname(vscode.window.activeTextEditor.document.uri.fsPath);
    }

    if (!rootPath) {
        const hasActions = /<(?:create_file|edit_file|run_command|delete_file|read_file|list_files|file)/i.test(aiMessage);
        if (hasActions) {
            report.push('❌ 폴더가 열려있지 않습니다. File → Open Folder로 폴더를 열거나 파일을 열어주세요.');
        }
        return report;
    }

    const createRegex = /<(?:create_file|file)\s+(?:path|file|name)=['"]?([^'">]+)['"]?[^>]*>([\s\S]*?)<\/(?:create_file|file)>/gi;
    let match: RegExpExecArray | null;
    let firstCreatedFile = '';

    while ((match = createRegex.exec(aiMessage)) !== null) {
        const relPath = match[1].trim();
        let content = match[2].trim();

        if (content.startsWith('```')) {
            const lines = content.split('\n');
            if (lines[0].startsWith('```')) lines.shift();
            if (lines.length > 0 && lines[lines.length - 1].startsWith('```')) lines.pop();
            content = lines.join('\n').trim();
        }

        try {
            const absPath = path.resolve(rootPath, relPath);
            const dir = path.dirname(absPath);
            await fs.promises.mkdir(dir, { recursive: true });
            await fs.promises.writeFile(absPath, content, 'utf-8');
            workspaceModified = true;
            if (absPath.startsWith(_getBrainDir())) brainModified = true;
            report.push(`✅ 생성: ${relPath}`);
            if (!firstCreatedFile) { firstCreatedFile = absPath; }
        } catch (err: any) {
            report.push(`❌ 생성 실패: ${relPath} — ${err.message}`);
        }
    }

    if (firstCreatedFile) {
        await openDocument(vscode.Uri.file(firstCreatedFile));
    }

    const editRegex = /<(?:edit_file|edit)\s+(?:path|file|name)=['"]?([^'">]+)['"]?[^>]*>([\s\S]*?)<\/(?:edit_file|edit)>/gi;
    while ((match = editRegex.exec(aiMessage)) !== null) {
        const relPath = match[1].trim();
        const body = match[2];
        const absPath = path.resolve(rootPath, relPath);

        if (!(await pathExists(absPath))) {
            report.push(`❌ 편집 실패: ${relPath} — 파일이 존재하지 않습니다.`);
            continue;
        }

        try {
            let fileContent = await fs.promises.readFile(absPath, 'utf-8');
            const findReplaceRegex = /<find>([\s\S]*?)<\/find>\s*<replace>([\s\S]*?)<\/replace>/g;
            let frMatch: RegExpExecArray | null;
            let editCount = 0;

            while ((frMatch = findReplaceRegex.exec(body)) !== null) {
                const findText = frMatch[1];
                const replaceText = frMatch[2];
                if (fileContent.includes(findText)) {
                    fileContent = fileContent.replace(findText, replaceText);
                    editCount++;
                } else {
                    report.push(`⚠️ ${relPath}: 일치하는 텍스트를 찾지 못했습니다.`);
                }
            }

            if (editCount > 0) {
                await fs.promises.writeFile(absPath, fileContent, 'utf-8');
                workspaceModified = true;
                if (absPath.startsWith(_getBrainDir())) brainModified = true;
                report.push(`✏️ 편집 완료: ${relPath} (${editCount}건 수정)`);
                await openDocument(vscode.Uri.file(absPath));
            }
        } catch (err: any) {
            report.push(`❌ 편집 실패: ${relPath} — ${err.message}`);
        }
    }

    const deleteRegex = /<(?:delete_file|delete)\s+(?:path|file|name)=['"]?([^'"\/\>]+)['"]?\s*\/?>(?:<\/(?:delete_file|delete)>)?/gi;
    while ((match = deleteRegex.exec(aiMessage)) !== null) {
        const relPath = match[1].trim();
        const absPath = path.resolve(rootPath, relPath);
        try {
            if (await pathExists(absPath)) {
                const stat = await fs.promises.stat(absPath);
                if (stat.isDirectory()) {
                    await fs.promises.rm(absPath, { recursive: true, force: true });
                } else {
                    await fs.promises.unlink(absPath);
                }
                workspaceModified = true;
                if (absPath.startsWith(_getBrainDir())) brainModified = true;
                report.push(`🗑️ 삭제: ${relPath}`);
            } else {
                report.push(`⚠️ 삭제 스킵: ${relPath} — 파일이 존재하지 않습니다.`);
            }
        } catch (err: any) {
            report.push(`❌ 삭제 실패: ${relPath} — ${err.message}`);
        }
    }

    const readRegex = /<(?:read_file|read)\s+(?:path|file|name)=['"]?([^'">]+)['"]?\s*\/?>(?:<\/(?:read_file|read)>)?/gi;
    while ((match = readRegex.exec(aiMessage)) !== null) {
        const relPath = match[1].trim();
        const absPath = path.resolve(rootPath, relPath);
        try {
            if (await pathExists(absPath)) {
                const content = await fs.promises.readFile(absPath, 'utf-8');
                const preview = content.slice(0, 500).split('\n').slice(0, 10).join('\n');
                report.push(`📖 읽기: ${relPath} (${content.length}자)\n\`\`\`\n${preview}...\n\`\`\``);
                host.appendChatMessage({ role: 'user', content: `[시스템: read_file 결과]\n파일: ${relPath}\n\`\`\`\n${content.slice(0, 10000)}\n\`\`\`` });
            } else {
                report.push(`⚠️ 읽기 실패: ${relPath} — 파일이 존재하지 않습니다.`);
            }
        } catch (err: any) {
            report.push(`❌ 읽기 실패: ${relPath} — ${err.message}`);
        }
    }

    const listRegex = /<(?:list_files|list_dir|ls)\s+(?:path|dir|name)=['"]?([^'"\/\>]*)['"]?\s*\/?>(?:<\/(?:list_files|list_dir|ls)>)?/gi;
    while ((match = listRegex.exec(aiMessage)) !== null) {
        const relDir = match[1].trim() || '.';
        const absDir = path.resolve(rootPath, relDir);
        try {
            const dirStat = await fs.promises.stat(absDir).catch(() => undefined);
            if (dirStat?.isDirectory()) {
                const entries = await fs.promises.readdir(absDir, { withFileTypes: true });
                const listing = entries
                    .filter(e => !e.name.startsWith('.') && !EXCLUDED_DIRS.has(e.name))
                    .map(e => e.isDirectory() ? `📁 ${e.name}/` : `📄 ${e.name}`)
                    .join('\n');
                report.push(`📂 목록: ${relDir}/\n\`\`\`\n${listing}\n\`\`\``);
                host.appendChatMessage({ role: 'user', content: `[시스템: list_files 결과]\n디렉토리: ${relDir}/\n${listing}` });
            } else {
                report.push(`⚠️ 목록 실패: ${relDir} — 디렉토리가 존재하지 않습니다.`);
            }
        } catch (err: any) {
            report.push(`❌ 목록 실패: ${relDir} — ${err.message}`);
        }
    }

    const cmdRegex = /<(?:run_command|command|bash|terminal)>([\s\S]*?)<\/(?:run_command|command|bash|terminal)>/gi;
    while ((match = cmdRegex.exec(aiMessage)) !== null) {
        let cmd = match[1].trim();
        if (cmd.startsWith('```')) {
            const lines = cmd.split('\n');
            if (lines[0].startsWith('```')) lines.shift();
            if (lines.length > 0 && lines[lines.length - 1].startsWith('```')) lines.pop();
            cmd = lines.join('\n').trim();
        }
        try {
            let terminal = host.getTerminal();
            if (!terminal || terminal.exitStatus !== undefined) {
                terminal = vscode.window.createTerminal({
                    name: '🚀 Connect AI',
                    cwd: rootPath
                });
                host.setTerminal(terminal);
            }
            terminal.show();
            terminal.sendText(cmd);
            report.push(`🖥️ 실행: ${cmd}`);
        } catch (err: any) {
            report.push(`❌ 명령 실패: ${cmd} — ${err.message}`);
        }
    }

    const urlRegex = /<(?:read_url|url|fetch_url)>([\s\S]*?)<\/(?:read_url|url|fetch_url)>/gi;
    while ((match = urlRegex.exec(aiMessage)) !== null) {
        const url = match[1].trim();
        try {
            const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, timeout: 10000 });
            const cleaned = data.toString()
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            const preview = cleaned.slice(0, 500);
            report.push(`🌐 웹사이트 읽기: ${url} (${cleaned.length}자)\n\`\`\`\n${preview}...\n\`\`\``);
            host.appendChatMessage({ role: 'user', content: `[시스템: read_url 결과]\nURL: ${url}\n\`\`\`\n${cleaned.slice(0, 15000)}\n\`\`\`` });
        } catch (err: any) {
            report.push(`❌ 웹사이트 접속 실패: ${url} — ${err.message}`);
            host.appendChatMessage({ role: 'user', content: `[시스템: read_url 실패]\n${err.message}` });
        }
    }

    if (report.length === 0) {
        const fallbackRegex = /```(?:[a-zA-Z]*)?\s*\n\/\/\s*(?:file|파일):\s*([^\n]+)\n([\s\S]*?)```/gi;
        while ((match = fallbackRegex.exec(aiMessage)) !== null) {
            const relPath = match[1].trim();
            const content = match[2].trim();
            if (relPath && content && relPath.includes('.')) {
                try {
                    const absPath = path.join(rootPath, relPath);
                    const dir = path.dirname(absPath);
                    await fs.promises.mkdir(dir, { recursive: true });
                    await fs.promises.writeFile(absPath, content, 'utf-8');
                    workspaceModified = true;
                    report.push(`✅ 생성(자동감지): ${relPath}`);
                    if (!firstCreatedFile) firstCreatedFile = absPath;
                } catch (err: any) {
                    report.push(`❌ 생성 실패: ${relPath} — ${err.message}`);
                }
            }
        }
        if (firstCreatedFile) {
            await openDocument(vscode.Uri.file(firstCreatedFile));
        }
    }

    const successCount = report.filter(r => r.startsWith('✅') || r.startsWith('✏️') || r.startsWith('🖥️') || r.startsWith('🗑️') || r.startsWith('📖') || r.startsWith('📂')).length;
    if (successCount > 0) {
        vscode.window.showInformationMessage(`Connect AI: ${successCount}개 에이전트 작업 완료!`);
    }

    if (brainModified) {
        tryAutoPushBrain(_getBrainDir(), '[P-Reinforce] Auto-synced structured knowledge', host);
        report.push(`☁️ **[GitHub Sync]** 글로벌 뇌(Second Brain) 백업을 백그라운드에서 시작했습니다.`);
    }

    if (workspaceModified || brainModified) {
        host.invalidateContextCaches({ workspace: workspaceModified, brain: brainModified });
    }

    return report;
}
