import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import toml from 'smol-toml';
import type { McpResolvedServer, McpServerConfig, McpServersConfig } from './types';

export interface McpConfigLoadOptions {
    workspaceRoot?: string;
    llemServers?: McpServersConfig;
    sources?: string[];
    extraPaths?: string[];
    env?: NodeJS.ProcessEnv;
    homeDir?: string;
}

export interface McpConfigLoadResult {
    servers: McpResolvedServer[];
    warnings: string[];
}

interface SourceConfig {
    label: string;
    priority: number;
    servers: McpServersConfig;
}

const DEFAULT_SOURCES = ['workspace', 'claude-code', 'codex', 'antigravity'];

export function loadMcpServers(options: McpConfigLoadOptions = {}): McpConfigLoadResult {
    const env = options.env ?? process.env;
    const homeDir = options.homeDir ?? os.homedir();
    const sources = new Set(options.sources && options.sources.length > 0 ? options.sources : DEFAULT_SOURCES);
    const warnings: string[] = [];
    const configs: SourceConfig[] = [];

    const pushConfig = (label: string, priority: number, servers: McpServersConfig | undefined) => {
        if (servers && Object.keys(servers).length > 0) {
            configs.push({ label, priority, servers });
        }
    };

    for (const configuredPath of options.extraPaths ?? []) {
        const expanded = expandHomeAndEnv(configuredPath, env, homeDir);
        const loaded = readMcpConfigFile(expanded, 'custom', env, warnings);
        pushConfig(`custom:${expanded}`, 10, loaded);
    }

    if (sources.has('antigravity')) {
        for (const configuredPath of options.extraPaths ?? []) {
            const expanded = expandHomeAndEnv(configuredPath, env, homeDir);
            const loaded = readMcpConfigFile(expanded, 'antigravity', env, warnings);
            pushConfig(`antigravity:${expanded}`, 20, loaded);
        }
    }

    if (sources.has('claude-code')) {
        pushConfig('claude-code:user-settings', 30, readJsonMcpServers(path.join(homeDir, '.claude', 'settings.json'), env, warnings));
        pushConfig('claude-code:local-project', 35, readClaudeJsonProjectServers(path.join(homeDir, '.claude.json'), options.workspaceRoot, env, warnings));
    }

    if (sources.has('codex')) {
        const codexHome = env.CODEX_HOME ? expandHomeAndEnv(env.CODEX_HOME, env, homeDir) : path.join(homeDir, '.codex');
        pushConfig('codex:user', 40, readCodexTomlServers(path.join(codexHome, 'config.toml'), env, warnings));
    }

    if (sources.has('workspace') && options.workspaceRoot) {
        pushConfig('workspace:.mcp.json', 50, readJsonMcpServers(path.join(options.workspaceRoot, '.mcp.json'), env, warnings));
        pushConfig('workspace:.codex/config.toml', 45, readCodexTomlServers(path.join(options.workspaceRoot, '.codex', 'config.toml'), env, warnings));
    }

    pushConfig('llem:settings', 100, normalizeServerMap(options.llemServers ?? {}, 'llem:settings', env));

    const byName = new Map<string, McpResolvedServer>();
    for (const cfg of configs.sort((a, b) => a.priority - b.priority)) {
        for (const [name, server] of Object.entries(cfg.servers)) {
            const normalized = normalizeServerConfig(server, cfg.label, env);
            const transport = resolveTransport(normalized);
            byName.set(name, {
                name,
                config: normalized,
                source: cfg.label,
                transport,
                supported: transport === 'stdio',
                disabled: normalized.disabled === true || normalized.enabled === false,
                warning: transport === 'stdio' ? undefined : `MCP transport '${transport}' is configured but not supported yet.`
            });
        }
    }

    return { servers: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)), warnings };
}

export function readCodexTomlServers(filePath: string, env: NodeJS.ProcessEnv = process.env, warnings: string[] = []): McpServersConfig {
    const parsed = readTomlFile(filePath, warnings);
    const table = parsed?.mcp_servers;
    if (!isRecord(table)) {
        return {};
    }

    const servers: McpServersConfig = {};
    for (const [name, raw] of Object.entries(table)) {
        if (!isRecord(raw)) {
            continue;
        }
        const transport = isRecord(raw.transport) ? raw.transport : raw;
        const type = stringValue(raw.type) || stringValue(raw.transport_type) || stringValue(transport.type) || inferCodexTransport(transport);
        servers[name] = normalizeServerConfig({
            type,
            command: stringValue(transport.command) || stringValue(raw.command),
            args: stringArray(transport.args) || stringArray(raw.args),
            env: recordOfStrings(transport.env) || recordOfStrings(raw.env),
            cwd: stringValue(transport.cwd) || stringValue(raw.cwd),
            url: stringValue(transport.url) || stringValue(raw.url),
            headers: recordOfStrings(transport.headers) || recordOfStrings(raw.headers),
            disabled: raw.enabled === false,
            enabled: raw.enabled === undefined ? undefined : raw.enabled === true,
            startupTimeoutSeconds: numberValue(raw.startup_timeout_sec),
            toolTimeoutSeconds: numberValue(raw.tool_timeout_sec),
            enabledTools: stringArray(raw.enabled_tools),
            disabledTools: stringArray(raw.disabled_tools)
        }, 'codex', env);
    }
    return servers;
}

