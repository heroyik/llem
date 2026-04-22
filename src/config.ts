import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ConnectAiConfig } from './types';

export const EXCLUDED_DIRS = new Set([
    'node_modules', '.git', '.vscode', 'out', 'dist', 'build',
    '.next', '.cache', '__pycache__', '.DS_Store', 'coverage',
    '.turbo', '.nuxt', '.output', 'vendor', 'target'
]);

export const MAX_CONTEXT_SIZE = 12_000;
export const WORKSPACE_CONTEXT_CACHE_TTL_MS = 30_000;
export const SECOND_BRAIN_CONTEXT_CACHE_TTL_MS = 60_000;
export const BRAIN_FILES_CACHE_TTL_MS = 60_000;

export function getConfig(): ConnectAiConfig {
    const cfg = vscode.workspace.getConfiguration('connectAiLab');
    return {
        ollamaBase: cfg.get<string>('ollamaUrl', 'http://127.0.0.1:11434'),
        defaultModel: cfg.get<string>('defaultModel', 'gemma4:e2b'),
        maxTreeFiles: 200,
        timeout: cfg.get<number>('requestTimeout', 300) * 1000,
        localBrainPath: cfg.get<string>('localBrainPath', '')
    };
}

export function getConnectAiSettings() {
    return vscode.workspace.getConfiguration('connectAiLab');
}

export function expandHome(filePath: string): string {
    return filePath.startsWith('~/')
        ? path.join(os.homedir(), filePath.substring(2))
        : filePath;
}

export function _getBrainDir(): string {
    const { localBrainPath } = getConfig();
    if (localBrainPath && localBrainPath.trim() !== '') {
        return expandHome(localBrainPath.trim());
    }
    return path.join(os.homedir(), '.connect-ai-brain');
}
