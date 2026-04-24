import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ChatMessage, DisplayMessage } from './types';

interface SavedChatState {
    chat: ChatMessage[];
    display: DisplayMessage[];
}

export class ChatSession {
    public chatHistory: ChatMessage[] = [];
    public displayMessages: DisplayMessage[] = [];

    constructor(
        private readonly ctx: vscode.ExtensionContext,
        private readonly getSystemPrompt: () => string
    ) {
        this.restore();
    }

    public restore(): void {
        const saved = this.ctx.workspaceState.get<SavedChatState>('chatState');
        if (saved && saved.chat && saved.chat.length > 1) {
            this.chatHistory = saved.chat;
            this.displayMessages = saved.display || [];
            return;
        }

        this.init();
    }

    public save(): void {
        this.ctx.workspaceState.update('chatState', {
            chat: this.chatHistory,
            display: this.displayMessages
        });
    }

    public init(): void {
        this.chatHistory = [{ role: 'system', content: this.getSystemPrompt() }];
        this.displayMessages = [];
    }

    public reset(): void {
        this.init();
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
}
