import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ChatHistoryItem, ChatHistoryMetadata } from './types';

export class HistoryManager {
    private readonly STORAGE_ROOT = path.join(os.homedir(), '.llem-history');
    private readonly METADATA_PATH = path.join(this.STORAGE_ROOT, 'metadata.json');
    private readonly SESSIONS_DIR = path.join(this.STORAGE_ROOT, 'sessions');

    constructor(private readonly ctx: vscode.ExtensionContext) {
        this.ensureStorageDir();
    }

    private ensureStorageDir(): void {
        if (!fs.existsSync(this.STORAGE_ROOT)) {
            fs.mkdirSync(this.STORAGE_ROOT, { recursive: true });
        }
        if (!fs.existsSync(this.SESSIONS_DIR)) {
            fs.mkdirSync(this.SESSIONS_DIR, { recursive: true });
        }
    }

    public async saveSession(item: ChatHistoryItem): Promise<void> {
        this.ensureStorageDir();
        const history = await this.listSessions();
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
                const sessionPath = path.join(this.SESSIONS_DIR, `${removed.id}.json`);
                if (fs.existsSync(sessionPath)) {
                    await fs.promises.unlink(sessionPath);
                }
            }
        }

        await fs.promises.writeFile(this.METADATA_PATH, JSON.stringify(history, null, 2));
        const sessionPath = path.join(this.SESSIONS_DIR, `${item.id}.json`);
        await fs.promises.writeFile(sessionPath, JSON.stringify(item, null, 2));
    }

    public async listSessions(): Promise<ChatHistoryMetadata[]> {
        if (!fs.existsSync(this.METADATA_PATH)) {
            return [];
        }
        try {
            const data = await fs.promises.readFile(this.METADATA_PATH, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Failed to read chat history metadata:', error);
            return [];
        }
    }

    public async getSession(id: string): Promise<ChatHistoryItem | undefined> {
        const sessionPath = path.join(this.SESSIONS_DIR, `${id}.json`);
        if (!fs.existsSync(sessionPath)) {
            return undefined;
        }
        try {
            const data = await fs.promises.readFile(sessionPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error(`Failed to read chat session ${id}:`, error);
            return undefined;
        }
    }

    public async deleteSession(id: string): Promise<void> {
        let history = await this.listSessions();
        history = history.filter(h => h.id !== id);
        
        await fs.promises.writeFile(this.METADATA_PATH, JSON.stringify(history, null, 2));
        
        const sessionPath = path.join(this.SESSIONS_DIR, `${id}.json`);
        if (fs.existsSync(sessionPath)) {
            await fs.promises.unlink(sessionPath);
        }
    }

    public async clearAll(): Promise<void> {
        if (fs.existsSync(this.STORAGE_ROOT)) {
            await fs.promises.rm(this.STORAGE_ROOT, { recursive: true, force: true });
        }
        this.ensureStorageDir();
    }
}
