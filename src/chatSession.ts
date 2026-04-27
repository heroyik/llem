import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import type { ChatMessage, DisplayMessage, ChatHistoryItem } from './types';

interface SavedChatState {
    chatHistory: ChatMessage[];
    displayMessages: DisplayMessage[];
}

export class ChatSession {
    public chatHistory: ChatMessage[] = [];
    public displayMessages: DisplayMessage[] = [];
    public id: string;
    public title: string = 'New Thread';
    public lastModified: number = Date.now();

    constructor(
        private readonly ctx: vscode.ExtensionContext,
        private readonly getSystemPrompt: () => string
    ) {
        this.id = crypto.randomUUID();
        this.restore();
    }

    public restore(): void {
        const saved = this.ctx.workspaceState.get<SavedChatState & { id?: string, title?: string, lastModified?: number }>('chatState');
        if (saved && saved.chatHistory && saved.chatHistory.length > 1) {
            this.chatHistory = saved.chatHistory;
            this.displayMessages = saved.displayMessages || [];
            this.id = saved.id || crypto.randomUUID();
            this.title = saved.title || 'Restored Thread';
            this.lastModified = saved.lastModified || Date.now();
            return;
        }

        this.init();
    }

    public save(): void {
        this.lastModified = Date.now();
        this.ctx.workspaceState.update('chatState', {
            chatHistory: this.chatHistory,
            displayMessages: this.displayMessages,
            id: this.id,
            title: this.title,
            lastModified: this.lastModified
        });
    }

    public init(): void {
        this.chatHistory = [{ role: 'system', content: this.getSystemPrompt() }];
        this.displayMessages = [];
        this.id = crypto.randomUUID();
        this.title = 'New Thread';
        this.lastModified = Date.now();
    }

    public reset(): void {
        this.init();
        this.save();
    }

    public load(item: ChatHistoryItem): void {
        this.chatHistory = item.chatHistory || [];
        this.displayMessages = item.displayMessages || [];
        this.id = item.id;
        this.title = item.title;
        this.lastModified = item.lastModified || Date.now();
        this.save();
    }

    public appendAssistantMessage(message: string): void {
        this.chatHistory.push({ role: 'assistant', content: message });
        this.displayMessages.push({ role: 'ai', text: message });
        this.save();
    }

    public removeLastAssistantResponse(): void {
        if (this.chatHistory.length > 0 && this.chatHistory[this.chatHistory.length - 1].role === 'assistant') {
            this.chatHistory.pop();
        }
        if (this.displayMessages.length > 0 && this.displayMessages[this.displayMessages.length - 1].role === 'ai') {
            this.displayMessages.pop();
        }
    }

    public getHistoryText(): string {
        return this.displayMessages.map(m => `[${m.role.toUpperCase()}]\n${m.text}`).join('\n\n');
    }

    public async exportMarkdown(): Promise<void> {
        if (this.displayMessages.length === 0) {
            vscode.window.showWarningMessage('There is no thread to export yet.');
            return;
        }

        let md = `# LLeM - Thread Export\n\n_${new Date().toLocaleString('en-US')}_\n\n---\n\n`;
        for (const message of this.displayMessages) {
            const label = message.role === 'user' ? '**You**' : '**LLeM**';
            md += `### ${label}\n\n${message.text}\n\n---\n\n`;
        }

        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) {
            return;
        }

        const filePath = path.join(root, `chat-export-${Date.now()}.md`);
        await fs.promises.writeFile(filePath, md, 'utf-8');
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage(`Thread saved as ${path.basename(filePath)}.`);
    }

    /**
     * Controls what gets serialized by JSON.stringify.
     * Prevents serializing the VS Code ExtensionContext (ctx), which triggers the extensionRuntime error.
     */
    public toJSON() {
        return {
            id: this.id,
            title: this.title,
            chatHistory: this.chatHistory,
            displayMessages: this.displayMessages,
            lastModified: this.lastModified
        };
    }
}
