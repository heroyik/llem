const EDITABLE_FILE_EXTENSIONS = new Set([
    '.txt', '.md', '.csv', '.json',
    '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
    '.html', '.css', '.scss', '.less',
    '.py', '.java', '.rs', '.go',
    '.cpp', '.c', '.h', '.hpp', '.cs',
    '.yaml', '.yml', '.xml', '.toml',
    '.env', '.sh', '.bat', '.ps1',
    '.rb', '.php', '.swift', '.kt', '.sql',
    '.vue', '.svelte'
]);

const EDITABLE_BASENAMES = new Set([
    '.gitignore',
    '.gitattributes',
    'Dockerfile',
    'Makefile'
]);

export function normalizeWorkspaceFilePath(filePath: string): string {
    let normalized = String(filePath || '').trim().replace(/\\/g, '/');
    if (normalized.startsWith('./')) {
        normalized = normalized.slice(2);
    }
    return normalized;
}

export function isEditableFilePath(filePath: string): boolean {
    const normalized = normalizeWorkspaceFilePath(filePath);
    if (!normalized || normalized.includes('\n')) {
        return false;
    }

    const segments = normalized.split('/');
    const baseName = segments[segments.length - 1] || '';
    if (EDITABLE_BASENAMES.has(baseName)) {
        return true;
    }

    const dotIndex = baseName.lastIndexOf('.');
    const ext = dotIndex >= 0 ? baseName.slice(dotIndex).toLowerCase() : '';
    return EDITABLE_FILE_EXTENSIONS.has(ext);
}