export function normalizeServerMap(servers: McpServersConfig, source: string, env: NodeJS.ProcessEnv = process.env): McpServersConfig {
    const normalized: McpServersConfig = {};
    for (const [name, server] of Object.entries(servers || {})) {
        if (isRecord(server)) {
            normalized[name] = normalizeServerConfig(server, source, env);
        }
    }
    return normalized;
}

export function normalizeServerConfig(server: McpServerConfig, source: string, env: NodeJS.ProcessEnv = process.env): McpServerConfig {
    const type = normalizeTransportName(stringValue(server.type) || inferTransport(server));
    return {
        ...server,
        type,
        command: expandString(server.command, env),
        args: Array.isArray(server.args) ? server.args.map(arg => expandString(String(arg), env) || '') : undefined,
        env: expandRecord(server.env, env),
        cwd: expandString(server.cwd, env),
        url: expandString(server.url, env),
        headers: expandRecord(server.headers, env),
        disabled: server.disabled === true || server.enabled === false,
        source
    };
}

export function resolveTransport(server: McpServerConfig): McpResolvedServer['transport'] {
    return normalizeTransportName(stringValue(server.type) || inferTransport(server));
}

function readMcpConfigFile(filePath: string, source: string, env: NodeJS.ProcessEnv, warnings: string[]): McpServersConfig {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.toml')) {
        return readCodexTomlServers(filePath, env, warnings);
    }
    return readJsonMcpServers(filePath, env, warnings, source);
}

function readJsonMcpServers(filePath: string, env: NodeJS.ProcessEnv, warnings: string[], source = 'json'): McpServersConfig {
    const parsed = readJsonFile(filePath, warnings);
    if (!parsed) {
        return {};
    }
    const servers = isRecord(parsed.mcpServers) ? parsed.mcpServers : undefined;
    return normalizeServerMap((servers || {}) as McpServersConfig, source, env);
}

function readClaudeJsonProjectServers(filePath: string, workspaceRoot: string | undefined, env: NodeJS.ProcessEnv, warnings: string[]): McpServersConfig {
    if (!workspaceRoot) {
        return {};
    }
    const parsed = readJsonFile(filePath, warnings);
    if (!isRecord(parsed?.projects)) {
        return {};
    }
    const normalizedRoot = normalizeFsPath(workspaceRoot);
    for (const [projectPath, projectConfig] of Object.entries(parsed.projects)) {
        if (normalizeFsPath(projectPath) !== normalizedRoot || !isRecord(projectConfig)) {
            continue;
        }
        if (isRecord(projectConfig.mcpServers)) {
            return normalizeServerMap(projectConfig.mcpServers as McpServersConfig, 'claude-code:local-project', env);
        }
    }
    return {};
}

function readJsonFile(filePath: string, warnings: string[]): any | undefined {
    if (!fs.existsSync(filePath)) {
        return undefined;
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        warnings.push(`Could not read MCP JSON config ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    }
}

function readTomlFile(filePath: string, warnings: string[]): any | undefined {
    if (!fs.existsSync(filePath)) {
        return undefined;
    }
    try {
        return toml.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        warnings.push(`Could not read MCP TOML config ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    }
}

function expandHomeAndEnv(value: string, env: NodeJS.ProcessEnv, homeDir: string): string {
    const expanded = expandString(value.startsWith('~/') ? path.join(homeDir, value.slice(2)) : value, env) || value;
    return path.resolve(expanded);
}

function expandString(value: unknown, env: NodeJS.ProcessEnv): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_match, name: string, fallback: string | undefined) => {
        const envValue = env[name];
        if (envValue !== undefined && envValue !== '') {
            return envValue;
        }
        return fallback ?? '';
    });
}

function expandRecord(value: unknown, env: NodeJS.ProcessEnv): Record<string, string> | undefined {
    const record = recordOfStrings(value);
    if (!record) {
        return undefined;
    }
    const expanded: Record<string, string> = {};
    for (const [key, val] of Object.entries(record)) {
        expanded[key] = expandString(val, env) || '';
    }
    return expanded;
}

function inferTransport(server: McpServerConfig): string {
    if (server.command) {
        return 'stdio';
    }
    if (server.url) {
        return 'http';
    }
    return 'unknown';
}

function inferCodexTransport(value: Record<string, unknown>): string {
    if (value.command) {
        return 'stdio';
    }
    if (value.url) {
        return 'http';
    }
    return 'unknown';
}

function normalizeTransportName(value: string | undefined): McpResolvedServer['transport'] {
    const lower = String(value || '').toLowerCase();
    if (lower === 'stdio') {
        return 'stdio';
    }
    if (lower === 'sse') {
        return 'sse';
    }
    if (lower === 'http' || lower === 'streamable-http' || lower === 'streamable_http' || lower === 'streamablehttp') {
        return 'http';
    }
    return 'unknown';
}

function normalizeFsPath(value: string): string {
    return path.resolve(value).toLowerCase();
}

function isRecord(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
    return Array.isArray(value) ? value.map(item => String(item)) : undefined;
}

function recordOfStrings(value: unknown): Record<string, string> | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const record: Record<string, string> = {};
    for (const [key, val] of Object.entries(value)) {
        if (val !== undefined && val !== null) {
            record[key] = String(val);
        }
    }
    return record;
}
