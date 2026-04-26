import * as vscode from 'vscode';
import type { ChatHistoryItem, ChatHistoryMetadata } from './types';

export class HistoryManager {
    private readonly STORAGE_KEY = 'llem.chatHistory';

    constructor(private readonly ctx: vscode.ExtensionContext) {}

    public async saveSession(item: ChatHistoryItem): Promise<void> {
        const history = this.getHistoryMetadata();
        const existingIndex = history.findIndex(h => h.id === item.id);

        if (existingIndex >= 0) {
            history[existingIndex] = {
                id: item.id,
                title: item.title,
                lastModified: item.lastModified
            };
        } else {
            history.unshift({
                id: item.id,
                title: item.title,
                lastModified: item.lastModified
            });
        }

        // Limit history to 100 items for performance
        if (history.length > 100) {
            const removed = history.pop();
            if (removed) {
                await this.ctx.globalState.update(`llem.chat.${removed.id}`, undefined);
            }
        }

        await this.ctx.globalState.update(this.STORAGE_KEY, history);
        await this.ctx.globalState.update(`llem.chat.${item.id}`, item);
    }

    public getHistoryMetadata(): ChatHistoryMetadata[] {
        return this.ctx.globalState.get<ChatHistoryMetadata[]>(this.STORAGE_KEY, []);
    }

    public async getSession(id: string): Promise<ChatHistoryItem | undefined> {
        return this.ctx.globalState.get<ChatHistoryItem>(`llem.chat.${id}`);
    }

    public async deleteSession(id: string): Promise<void> {
        let history = this.getHistoryMetadata();
        history = history.filter(h => h.id !== id);
        await this.ctx.globalState.update(this.STORAGE_KEY, history);
        await this.ctx.globalState.update(`llem.chat.${id}`, undefined);
    }

    public async clearAll(): Promise<void> {
        const history = this.getHistoryMetadata();
        for (const item of history) {
            await this.ctx.globalState.update(`llem.chat.${item.id}`, undefined);
        }
        await this.ctx.globalState.update(this.STORAGE_KEY, undefined);
    }
}
