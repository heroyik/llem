import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { parse as parseToml } from 'smol-toml';
import { expandHome, getLlemSettings } from './config';
import { readSyncedMcpServers } from './mcpStorage';
import type { McpConfigSnapshot, McpServerConfig, McpSourceKind, ResolvedMcpServerConfig } from './types';

export function getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function normalizeMcpServer(
    name: string,
    raw: unknown,
    sourceKind: McpSourceKind,
    sourcePath?: string
): ResolvedMcpServerConfig | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return undefined;
    }
    const record = raw as Record<string, unknown>;
    const command = readString(record.command);
    const explicitTransport = readString(record.transport) || readString(record.type);
    const url = readString(record.url) || readString(record.serverUrl);
    const transport = command && (!explicitTransport || explicitTransport === 'stdio') ? 'stdio' : 'unsupported';
    const args = readStringArray(record.args);
    const env = readStringRecord(record.env);
    const enabled = record.enabled === undefined ? true : record.enabled !== false;

    return {
        name,
        command,
        args,
        env,
        cwd: readString(record.cwd),
        timeout: readNumber(record.timeout),
        type: explicitTransport,
        transport,
        enabled,
        url,
        sourceKind,
        sourcePath,
        sourceServerName: name,
        syncedAt: readString(record.syncedAt)
    };
}

export async function resolveMcpConfig(): Promise<McpConfigSnapshot> {
    const errors: string[] = [];
    const servers: Record<string, ResolvedMcpServerConfig> = {};
    const workspaceRoot = getWorkspaceRoot();
    const sources = new Set(getLlemSettings().get<string[]>('mcpConfigSources', ['llem', 'workspace', 'codex-global', 'codex-project']));

    if (sources.has('codex-global') || sources.has('codex-project')) {
        mergeServers(servers, await readStoredSyncedServers(errors));
    }

    if (workspaceRoot && sources.has('workspace')) {
        const workspaceConfigPath = path.join(workspaceRoot, '.mcp.json');
        mergeServers(servers, await readJsonMcpConfig(workspaceConfigPath, 'workspace', errors));
    }

    for (const customPath of getLlemSettings().get<string[]>('mcpConfigPaths', [])) {
        const expanded = expandHome(customPath);
        if (expanded.endsWith('.toml')) {
            mergeServers(servers, await readCodexTomlConfig(expanded, 'custom', errors));
        } else {
            mergeServers(servers, await readJsonMcpConfig(expanded, 'custom', errors));
        }
    }

    if (sources.has('llem')) {
        mergeServers(servers, readSettingsServers('mcpServers', 'llem', errors, true));
    }
    markLocalShadows(servers);
    return { servers, errors };
}

export function readSettingsServers(
    key: 'mcpServers' | 'mcpSyncedServers',
    fallbackKind: McpSourceKind,
    errors: string[],
    preferSource = false
): Record<string, ResolvedMcpServerConfig> {
    const value = getLlemSettings().get<Record<string, unknown>>(key, {});
    const result: Record<string, ResolvedMcpServerConfig> = {};
    for (const [name, raw] of Object.entries(value || {})) {
        const sourceKind = preferSource ? (readString((raw as any)?.sourceKind) as McpSourceKind || fallbackKind) : fallbackKind;
        const normalized = normalizeMcpServer(name, raw, sourceKind, readString((raw as any)?.sourcePath));
        if (normalized) {
            result[name] = normalized;
        } else {
            errors.push(`Invalid MCP server config in ${key}.${name}`);
        }
    }
    return result;
}

export async function readStoredSyncedServers(errors: string[]): Promise<Record<string, ResolvedMcpServerConfig>> {
    try {
        const stored = await readSyncedMcpServers();
        if (Object.keys(stored).length > 0) {
            return stored;
        }
    } catch (err) {
        errors.push(`Failed to read LLeM MCP synced storage: ${err instanceof Error ? err.message : String(err)}`);
    }
    return readSettingsServers('mcpSyncedServers', 'codex', errors);
}

