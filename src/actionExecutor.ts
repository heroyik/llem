import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { EXCLUDED_DIRS, getVaultDir } from './config';
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
            report.push('❌ No workspace is open. Open a folder first so LLeM has somewhere to work.');
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
            if (absPath.startsWith(getVaultDir())) brainModified = true;
            report.push(`✅ Created: ${relPath}`);
            if (!firstCreatedFile) { firstCreatedFile = absPath; }
        } catch (err: any) {
            report.push(`❌ Create failed: ${relPath} — ${err.message}`);
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
            report.push(`❌ Edit failed: ${relPath} — file does not exist.`);
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
                    report.push(`⚠️ ${relPath}: could not find the target text.`);
                }
            }

            if (editCount > 0) {
                await fs.promises.writeFile(absPath, fileContent, 'utf-8');
                workspaceModified = true;
                if (absPath.startsWith(getVaultDir())) brainModified = true;
                report.push(`✏️ Edited: ${relPath} (${editCount} replacement${editCount === 1 ? '' : 's'})`);
                await openDocument(vscode.Uri.file(absPath));
            }
        } catch (err: any) {
            report.push(`❌ Edit failed: ${relPath} — ${err.message}`);
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
                if (absPath.startsWith(getVaultDir())) brainModified = true;
                report.push(`🗑️ Deleted: ${relPath}`);
            } else {
                report.push(`⚠️ Delete skipped: ${relPath} — file does not exist.`);
            }
        } catch (err: any) {
            report.push(`❌ Delete failed: ${relPath} — ${err.message}`);
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
                report.push(`📖 Read: ${relPath} (${content.length} chars)\n\`\`\`\n${preview}...\n\`\`\``);
                host.appendChatMessage({ role: 'user', content: `[SYSTEM: read_file result]\nFile: ${relPath}\n\`\`\`\n${content.slice(0, 10000)}\n\`\`\`` });
            } else {
                report.push(`⚠️ Read failed: ${relPath} — file does not exist.`);
            }
        } catch (err: any) {
            report.push(`❌ Read failed: ${relPath} — ${err.message}`);
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
                report.push(`📂 Listed: ${relDir}/\n\`\`\`\n${listing}\n\`\`\``);
                host.appendChatMessage({ role: 'user', content: `[SYSTEM: list_files result]\nDirectory: ${relDir}/\n${listing}` });
            } else {
                report.push(`⚠️ List failed: ${relDir} — directory does not exist.`);
            }
        } catch (err: any) {
            report.push(`❌ List failed: ${relDir} — ${err.message}`);
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
                    name: 'LLeM Console',
                    cwd: rootPath
                });
                host.setTerminal(terminal);
            }
            terminal.show();
            terminal.sendText(cmd);
            report.push(`🖥️ Ran: ${cmd}`);
        } catch (err: any) {
            report.push(`❌ Command failed: ${cmd} — ${err.message}`);
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
            report.push(`🌐 Read web: ${url} (${cleaned.length} chars)\n\`\`\`\n${preview}...\n\`\`\``);
            host.appendChatMessage({ role: 'user', content: `[SYSTEM: read_url result]\nURL: ${url}\n\`\`\`\n${cleaned.slice(0, 15000)}\n\`\`\`` });
        } catch (err: any) {
            report.push(`❌ Web read failed: ${url} — ${err.message}`);
            host.appendChatMessage({ role: 'user', content: `[SYSTEM: read_url failed]\n${err.message}` });
        }
    }

    if (report.length === 0) {
        const fallbackRegex = /```(?:[a-zA-Z]*)?\s*\n\/\/\s*(?:file|path):\s*([^\n]+)\n([\s\S]*?)```/gi;
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
                    report.push(`✅ Created (auto-detect): ${relPath}`);
                    if (!firstCreatedFile) firstCreatedFile = absPath;
                } catch (err: any) {
                    report.push(`❌ Create failed: ${relPath} — ${err.message}`);
                }
            }
        }
        if (firstCreatedFile) {
            await openDocument(vscode.Uri.file(firstCreatedFile));
        }
    }

    const successCount = report.filter(r => r.startsWith('✅') || r.startsWith('✏️') || r.startsWith('🖥️') || r.startsWith('🗑️') || r.startsWith('📖') || r.startsWith('📂')).length;
    if (successCount > 0) {
        vscode.window.showInformationMessage(`LLeM wrapped ${successCount} action${successCount === 1 ? '' : 's'}.`);
    }

    if (brainModified) {
        tryAutoPushBrain(getVaultDir(), 'Auto-sync vault updates', host);
        report.push('☁️ **[Vault Sync]** GitHub backup kicked off in the background.');
    }

    if (workspaceModified || brainModified) {
        host.invalidateContextCaches({ workspace: workspaceModified, brain: brainModified });
    }

    return report;
}
