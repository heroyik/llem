import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getLlemSettings, getVaultDir } from './config';
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
    if (files.length === 0) {
        return;
    }

    const vaultDir = getVaultDir();
    ensureDir(vaultDir);
    host.setBrainEnabled(true);

    const dateStr = safeDateFolderName();
    const dropPath = path.join(vaultDir, 'drops', dateStr);
    ensureDir(dropPath);

    const injectedTitles: string[] = [];
    host.postWebviewMessage({
        type: 'response',
        value: `📦 **[Vault drop queued]** ${files.length} file${files.length === 1 ? '' : 's'} just landed in \`drops/${dateStr}\`. LLeM is stashing them now.`
    });

    for (const file of files) {
        try {
            const fileContent = Buffer.from(file.data, 'base64').toString('utf-8');
            const safeTitle = sanitizeFileName(file.name, 'vault_drop');
            const filePath = path.join(dropPath, safeTitle);
            await fs.promises.writeFile(filePath, fileContent, 'utf-8');
            injectedTitles.push(safeTitle);
        } catch (err) {
            console.error('Failed to write vault file:', err);
        }
    }

    host.invalidateContextCaches({ brain: true });

    const safeTitles = injectedTitles.join(', ') || 'new drop';
    try {
        await queueBrainGitSync(vaultDir, `Vault drop: ${safeTitles}`);
        scheduleVaultDraftPrompt(host, vaultDir, dropPath, dateStr, injectedTitles, safeTitles, true);
    } catch {
        scheduleVaultDraftPrompt(host, vaultDir, dropPath, dateStr, injectedTitles, safeTitles, false);
    }
}

export async function handleBrainMenu(host: BrainCommandsHost): Promise<void> {
    const vaultDir = getVaultDir();
    ensureDir(vaultDir);

    const vaultFiles = host.getBrainFiles(vaultDir);
    const fileCount = vaultFiles.length;
    const currentRepo = getLlemSettings().get<string>('vaultRepo', '');
    const repoLabel = currentRepo ? currentRepo.split('/').pop() || currentRepo : 'No repo linked';

    const items = [
        { label: `Browse vault notes (${fileCount})`, description: 'Open markdown notes inside the vault', action: 'listFiles' },
        { label: 'Sync vault with GitHub', description: repoLabel, action: 'githubSync' },
        { label: 'Change vault folder', description: vaultDir, action: 'changeFolder' },
        { label: 'Open vault map', description: 'See how your notes cluster together', action: 'viewGraph' },
    ];

    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Vault tools' });
    if (!pick) {
        return;
    }

    switch (pick.action) {
        case 'listFiles':
            await showBrainFileList(vaultDir, vaultFiles, fileCount);
            break;
        case 'changeFolder':
            await changeBrainFolder(host);
            break;
        case 'viewGraph':
            vscode.commands.executeCommand('llem.showVaultMap');
            break;
        case 'githubSync':
            await syncVaultRepo(host);
            break;
    }
}

async function showBrainFileList(vaultDir: string, vaultFiles: string[], fileCount: number): Promise<void> {
    if (fileCount === 0) {
        const action = await vscode.window.showInformationMessage(
            'Your vault is empty right now. Drop in some markdown and it will show up here.',
            'Open Vault Folder'
        );
        if (action === 'Open Vault Folder') {
            ensureDir(vaultDir);
            vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(vaultDir));
        }
        return;
    }

    const fileItems = await Promise.all(vaultFiles.slice(0, 80).map(async file => {
        const rel = path.relative(vaultDir, file);
        const title = await readBrainFileTitle(file);
        return { label: rel, description: title, filePath: file };
    }));

    const selected = await vscode.window.showQuickPick(fileItems, {
        placeHolder: `Vault notes (${fileCount})`
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
        openLabel: 'Use this folder as the vault',
        title: 'Pick the folder LLeM should use for notes and drops'
    });
    if (!folders || folders.length === 0) {
        return;
    }

    const selectedPath = folders[0].fsPath;
    await getLlemSettings().update('vaultPath', selectedPath, vscode.ConfigurationTarget.Global);
    host.setBrainEnabled(true);
    host.invalidateContextCaches({ brain: true });

    const newFiles = host.findBrainFiles(selectedPath);
    vscode.window.showInformationMessage(`Vault folder updated. Found ${newFiles.length} note${newFiles.length === 1 ? '' : 's'}.`);
    host.postWebviewMessage({
        type: 'response',
        value: `📁 **[Vault connected]**\n${selectedPath}\n\nLLeM spotted ${newFiles.length} note${newFiles.length === 1 ? '' : 's'} and pulled them into context.`
    });
}

