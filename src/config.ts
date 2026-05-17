import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { LlemConfig, PerformancePreset } from './types';

export const EXCLUDED_DIRS = new Set([
    'node_modules', '.git', '.vscode', 'out', 'dist', 'build',
    '.next', '.cache', '__pycache__', '.DS_Store', 'coverage',
    '.turbo', '.nuxt', '.output', 'vendor', 'target'
]);

export const MAX_CONTEXT_SIZE = 12_000;
export const MAX_PROLOG_CONTEXT_SIZE = 12_000;
export const WORKSPACE_CONTEXT_CACHE_TTL_MS = 30_000;
export const SECOND_BRAIN_CONTEXT_CACHE_TTL_MS = 60_000;
export const BRAIN_FILES_CACHE_TTL_MS = 60_000;
export const MAX_BRAIN_FILES = 1000;

export function getConfig(): LlemConfig {
    const cfg = vscode.workspace.getConfiguration('llem');
    return {
        bridgeEnabled: cfg.get<boolean>('bridgeEnabled', false),
        bridgeToken: cfg.get<string>('bridgeToken', ''),
        ollamaBase: cfg.get<string>('engineUrl', 'http://127.0.0.1:11434'),
        defaultModel: cfg.get<string>('defaultModel', 'gemma4:e4b'),
        performancePreset: cfg.get<PerformancePreset>('performancePreset', 'auto'),
        maxTreeFiles: 200,
        timeout: cfg.get<number>('requestTimeout', 300) * 1000,
        vaultPath: cfg.get<string>('vaultPath', ''),
        mcpEnabled: cfg.get<boolean>('mcpEnabled', true),
        mcpToolTimeoutSeconds: cfg.get<number>('mcpToolTimeoutSeconds', 60)
    };
}

export function getLlemSettings() {
    return vscode.workspace.getConfiguration('llem');
}

export function expandHome(filePath: string): string {
    return filePath.startsWith('~/')
        ? path.join(os.homedir(), filePath.substring(2))
        : filePath;
}

export function getVaultDir(): string {
    const { vaultPath } = getConfig();
    if (vaultPath && vaultPath.trim() !== '') {
        return expandHome(vaultPath.trim());
    }
    return path.join(os.homedir(), '.llem-vault');
}

export function getLlemHomeDir(): string {
    return path.join(getUserHomeDir(), '.llem');
}

export function getPrologDir(): string {
    return path.join(getLlemHomeDir(), 'prolog');
}

export function getPrologDirs(): string[] {
    return [getPrologDir()];
}

function getUserHomeDir(): string {
    const envHome = process.env.HOME?.trim();
    if (envHome) {
        return expandHome(envHome);
    }
    return os.homedir();
}
