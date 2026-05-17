import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getConfig } from '../config';
import { resolveMcpConfig } from './mcpConfig';
import type { McpCallResult, McpToolSummary, ResolvedMcpServerConfig } from '../types';

interface Connection {
    client: Client;
    transport: StdioClientTransport;
}

export class McpManager {
    private connections = new Map<string, Promise<Connection>>();

    public async reload(): Promise<void> {
        await this.dispose();
    }

    public async dispose(): Promise<void> {
        const pending = Array.from(this.connections.values());
        this.connections.clear();
        for (const entry of pending) {
            try {
                const connection = await entry;
                await connection.client.close();
                await connection.transport.close();
            } catch {
                // Best-effort shutdown.
            }
        }
    }

    public async listServers(): Promise<ResolvedMcpServerConfig[]> {
        const snapshot = await resolveMcpConfig();
        return Object.values(snapshot.servers).sort((a, b) => a.name.localeCompare(b.name));
    }

    public async listTools(): Promise<{ tools: McpToolSummary[]; report: string[] }> {
        if (!getConfig().mcpEnabled) {
            return { tools: [], report: ['MCP is disabled.'] };
        }
        const servers = await this.listServers();
        const tools: McpToolSummary[] = [];
        const report: string[] = [];
        for (const server of servers) {
            if (!server.enabled) {
                report.push(`MCP server skipped: ${server.name} is disabled.`);
                continue;
            }
            if (server.transport !== 'stdio') {
                report.push(`MCP server skipped: ${server.name} uses unsupported transport.`);
                continue;
            }
            try {
                const connection = await this.connect(server);
                const result = await withTimeout(connection.client.listTools(), getConfig().mcpToolTimeoutSeconds * 1000, `list tools timed out for ${server.name}`);
                for (const tool of result.tools || []) {
                    tools.push({
                        server: server.name,
                        name: tool.name,
                        description: tool.description,
                        inputSchema: tool.inputSchema
                    });
                }
                report.push(`MCP tools listed: ${server.name} (${result.tools?.length || 0})`);
            } catch (err) {
                report.push(`MCP server failed: ${server.name} — ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        return { tools, report };
    }

    public async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<McpCallResult> {
        if (!getConfig().mcpEnabled) {
            return { ok: false, server: serverName, tool: toolName, error: 'MCP is disabled.' };
        }
        const snapshot = await resolveMcpConfig();
        const server = snapshot.servers[serverName];
        if (!server) {
            return { ok: false, server: serverName, tool: toolName, error: `MCP server not found: ${serverName}` };
        }
        if (!server.enabled) {
            return { ok: false, server: serverName, tool: toolName, error: `MCP server is disabled: ${serverName}` };
        }
        if (server.transport !== 'stdio') {
            return { ok: false, server: serverName, tool: toolName, error: `Unsupported MCP transport for ${serverName}. v1 supports stdio only.` };
        }
        try {
            const connection = await this.connect(server);
            const result = await withTimeout(
                connection.client.callTool({ name: toolName, arguments: args }),
                getConfig().mcpToolTimeoutSeconds * 1000,
                `tool call timed out for ${serverName}.${toolName}`
            );
            return { ok: true, server: serverName, tool: toolName, content: result };
        } catch (err) {
            return { ok: false, server: serverName, tool: toolName, error: err instanceof Error ? err.message : String(err) };
        }
    }

    private async connect(server: ResolvedMcpServerConfig): Promise<Connection> {
        const existing = this.connections.get(server.name);
        if (existing) {
            return existing;
        }
        const connectionPromise = this.createConnection(server);
        this.connections.set(server.name, connectionPromise);
        return connectionPromise;
    }

    private async createConnection(server: ResolvedMcpServerConfig): Promise<Connection> {
        if (!server.command) {
            throw new Error('stdio MCP server requires command');
        }
        const transport = new StdioClientTransport({
            command: server.command,
            args: server.args,
            env: { ...process.env, ...server.env } as Record<string, string>,
            cwd: server.cwd,
            stderr: 'pipe'
        });
        const client = new Client({ name: 'llem', version: '1.0.0' }, { capabilities: {} });
        await withTimeout(client.connect(transport), getConfig().mcpToolTimeoutSeconds * 1000, `MCP handshake timed out for ${server.name}`);
        return { client, transport };
    }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(message)), timeoutMs);
            })
        ]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}
