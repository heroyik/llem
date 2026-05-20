import * as vscode from 'vscode';

export const MAX_DROPPED_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_DROPPED_TEXT_BYTES = 512 * 1024;

export const IMAGE_ATTACHMENT_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
export const AUDIO_ATTACHMENT_EXTENSIONS = new Set(['mp3', 'wav', 'ogg']);
export const TEXT_ATTACHMENT_EXTENSIONS = new Set([
    'txt', 'md', 'csv', 'json',
    'js', 'ts', 'html', 'css',
    'py', 'java', 'rs', 'go',
    'yaml', 'yml', 'xml', 'toml',
    // Code:
    'c', 'cpp', 'h', 'hpp', 'cxx', 'cc', 'hh',
    'rb', 'php', 'sh', 'bash', 'zsh', 'fish',
    'swift', 'kt', 'kts',
    'svelte', 'vue',
    'jsx', 'tsx', 'mjs', 'cjs',
    'scss', 'less', 'styl',
    'sql', 'proto',
    // Build/config:
    'gradle', 'cmake', 'makefile',
    'dockerfile',
    'env', 'gitignore', 'editorconfig', 'prettierrc', 'eslintrc',
    // Shell:
    'ps1', 'bat', 'cmd'
]);

export function cleanDroppedUriString(uriString: string): string {
    return String(uriString || '').trim().replace(/^["']|["']$/g, '');
}

export function parseDroppedUri(uriString: string): vscode.Uri {
    const rawUriString = cleanDroppedUriString(uriString);
    if (/^[a-zA-Z]:[\\/]/.test(rawUriString) || /^\\\\/.test(rawUriString)) {
        return vscode.Uri.file(rawUriString);
    }

    try {
        const uri = vscode.Uri.parse(rawUriString, true);
        if (!uri.scheme) {
            return vscode.Uri.file(rawUriString);
        }
        return uri;
    } catch (_error) {
        return vscode.Uri.file(rawUriString);
    }
}

export function droppedUriKey(uri: vscode.Uri): string {
    if (uri.scheme === 'file') {
        return `file:${uri.fsPath.toLowerCase()}`;
    }
    return uri.toString(true).toLowerCase();
}

export function basenameFromUri(uri: vscode.Uri): string {
    const pathName = uri.path.split('/').pop() || '';
    return pathName || 'file';
}

export function extensionFromName(name: string): string {
    const dotIndex = name.lastIndexOf('.');
    return dotIndex >= 0 ? name.slice(dotIndex + 1).toLowerCase() : '';
}

export function attachmentTypeFromName(name: string): string {
    const ext = extensionFromName(name);
    if (ext === 'jpg' || ext === 'jpeg') {
        return 'image/jpeg';
    }
    if (ext === 'svg') {
        return 'image/svg+xml';
    }
    if (['png', 'gif', 'webp'].includes(ext)) {
        return `image/${ext}`;
    }
    if (ext === 'mp3') {
        return 'audio/mpeg';
    }
    if (['wav', 'ogg'].includes(ext)) {
        return `audio/${ext}`;
    }
    return 'text/plain';
}

export function isSupportedDroppedAttachment(name: string): boolean {
    const ext = extensionFromName(name);
    return IMAGE_ATTACHMENT_EXTENSIONS.has(ext) ||
        AUDIO_ATTACHMENT_EXTENSIONS.has(ext) ||
        TEXT_ATTACHMENT_EXTENSIONS.has(ext);
}

export function droppedAttachmentLimit(type: string): number {
    return type.startsWith('image/') ? MAX_DROPPED_IMAGE_BYTES : MAX_DROPPED_TEXT_BYTES;
}

export function summarizeDropError(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
    }
    return String(error);
}

export function isSafeAttachmentLookupName(name: string): boolean {
    return Boolean(name) &&
        !/[{}[\]*?]/.test(name);
}
