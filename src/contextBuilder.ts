import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    BRAIN_FILES_CACHE_TTL_MS,
    EXCLUDED_DIRS,
    MAX_CONTEXT_SIZE,
    SECOND_BRAIN_CONTEXT_CACHE_TTL_MS,
    WORKSPACE_CONTEXT_CACHE_TTL_MS,
    _getBrainDir,
    getConfig,
} from './config';
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

    public getBrainFiles(brainDir = _getBrainDir()): string[] {
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
        const brainDir = _getBrainDir();
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
        const brainDir = _getBrainDir();
        if (!fs.existsSync(brainDir)) {
            return '[ERROR] Second Brain이 동기화되지 않았습니다. 🧠 버튼을 먼저 눌러주세요.';
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

        return `[NOT FOUND] "${filename}" 파일을 Second Brain에서 찾을 수 없습니다. 목차(INDEX)를 다시 확인해주세요.`;
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
        const reqMessages = [...options.chatHistory];
        if (reqMessages.length > 0 && reqMessages[0].role === 'system') {
            const backgroundLabel = options.backgroundLabel ?? 'BACKGROUND CONTEXT';
            reqMessages[0] = {
                role: 'system',
                content: `${options.systemPrompt}\n\n[${backgroundLabel}]\n${getActiveEditorContext()}\n${this.getWorkspaceContext()}\n${options.brainEnabled ? this.getSecondBrainContext() : ''}${getInternetDirective(options.internetEnabled)}`
            };
        }
        return reqMessages;
    }

    private buildSecondBrainContext(brainDir: string): string {
        if (!fs.existsSync(brainDir)) return '';

        const files = this.getBrainFiles(brainDir);
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

        const msgLimit = truncated ? `\n(⚠️ 메모리 폭발 방지를 위해 상위 ${maxIndex}개 파일의 목차만 표시됩니다.)` : '';

        return `\n\n[CRITICAL: SECOND BRAIN INDEX — User's Personal Knowledge Base (${files.length} documents)]\nThe user has synced a personal knowledge repository. Below is the TABLE OF CONTENTS.${msgLimit}\nIf the user's query is even slightly related to any topics in this index, YOU MUST FIRST READ the relevant document BEFORE answering.\nTo read the actual content of any document, use EXACTLY this syntax: <read_brain>filename_or_path</read_brain>\nYou can call <read_brain> multiple times. ALWAYS READ THE FULL DOCUMENT BEFORE ANSWERING.\n\n**IMPORTANT: When your answer uses knowledge from the Second Brain, you MUST end your response with a "📚 출처" section listing the file(s) you referenced. Example:\n📚 출처: MrBeast_분석.md, 마케팅_전략.md**\n\n${index.join('\n')}\n\n`;
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
            result += `\n\n[WORKSPACE INFO]\n📂 경로: ${root}\n\n[프로젝트 파일 구조]\n${lines.join('\n')}`;
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
                        result += `\n\n[파일 내용: ${keyFile}]\n\`\`\`\n${content}\n\`\`\``;
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
