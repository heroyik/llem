import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getVaultDir } from './config';
import { safeResolveActionPath, SafePathResult } from './security';

export async function openDocument(uri: vscode.Uri): Promise<void> {
    if (uri.fsPath.toLowerCase().endsWith('.md')) {
        await vscode.commands.executeCommand('markdown.showPreview', uri);
        return;
    }
    await vscode.window.showTextDocument(uri, { preview: false });
}

export function safeDateFolderName(date = new Date()): string {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('-');
}

export function sanitizeFileName(value: string, fallback = 'untitled'): string {
    const sanitized = (value || fallback).replace(/[^a-zA-Z0-9가-힣_.-]/gi, '_');
    return sanitized || fallback;
}

export function ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

export async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.promises.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Resolves a requested path (relative or absolute) within the context of the LLeM application.
 * Handles redirection of "Vault/" prefix to the actual vault directory.
 */
export async function resolveLlemPath(workspaceRoot: string, requestedPath: string): Promise<SafePathResult> {
    const vaultRoot = getVaultDir();
    let finalPath = requestedPath;

    if (!path.isAbsolute(requestedPath)) {
        const normalized = requestedPath.replace(/\\/g, '/');
        if (normalized.toLowerCase().startsWith('vault/')) {
            const subPath = normalized.slice(6);
            finalPath = path.join(vaultRoot, subPath);
        }
    }

    return safeResolveActionPath(workspaceRoot, finalPath, {
        extraAllowedRoots: [vaultRoot],
        vaultRoot
    });
}
