import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadMcpServers } from './mcpConfig';
import type { McpCallResult, McpResolvedServer, McpServerConfig, McpToolSummary } from './types';

interface McpClientLike {
    connect(transport: unknown, options?: unknown): Promise<void>;
    listTools(params?: unknown, options?: unknown): Promise<{ tools: any[] }>;
    callTool(params: { name: string; arguments?: Record<string, unknown> }, resultSchema?: unknown, options?: unknown): Promise<unknown>;
    close?(): Promise<void>;
}

interface McpManagerOptions {
    servers: McpResolvedServer[];
    clientFactory?: () => McpClientLike;
    transportFactory?: (server: McpResolvedServer) => unknown;
}

interface ConnectionState {
    client: McpClientLike;
    tools?: any[];
}

const MAX_TOOL_RESULT_CHARS = 20000;

export class McpManager {
    private readonly servers = new Map<string, McpResolvedServer>();
    private readonly connections = new Map<string, ConnectionState>();
    private readonly clientFactory: () => McpClientLike;
    private readonly transportFactory: (server: McpResolvedServer) => unknown;

    constructor(options: McpManagerOptions) {
        for (const server of options.servers) {
            this.servers.set(server.name, server);
        }
        this.clientFactory = options.clientFactory ?? (() => new Client({ name: 'llem', version: '1.0.0' }));
        this.transportFactory = options.transportFactory ?? ((server) => {
            const cfg = server.config;
            if (!cfg.command) {
                throw new Error('stdio MCP server is missing command');
            }
            return new StdioClientTransport({
                command: cfg.command,
                args: cfg.args,
                env: cfg.env,
                cwd: cfg.cwd,
                stderr: 'pipe'
            });
        });
    }