export async function readJsonMcpConfig(
    filePath: string,
    sourceKind: McpSourceKind,
    errors: string[]
): Promise<Record<string, ResolvedMcpServerConfig>> {
    if (!fs.existsSync(filePath)) {
        return {};
    }
    try {
        const parsed = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
        const rawServers = parsed.mcpServers || parsed.servers || parsed;
        return normalizeServerMap(rawServers, sourceKind, filePath, errors);
    } catch (err) {
        errors.push(`Failed to read MCP JSON ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
        return {};
    }
}

export async function readCodexTomlConfig(
    filePath: string,
    sourceKind: McpSourceKind,
    errors: string[]
): Promise<Record<string, ResolvedMcpServerConfig>> {
    if (!fs.existsSync(filePath)) {
        return {};
    }
    try {
        const parsed = parseToml(await fs.promises.readFile(filePath, 'utf8')) as Record<string, any>;
        return normalizeServerMap(parsed.mcp_servers || parsed.mcp?.servers || {}, sourceKind, filePath, errors);
    } catch (err) {
        errors.push(`Failed to read MCP TOML ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
        return {};
    }
}

export function getCodexConfigPaths(workspaceRoot = getWorkspaceRoot()): string[] {
    const paths: string[] = [];
    const codexHome = process.env.CODEX_HOME;
    if (codexHome) {
        paths.push(path.join(codexHome, 'config.toml'));
    }
    paths.push(path.join(os.homedir(), '.codex', 'config.toml'));
    if (workspaceRoot) {
        paths.push(path.join(workspaceRoot, '.codex', 'config.toml'));
    }
    return Array.from(new Set(paths.map(item => path.resolve(item))));
}

export async function readCodexConfigs(errors: string[], workspaceRoot = getWorkspaceRoot()): Promise<Record<string, ResolvedMcpServerConfig>> {
    const result: Record<string, ResolvedMcpServerConfig> = {};
    for (const configPath of getCodexConfigPaths(workspaceRoot)) {
        mergeServers(result, await readCodexTomlConfig(configPath, 'codex', errors));
    }
    return result;
}

export function toSettingsObject(servers: Record<string, ResolvedMcpServerConfig>): Record<string, McpServerConfig & Record<string, unknown>> {
    const out: Record<string, McpServerConfig & Record<string, unknown>> = {};
    for (const [name, server] of Object.entries(servers).sort(([a], [b]) => a.localeCompare(b))) {
        out[name] = {
            type: server.type,
            transport: server.transport,
            command: server.command,
            args: server.args,
            env: server.env,
            cwd: server.cwd,
            timeout: server.timeout,
            enabled: server.enabled,
            url: server.url,
            sourceKind: server.sourceKind,
            sourcePath: server.sourcePath,
            sourceServerName: server.sourceServerName,
            syncedAt: server.syncedAt
        };
    }
    return out;
}

function normalizeServerMap(rawServers: unknown, sourceKind: McpSourceKind, sourcePath: string, errors: string[]): Record<string, ResolvedMcpServerConfig> {
    const result: Record<string, ResolvedMcpServerConfig> = {};
    if (!rawServers || typeof rawServers !== 'object' || Array.isArray(rawServers)) {
        return result;
    }
    for (const [name, raw] of Object.entries(rawServers)) {
        const normalized = normalizeMcpServer(name, raw, sourceKind, sourcePath);
        if (normalized) {
            result[name] = normalized;
        } else {
            errors.push(`Invalid MCP server config in ${sourcePath}:${name}`);
        }
    }
    return result;
}

function mergeServers(target: Record<string, ResolvedMcpServerConfig>, source: Record<string, ResolvedMcpServerConfig>): void {
    for (const [name, server] of Object.entries(source)) {
        target[name] = server;
    }
}

function markLocalShadows(servers: Record<string, ResolvedMcpServerConfig>): void {
    const localNames = new Set(Object.values(servers).filter(server => server.sourceKind === 'llem').map(server => server.name));
    for (const server of Object.values(servers)) {
        if (server.sourceKind !== 'llem' && localNames.has(server.name)) {
            server.shadowedByLocal = true;
        }
    }
}

function readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? expandEnv(value.trim()) : undefined;
}

function readNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(item => String(item)) : [];
}

function readStringRecord(value: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return out;
    }
    for (const [key, raw] of Object.entries(value)) {
        if (raw === undefined || raw === null) {
            continue;
        }
        out[key] = expandEnv(String(raw));
    }
    return out;
}

function expandEnv(value: string): string {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => process.env[name] || '');
}
