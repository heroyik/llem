import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    BRAIN_FILES_CACHE_TTL_MS,
    EXCLUDED_DIRS,
    MAX_CONTEXT_SIZE,
    SECOND_BRAIN_CONTEXT_CACHE_TTL_MS,
    WORKSPACE_CONTEXT_CACHE_TTL_MS,
    getVaultDir,
    getConfig,
} from './config';
import { PerfLogger } from './perfLogger';
import type { BrainFilesCache, ChatMessage, TextContextCache } from './types';

function getInternetDirective(enabled?: boolean): string {
    if (!enabled) {
        return '';
    }

    return `\n\n[CRITICAL DIRECTIVE: INTERNET ACCESS IS ENABLED]\nCurrent Time: ${new Date().toLocaleString('ko-KR')}\nYou have FULL internet access via the <read_url> tool. You MUST NEVER say you cannot search, or that your capabilities are limited. To search, ALWAYS output:\n<read_url>https://html.duckduckgo.com/html/?q=YOUR+SEARCH+TERM</read_url>\nIf the user asks to search, or asks for recent info, DO NOT apologize. Just use the tag.`;
}

function getActiveEditorContext(): string {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
        return '';
    }

    const text = editor.document.getText();
    const name = path.basename(editor.document.fileName);
    if (text.trim().length === 0 || text.length >= MAX_CONTEXT_SIZE) {
        return '';
    }

    return `\n\n[Currently open file: ${name}]\n\`\`\`\n${text}\n\`\`\``;
}

export interface RequestMessageBuildOptions {
    chatHistory: ChatMessage[];
    systemPrompt: string;
    brainEnabled: boolean;
    internetEnabled?: boolean;
    backgroundLabel?: string;
}

export class ContextBuilder {
    private workspaceContextCache?: TextContextCache;
    private secondBrainContextCache?: TextContextCache;
    private brainFilesCache?: BrainFilesCache;

    public invalidate(scope: { workspace?: boolean; brain?: boolean } = { workspace: true, brain: true }): void {
        if (scope.workspace) {
            this.workspaceContextCache = undefined;
        }
        if (scope.brain) {
            this.secondBrainContextCache = undefined;
            this.brainFilesCache = undefined;
        }
    }

    public findBrainFiles(dir: string): string[] {
        let results: string[] = [];
        try {
            const list = fs.readdirSync(dir);
            for (const file of list) {
                const filePath = path.join(dir, file);
                const stat = fs.statSync(filePath);
                if (stat && stat.isDirectory()) {
                    if (file !== '.git' && file !== 'node_modules' && file !== '.obsidian') {
                        results = results.concat(this.findBrainFiles(filePath));
                    }
                } else if (file.endsWith('.md') || file.endsWith('.txt')) {
                    results.push(filePath);
                }
            }
        } catch {
            // skip unreadable dirs
        }
        return results;
    }

    public getBrainFiles(brainDir = getVaultDir()): string[] {
        const cacheKey = brainDir;
        const now = Date.now();
        if (this.brainFilesCache && this.brainFilesCache.key === cacheKey && this.brainFilesCache.expiresAt > now) {
            return this.brainFilesCache.files;
        }

        const files = fs.existsSync(brainDir) ? this.findBrainFiles(brainDir) : [];
        this.brainFilesCache = {
            key: cacheKey,
            files,
            expiresAt: now + BRAIN_FILES_CACHE_TTL_MS
        };
        return files;
    }

    public getBrainFileCount(): number {
        return this.getBrainFiles().length;
    }

    public getSecondBrainContext(): string {
        const brainDir = getVaultDir();
        const cacheKey = brainDir;
        const now = Date.now();
        if (this.secondBrainContextCache && this.secondBrainContextCache.key === cacheKey && this.secondBrainContextCache.expiresAt > now) {
            return this.secondBrainContextCache.value;
        }

        const value = this.buildSecondBrainContext(brainDir);
        this.secondBrainContextCache = {
            key: cacheKey,
            value,
            expiresAt: now + SECOND_BRAIN_CONTEXT_CACHE_TTL_MS
        };
        return value;
    }

    public readBrainFile(filename: string): string {
        const brainDir = getVaultDir();
        if (!fs.existsSync(brainDir)) {
            return '[ERROR] The vault is not ready yet. Open the vault menu first.';
        }

        const exactPath = path.join(brainDir, filename);
        if (fs.existsSync(exactPath)) {
            const content = fs.readFileSync(exactPath, 'utf-8');
            return content.slice(0, 8000);
        }

        const allFiles = this.getBrainFiles(brainDir);
        const match = allFiles.find(f =>
            path.basename(f) === filename ||
            path.basename(f) === filename + '.md' ||
            f.includes(filename)
        );

        if (match) {
            const content = fs.readFileSync(match, 'utf-8');
            return content.slice(0, 8000);
        }

        return `[NOT FOUND] Could not find "${filename}" in the vault. Check the vault index and try again.`;
    }

    public getWorkspaceContext(): string {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) { return ''; }

        const cacheKey = `${root}:${getConfig().maxTreeFiles}`;
        const now = Date.now();
        if (this.workspaceContextCache && this.workspaceContextCache.key === cacheKey && this.workspaceContextCache.expiresAt > now) {
            return this.workspaceContextCache.value;
        }