    public getServers(): McpResolvedServer[] {
        return [...this.servers.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    public async listTools(): Promise<{ tools: McpToolSummary[]; report: string[] }> {
        const tools: McpToolSummary[] = [];
        const report: string[] = [];
        for (const server of this.getServers()) {
            if (server.disabled) {
                report.push(`⚠️ MCP server skipped: ${server.name} is disabled.`);
                continue;
            }
            if (!server.supported) {
                report.push(`⚠️ MCP server skipped: ${server.name} uses unsupported ${server.transport} transport.`);
                continue;
            }
            try {
                const client = await this.getClient(server);
                const listed = await this.withTimeout(() => client.listTools(), server.config.startupTimeoutSeconds ?? server.config.timeoutSeconds);
                const filtered = this.filterTools(server.config, listed.tools || []);
                this.connections.get(server.name)!.tools = filtered;
                for (const tool of filtered) {
                    tools.push({
                        server: server.name,
                        name: String(tool.name),
                        description: tool.description,
                        inputSchema: tool.inputSchema
                    });
                }
                report.push(`✅ MCP tools listed: ${server.name} (${filtered.length})`);
            } catch (error) {
                report.push(`❌ MCP tools failed: ${server.name} — ${summarizeError(error)}`);
            }
        }
        return { tools, report };
    }

    public async listServerTools(serverName: string): Promise<{ tools: McpToolSummary[]; report: string[] }> {
        const server = this.servers.get(serverName);
        if (!server) {
            return { tools: [], report: [`❌ MCP tools failed: ${serverName} — server not registered.`] };
        }
        const result = await this.listToolsForServer(server);
        return {
            tools: result.tools.map(tool => ({
                server: server.name,
                name: String(tool.name),
                description: tool.description,
                inputSchema: tool.inputSchema
            })),
            report: result.report
        };
    }

    public async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<McpCallResult> {
        const server = this.servers.get(serverName);
        if (!server) {
            return { ok: false, server: serverName, tool: toolName, text: `MCP server not registered: ${serverName}` };
        }
        if (server.disabled) {
            return { ok: false, server: serverName, tool: toolName, text: `MCP server is disabled: ${serverName}` };
        }
        if (!server.supported) {
            return { ok: false, server: serverName, tool: toolName, text: `MCP transport '${server.transport}' is configured for ${serverName}, but this LLeM build only calls stdio MCP servers.` };
        }
        if (!this.isToolAllowed(server.config, toolName)) {
            return { ok: false, server: serverName, tool: toolName, text: `MCP tool is disabled by configuration: ${serverName}.${toolName}` };
        }

        try {
            const client = await this.getClient(server);
            const raw = await this.withTimeout(
                () => client.callTool({ name: toolName, arguments: args }),
                server.config.toolTimeoutSeconds ?? server.config.timeoutSeconds
            );
            return {
                ok: true,
                server: serverName,
                tool: toolName,
                text: truncate(formatToolResult(raw), MAX_TOOL_RESULT_CHARS),
                raw
            };
        } catch (error) {
            return { ok: false, server: serverName, tool: toolName, text: summarizeError(error) };
        }
    }

    public async healthCheck(serverName: string): Promise<string> {
        const server = this.servers.get(serverName);
        if (!server) {
            return `MCP server not registered: ${serverName}`;
        }
        if (!server.supported || server.disabled) {
            return server.warning || `MCP server ${serverName} is not callable.`;
        }
        const result = await this.listTools();
        return result.report.find(item => item.includes(serverName)) || `Checked ${serverName}.`;
    }

    public async disconnect(): Promise<void> {
        for (const state of this.connections.values()) {
            await state.client.close?.().catch(() => undefined);
        }
        this.connections.clear();
    }

    private async getClient(server: McpResolvedServer): Promise<McpClientLike> {
        const existing = this.connections.get(server.name);
        if (existing) {
            return existing.client;
        }
        const client = this.clientFactory();
        const transport = this.transportFactory(server);
        await this.withTimeout(() => client.connect(transport), server.config.startupTimeoutSeconds ?? server.config.timeoutSeconds);
        this.connections.set(server.name, { client });
        return client;
    }

    private async listToolsForServer(server: McpResolvedServer): Promise<{ tools: any[]; report: string[] }> {
        if (server.disabled) {
            return { tools: [], report: [`⚠️ MCP server skipped: ${server.name} is disabled.`] };
        }
        if (!server.supported) {
            return { tools: [], report: [`⚠️ MCP server skipped: ${server.name} uses unsupported ${server.transport} transport.`] };
        }
        try {
            const client = await this.getClient(server);
            const listed = await this.withTimeout(() => client.listTools(), server.config.startupTimeoutSeconds ?? server.config.timeoutSeconds);
            const filtered = this.filterTools(server.config, listed.tools || []);
            this.connections.get(server.name)!.tools = filtered;
            return { tools: filtered, report: [`✅ MCP tools listed: ${server.name} (${filtered.length})`] };
        } catch (error) {
            return { tools: [], report: [`❌ MCP tools failed: ${server.name} — ${summarizeError(error)}`] };
        }
    }

    private filterTools(config: McpServerConfig, tools: any[]): any[] {
        return tools.filter(tool => this.isToolAllowed(config, String(tool.name || '')));
    }

    private isToolAllowed(config: McpServerConfig, toolName: string): boolean {
        if (Array.isArray(config.enabledTools) && config.enabledTools.length > 0 && !config.enabledTools.includes(toolName)) {
            return false;
        }
        if (Array.isArray(config.disabledTools) && config.disabledTools.includes(toolName)) {
            return false;
        }
        return true;
    }

    private async withTimeout<T>(run: () => Promise<T>, timeoutSeconds?: number): Promise<T> {
        if (!timeoutSeconds || timeoutSeconds <= 0) {
            return await run();
        }
        let timer: NodeJS.Timeout | undefined;
        try {
            return await Promise.race([
                run(),
                new Promise<T>((_resolve, reject) => {
                    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutSeconds}s`)), timeoutSeconds * 1000);
                })
            ]);
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }
}

let cachedManager: McpManager | undefined;
let cachedKey = '';

export function getMcpManager(workspaceRoot?: string): McpManager {
    const { getConfig } = require('./config') as typeof import('./config');
    const config = getConfig();
    const key = JSON.stringify({
        workspaceRoot,
        enabled: config.mcpEnabled,
        servers: config.mcpServers,
        sources: config.mcpConfigSources,
        paths: config.mcpConfigPaths
    });
    if (cachedManager && cachedKey === key) {
        return cachedManager;
    }
    const loadResult = config.mcpEnabled
        ? loadMcpServers({
            workspaceRoot,
            llemServers: config.mcpServers,
            sources: config.mcpConfigSources,
            extraPaths: config.mcpConfigPaths
        })
        : { servers: [], warnings: [] };
    cachedManager = new McpManager({ servers: loadResult.servers });
    cachedKey = key;
    return cachedManager;
}

function formatToolResult(raw: any): string {
    if (raw?.content && Array.isArray(raw.content)) {
        return raw.content.map((item: any) => {
            if (item?.type === 'text') {
                return String(item.text || '');
            }
            return JSON.stringify(item);
        }).join('\n');
    }
    return JSON.stringify(raw, null, 2);
}

function truncate(value: string, maxChars: number): string {
    if (value.length <= maxChars) {
        return value;
    }
    return value.slice(0, maxChars) + `\n\n[truncated ${value.length - maxChars} chars]`;
}

function summarizeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