async function syncVaultRepo(host: BrainCommandsHost): Promise<void> {
    if (host.isSyncingBrain()) {
        vscode.window.showWarningMessage('Vault sync is already running. Give it a sec.');
        return;
    }

    let vaultRepo = getLlemSettings().get<string>('vaultRepo', '');
    if (!vaultRepo) {
        const inputUrl = await vscode.window.showInputBox({
            prompt: 'Paste the GitHub repo URL for your vault backup',
            placeHolder: 'https://github.com/you/your-vault'
        });
        if (!inputUrl) {
            return;
        }

        await getLlemSettings().update('vaultRepo', inputUrl, vscode.ConfigurationTarget.Global);
        vaultRepo = inputUrl;
    }

    host.setSyncingBrain(true);
    const vaultDir = getVaultDir();

    try {
        ensureDir(vaultDir);
        host.postWebviewMessage({
            type: 'response',
            value: '🔄 **[Vault sync in progress]** LLeM is lining up your local vault with GitHub.'
        });

        const gitDir = path.join(vaultDir, '.git');
        const remoteRepo = vaultRepo.trim();

        if (!fs.existsSync(gitDir)) {
            await runGit(vaultDir, ['init']);
        }

        await runGit(vaultDir, ['remote', 'remove', 'origin']).catch(() => {});
        await runGit(vaultDir, ['remote', 'add', 'origin', remoteRepo]);

        try {
            await runGit(vaultDir, ['add', '.']);
            await runGit(vaultDir, ['commit', '-m', 'Sync vault']).catch(() => {});

            try {
                await runGit(vaultDir, ['fetch', 'origin']);
                await runGit(vaultDir, ['pull', 'origin', 'main', '--no-edit', '--allow-unrelated-histories']).catch(async () => {
                    await runGit(vaultDir, ['pull', 'origin', 'master', '--no-edit', '--allow-unrelated-histories']);
                });
            } catch {
                // Ignore empty remote repos or pull failures and keep going.
            }

            await runGit(vaultDir, ['push', '-u', 'origin', 'main']).catch(async () => {
                await runGit(vaultDir, ['push', '-u', 'origin', 'master']).catch(() => {});
            });
        } catch (syncErr: any) {
            const msg = syncErr.message || '';
            if (msg.includes('Authentication') || msg.includes('403') || msg.includes('404')) {
                throw new Error('GitHub would not let LLeM in. Double-check the repo URL and access.');
            }
            console.warn('Vault sync warning:', syncErr);
        }

        host.setBrainEnabled(true);
        host.invalidateContextCaches({ brain: true });

        vscode.window.showInformationMessage('Vault sync complete. Local notes and GitHub are lined up.');
        host.postWebviewMessage({
            type: 'response',
            value: '✅ **[Vault sync complete]** Local notes and GitHub are now in step. LLeM can use the synced notes for richer answers.'
        });
    } catch (error: any) {
        const errMsg = error.message || '';
        let userMsg = errMsg;
        if (errMsg.includes('not found') || errMsg.includes('does not exist')) {
            userMsg = 'Could not find that GitHub repo. Check the URL and try again.';
        } else if (errMsg.includes('Authentication') || errMsg.includes('permission')) {
            userMsg = 'GitHub auth failed. Make sure the repo is reachable from this machine.';
        }

        vscode.window.showErrorMessage(`Vault sync failed: ${userMsg}`);
        host.postWebviewMessage({
            type: 'error',
            value: `⚠️ Vault sync failed: ${userMsg}\n\nTip: confirm the repo URL, permissions, and whether the repo exists yet.`
        });
    } finally {
        host.setSyncingBrain(false);
    }
}

function scheduleVaultDraftPrompt(
    host: BrainCommandsHost,
    vaultDir: string,
    dropPath: string,
    dateStr: string,
    injectedTitles: string[],
    safeTitles: string,
    pushed: boolean
): void {
    setTimeout(async () => {
        const combinedContent = await readInjectedContent(dropPath, injectedTitles);
        const syncStatus = pushed
            ? 'and already backed up to GitHub.'
            : 'and stored locally for now.';
        const uiMsg = pushed
            ? 'Fresh files just hit the vault and the backup landed too. Want me to spin them into clean notes?'
            : 'Fresh files just hit the local vault. Want me to spin them into clean notes?';

        host.pushChatMessage({
            role: 'system',
            content: buildVaultDraftPrompt(vaultDir, dateStr, safeTitles, combinedContent, syncStatus, pushed)
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
            .slice(0, 80) || '';
    } catch {
        return '';
    }
}

async function readInjectedContent(dropPath: string, injectedTitles: string[]): Promise<string> {
    let combinedContent = '';
    for (const title of injectedTitles) {
        try {
            const content = await fs.promises.readFile(path.join(dropPath, title), 'utf-8');
            combinedContent += `\n\n[RAW DROP: ${title}]\n\`\`\`\n${content.slice(0, 10000)}\n\`\`\``;
        } catch {
            // Ignore unreadable drop files.
        }
    }
    return combinedContent;
}

function buildVaultDraftPrompt(
    vaultDir: string,
    dateStr: string,
    safeTitles: string,
    combinedContent: string,
    syncStatus: string,
    pushed: boolean
): string {
    const completionLine = pushed ? ' After finishing, briefly report what you created.' : '';
    const notesRoot = path.join(vaultDir, 'notes');

    return `[LLeM vault mode]\nFresh raw material (${safeTitles}) just landed in the user's vault ${syncStatus}\n\nRaw content follows:${combinedContent}\n\nIf the user confirms, do not just summarize in chat. Use <create_file> to turn the material into polished markdown notes under \`${notesRoot}\`.\n\nRules for vault note creation:\n1. Split the material into clean topic-based notes.\n2. Create notes inside sensible folders under \`${notesRoot}\`.\n3. Use this markdown shape for every new note:\n---\nid: {{UUID}}\nsource: "drops/${dateStr}/${safeTitles}"\nupdated: ${dateStr}\ntags: [tag-one, tag-two]\n---\n# Note Title\n## Quick Take\n> one-line summary\n## Details\n- key points\n## Links\n- Related: [[another-note]]\n- Source: [[drops/${dateStr}/${safeTitles}]]\n\nWhen you are ready, create the note files directly with tags like \`<create_file path="${notesRoot}/folder/note.md">\` instead of only talking about them.${completionLine}`;
}
