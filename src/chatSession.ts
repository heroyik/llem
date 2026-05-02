import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import type { ChatMessage, DisplayMessage, ChatHistoryItem } from './types';
import type { MessageFeedback } from './responsePreferenceManager';

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
            this.displayMessages = normalizeDisplayMessages(saved.displayMessages || []);
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
        this.displayMessages = normalizeDisplayMessages(item.displayMessages || []);
        this.id = item.id;
        this.title = item.title;
        this.lastModified = item.lastModified || Date.now();
        this.save();
    }

    public appendAssistantMessage(message: string): void {
        this.chatHistory.push({ role: 'assistant', content: message });
        this.displayMessages.push({ role: 'ai', text: message, feedback: null });
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

    public updateMessageFeedback(messageIndex: number, feedback: MessageFeedback | null): DisplayMessage | undefined {
        const message = this.displayMessages[messageIndex];
        if (!message) {
            return undefined;
        }

        message.feedback = feedback;
        this.save();
        return message;
    }

    public createBranchFromMessage(messageIndex: number): ChatHistoryItem | undefined {
        const branchMessages = normalizeDisplayMessages(this.displayMessages.slice(0, messageIndex + 1));
        if (branchMessages.length === 0) {
            return undefined;
        }

        const branchTitle = buildBranchTitle(this.title, branchMessages[branchMessages.length - 1]?.text || '');
        const branchHistory: ChatMessage[] = [{ role: 'system', content: this.getSystemPrompt() }];

        for (const message of branchMessages) {
            const role = message.role === 'user' ? 'user' : 'assistant';
            const content = role === 'user'
                ? buildUserContentFromDisplayMessage(message)
                : message.text;
            branchHistory.push({ role, content });
        }

        return {
            id: crypto.randomUUID(),
            title: branchTitle,
            lastModified: Date.now(),
            chatHistory: branchHistory,
            displayMessages: branchMessages
        };
    }

    public createBranchBeforeMessage(messageIndex: number, label?: string): ChatHistoryItem | undefined {
        if (!Number.isInteger(messageIndex) || messageIndex < 0) {
            return undefined;
        }

        const branchMessages = normalizeDisplayMessages(this.displayMessages.slice(0, messageIndex));
        const sourceMessage = this.displayMessages[messageIndex];
        const branchHistory: ChatMessage[] = [{ role: 'system', content: this.getSystemPrompt() }];

        for (const message of branchMessages) {
            const role = message.role === 'user' ? 'user' : 'assistant';
            const content = role === 'user'
                ? buildUserContentFromDisplayMessage(message)
                : message.text;
            branchHistory.push({ role, content });
        }

        return {
            id: crypto.randomUUID(),
            title: buildEditableBranchTitle(this.title, label || sourceMessage?.text || ''),
            lastModified: Date.now(),
            chatHistory: branchHistory,
            displayMessages: branchMessages
        };
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

function normalizeDisplayMessages(messages: DisplayMessage[]): DisplayMessage[] {
    return messages.map(message => ({
        ...message,
        feedback: message.feedback === 'like' || message.feedback === 'dislike' ? message.feedback : null
    }));
}

function buildUserContentFromDisplayMessage(message: DisplayMessage): string {
    const text = message.text || '';
    if (!message.files || message.files.length === 0) {
        return text;
    }

    const fileList = message.files.map(file => file.name).filter(Boolean).join(', ');
    return `${text}\n\n[Attached files in this branch context: ${fileList}]`.trim();
}

function buildBranchTitle(currentTitle: string, assistantText: string): string {
    const sourceTitle = (currentTitle || 'New Thread').trim();
    const preview = String(assistantText || '').replace(/\s+/g, ' ').trim().slice(0, 48);
    return preview ? `${sourceTitle} · Branch · ${preview}` : `${sourceTitle} · Branch`;
}

function buildEditableBranchTitle(currentTitle: string, messageText: string): string {
    const sourceTitle = (currentTitle || 'New Thread').trim();
    const preview = String(messageText || '').replace(/\s+/g, ' ').trim().slice(0, 48);
    return preview ? `${sourceTitle} · Edit · ${preview}` : `${sourceTitle} · Edit`;
}
