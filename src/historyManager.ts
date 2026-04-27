import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ChatHistoryItem, ChatHistoryMetadata } from './types';
import { logInfo, logError } from './logger';

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
        try {
            logInfo(`[HISTORY] saveSession: Starting save for session ID=${item.id}, Title="${item.title}"`);
            this.ensureStorageDir();
            const history = await this.listSessions();
            const existingIndex = history.findIndex(h => h.id === item.id);

            if (existingIndex >= 0) {
                logInfo(`[HISTORY] saveSession: Updating existing session metadata for ${item.id}`);
                history[existingIndex] = {
                    id: item.id,
                    title: item.title,
                    lastModified: item.lastModified
                };
            } else {
                logInfo(`[HISTORY] saveSession: Adding new session metadata for ${item.id}`);
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
                    logInfo(`[HISTORY] saveSession: Reached history limit, removing oldest session ${removed.id}`);
                    const sessionPath = path.join(this.SESSIONS_DIR, `${removed.id}.json`);
                    if (fs.existsSync(sessionPath)) {
                        await fs.promises.unlink(sessionPath);
                    }
                }
            }

            logInfo(`[HISTORY] saveSession: Writing metadata to ${this.METADATA_PATH}`);
            await fs.promises.writeFile(this.METADATA_PATH, JSON.stringify(history, null, 2));
            
            const sessionPath = path.join(this.SESSIONS_DIR, `${item.id}.json`);
            logInfo(`[HISTORY] saveSession: Writing session data to ${sessionPath}`);
            await fs.promises.writeFile(sessionPath, JSON.stringify(item, null, 2));
            logInfo(`[HISTORY] saveSession: Successfully saved session ${item.id}`);
        } catch (error) {
            logError(`[HISTORY] saveSession: Failed to save session ${item.id}`, error);
            // Re-throw to let the UI know, or handle gracefully depending on importance
            throw error;
        }
    }

    public async listSessions(): Promise<ChatHistoryMetadata[]> {
        if (!fs.existsSync(this.METADATA_PATH)) {
            return [];
        }
        try {
            const data = await fs.promises.readFile(this.METADATA_PATH, 'utf8');
            const history = JSON.parse(data) as ChatHistoryMetadata[];
            // Ensure all items have a valid timestamp
            return history.map(item => ({
                ...item,
                lastModified: item.lastModified || Date.now()
            }));
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
        try {
            logInfo(`[HISTORY] deleteSession: Starting deletion for session ID=${id}`);
            let history = await this.listSessions();
            const originalCount = history.length;
            history = history.filter(h => h.id !== id);
            
            if (history.length < originalCount) {
                logInfo(`[HISTORY] deleteSession: Updating metadata, removed ${id}`);
                await fs.promises.writeFile(this.METADATA_PATH, JSON.stringify(history, null, 2));
            }
            
            const sessionPath = path.join(this.SESSIONS_DIR, `${id}.json`);
            if (fs.existsSync(sessionPath)) {
                logInfo(`[HISTORY] deleteSession: Deleting file ${sessionPath}`);
                await fs.promises.unlink(sessionPath);
            }
            logInfo(`[HISTORY] deleteSession: Successfully deleted session ${id}`);
        } catch (error) {
            logError(`[HISTORY] deleteSession: Failed to delete session ${id}`, error);
            throw error;
        }
    }

    public async clearAll(): Promise<void> {
        if (fs.existsSync(this.STORAGE_ROOT)) {
            await fs.promises.rm(this.STORAGE_ROOT, { recursive: true, force: true });
        }
        this.ensureStorageDir();
    }
}
