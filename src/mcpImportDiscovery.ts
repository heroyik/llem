import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface ImportableMcpSource {
    id: string;
    label: string;
    configPath: string;
}

const SOURCE_LABELS: Record<string, string> = {
    antigravity: 'Antigravity',
    vscode: 'VS Code',
    codex: 'Codex',
    'claude-code': 'Claude Code'
};

export function findImportableMcpSources(options: {
    configuredSources?: string[];
    dismissedSources?: string[];
    workspaceRoot?: string;
    homeDir?: string;
    env?: NodeJS.ProcessEnv;
}): ImportableMcpSource[] {
    const configured = new Set(options.configuredSources ?? []);
    const dismissed = new Set(options.dismissedSources ?? []);
    const homeDir = options.homeDir ?? os.homedir();
    const env = options.env ?? process.env;
    const candidates = [
        {
            id: 'antigravity',
            configPath: path.join(homeDir, '.gemini', 'antigravity', 'mcp_config.json')
        },
        {
            id: 'vscode',
            configPath: options.workspaceRoot ? path.join(options.workspaceRoot, '.vscode', 'mcp.json') : ''
        },
        {
            id: 'codex',
            configPath: path.join(env.CODEX_HOME || path.join(homeDir, '.codex'), 'config.toml')
        },
        {
            id: 'claude-code',
            configPath: path.join(homeDir, '.claude', 'settings.json')
        },
        {
            id: 'claude-code',
            configPath: path.join(homeDir, '.claude.json')
        }
    ];

    const found = new Map<string, ImportableMcpSource>();
    for (const candidate of candidates) {
        if (!candidate.configPath || configured.has(candidate.id) || dismissed.has(candidate.id)) {
            continue;
        }
        if (hasMcpConfig(candidate.configPath)) {
            found.set(candidate.id, {
                id: candidate.id,
                label: SOURCE_LABELS[candidate.id] ?? candidate.id,
                configPath: candidate.configPath
            });
        }
    }
    return [...found.values()];
}

function hasMcpConfig(filePath: string): boolean {
    if (!fs.existsSync(filePath)) {
        return false;
    }
    if (filePath.toLowerCase().endsWith('.toml')) {
        return /\[mcp_servers[.\]]/.test(readText(filePath));
    }
    const parsed = readJson(filePath);
    if (!parsed || typeof parsed !== 'object') {
        return false;
    }
    if (isRecord(parsed.mcpServers) && Object.keys(parsed.mcpServers).length > 0) {
        return true;
    }
    if (isRecord(parsed.projects)) {
        return Object.values(parsed.projects).some(project => isRecord(project) && isRecord(project.mcpServers) && Object.keys(project.mcpServers).length > 0);
    }
    return false;
}

function readText(filePath: string): string {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return '';
    }
}

function readJson(filePath: string): any | undefined {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return undefined;
    }
}

function isRecord(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