        const value = this.buildWorkspaceContext(root);
        this.workspaceContextCache = {
            key: cacheKey,
            value,
            expiresAt: now + WORKSPACE_CONTEXT_CACHE_TTL_MS
        };
        return value;
    }

    public buildRequestMessages(options: RequestMessageBuildOptions): ChatMessage[] {
        const start = performance.now();
        const reqMessages = [...options.chatHistory];
        if (reqMessages.length > 0 && reqMessages[0].role === 'system') {
            const backgroundLabel = options.backgroundLabel ?? 'BACKGROUND CONTEXT';
            reqMessages[0] = {
                role: 'system',
                content: `${options.systemPrompt}\n\n[${backgroundLabel}]\n${getActiveEditorContext()}\n${this.getWorkspaceContext()}\n\n[VAULT DIRECTORY]\n${getVaultDir()}\n\n${options.brainEnabled ? this.getSecondBrainContext() : ''}${getInternetDirective(options.internetEnabled)}`
            };
        }
        PerfLogger.update({ contextBuildMs: performance.now() - start });
        return reqMessages;
    }

    private buildSecondBrainContext(brainDir: string): string {
        const start = performance.now();
        if (!fs.existsSync(brainDir)) return '';

        const files = this.getBrainFiles(brainDir);
        PerfLogger.update({ vaultScanMs: performance.now() - start, vaultFileCount: files.length });
        if (files.length === 0) return '';

        const maxIndex = 200;
        const index: string[] = [];
        let truncated = false;

        for (let i = 0; i < files.length; i++) {
            if (i >= maxIndex) {
                truncated = true;
                break;
            }
            const file = files[i];
            const relativePath = path.relative(brainDir, file);
            try {
                const firstLine = fs.readFileSync(file, 'utf-8').split('\n').find(l => l.trim().length > 0) || '';
                const title = firstLine.replace(/^#+\s*/, '').slice(0, 80);
                index.push(`  📄 ${relativePath}  →  "${title}"`);
            } catch {
                index.push(`  📄 ${relativePath}`);
            }
        }

        const msgLimit = truncated ? `\n(Showing only the first ${maxIndex} files so the context does not blow up.)` : '';

        return `\n\n[CRITICAL: VAULT INDEX — User Notes (${files.length} documents)]\nThe user has a synced markdown vault. Below is the table of contents.${msgLimit}\nIf the request overlaps with anything in this index, read the relevant note before answering.\nTo read the full content of any note, use EXACTLY this syntax: <read_vault>filename_or_path</read_vault>\nYou can call <read_vault> multiple times. Always read the full note before answering.\n\n**IMPORTANT: When your answer uses knowledge from the vault, end your response with a "Sources" line listing the note files you used. Example:\nSources: product-roadmap.md, launch-notes.md**\n\n${index.join('\n')}\n\n`;
    }

    private buildWorkspaceContext(root: string): string {
        const { maxTreeFiles } = getConfig();
        const lines: string[] = [];
        let count = 0;

        const walk = (dir: string, prefix: string) => {
            if (count >= maxTreeFiles) { return; }
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                return;
            }

            entries.sort((a, b) => {
                if (a.isDirectory() && !b.isDirectory()) { return -1; }
                if (!a.isDirectory() && b.isDirectory()) { return 1; }
                return a.name.localeCompare(b.name);
            });

            for (const entry of entries) {
                if (count >= maxTreeFiles) { break; }
                if (EXCLUDED_DIRS.has(entry.name)) { continue; }
                if (entry.name.startsWith('.') && entry.isDirectory()) { continue; }

                if (entry.isDirectory()) {
                    lines.push(`${prefix}📁 ${entry.name}/`);
                    count++;
                    walk(path.join(dir, entry.name), prefix + '  ');
                } else {
                    lines.push(`${prefix}📄 ${entry.name}`);
                    count++;
                }
            }
        };
        walk(root, '');

        let result = '';
        if (lines.length > 0) {
            result += `\n\n[WORKSPACE INFO]\nPath: ${root}\n\n[PROJECT TREE]\n${lines.join('\n')}`;
        }

        const keyFiles = [
            'package.json', 'tsconfig.json', 'vite.config.ts', 'vite.config.js',
            'next.config.js', 'next.config.ts', 'README.md',
            'index.html', 'app.js', 'app.ts', 'main.ts', 'main.js',
            'src/index.ts', 'src/index.js', 'src/App.tsx', 'src/App.jsx',
            'src/main.ts', 'src/main.js'
        ];
        let totalRead = 0;
        const maxAutoRead = 6_000;

        for (const keyFile of keyFiles) {
            if (totalRead >= maxAutoRead) { break; }
            const abs = path.join(root, keyFile);
            if (fs.existsSync(abs)) {
                try {
                    const content = fs.readFileSync(abs, 'utf-8');
                    if (content.length < 5000) {
                        result += `\n\n[FILE CONTENT: ${keyFile}]\n\`\`\`\n${content}\n\`\`\``;
                        totalRead += content.length;
                    }
                } catch {
                    // skip unreadable key files
                }
            }
        }

        return result;
    }
}
