import * as vscode from 'vscode';
import { getConfig, getLlemSettings } from '../config';
import type { McpServerConfig, McpSourceKind, ResolvedMcpServerConfig } from '../types';
import { resolveMcpConfig, toSettingsObject } from './mcpConfig';
import { readSyncedMcpServers, writeSyncedMcpServers } from './mcpStorage';

export interface McpServerUiState {
    name: string;
    enabled: boolean;
    editable: boolean;
    sourceKind: McpSourceKind;
    sourcePath?: string;
    transport: string;
    command?: string;
    args: string[];
    url?: string;
    disabledReason?: string;
}

export interface McpServerListUiState {
    mcpEnabled: boolean;
    servers: McpServerUiState[];
}

function isEditableSource(server: ResolvedMcpServerConfig): boolean {
    return server.sourceKind === 'llem' || server.sourceKind === 'codex';
}

function disabledReason(server: ResolvedMcpServerConfig): string | undefined {
    if (isEditableSource(server)) {
        return undefined;
    }
    if (server.sourceKind === 'workspace') {
        return 'Workspace .mcp.json controls this server.';
    }
    return server.sourcePath
        ? `Edit source config: ${server.sourcePath}`
        : `Source ${server.sourceKind} is read-only from this panel.`;
}

export async function listMcpServerUiState(): Promise<McpServerListUiState> {
    const snapshot = await resolveMcpConfig();
    const servers = Object.values(snapshot.servers)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(server => ({
            name: server.name,
            enabled: server.enabled,
            editable: isEditableSource(server),
            sourceKind: server.sourceKind,
            sourcePath: server.sourcePath,
            transport: server.transport,
            command: server.command,
            args: server.args,
            url: server.url,
            disabledReason: disabledReason(server)
        }));
    return {
        mcpEnabled: getConfig().mcpEnabled,
        servers
    };
}

export async function setGlobalMcpEnabled(enabled: boolean): Promise<void> {
    await getLlemSettings().update('mcpEnabled', enabled, vscode.ConfigurationTarget.Global);
}

export async function setMcpServerEnabled(name: string, enabled: boolean): Promise<void> {
    const snapshot = await resolveMcpConfig();
    const server = snapshot.servers[name];
    if (!server) {
        throw new Error(`MCP server not found: ${name}`);
    }
    if (server.sourceKind === 'llem') {
        const current = getLlemSettings().get<Record<string, McpServerConfig & Record<string, unknown>>>('mcpServers', {});
        const updatedServer = toSettingsObject({ [name]: { ...server, enabled } })[name];
        await getLlemSettings().update('mcpServers', {
            ...current,
            [name]: {
                ...(current[name] || {}),
                ...updatedServer,
                enabled
            }
        }, vscode.ConfigurationTarget.Global);
        return;
    }

    if (server.sourceKind === 'codex') {
        const stored = await readSyncedMcpServers();
        if (!stored[name]) {
            throw new Error(`Synced MCP server not found in LLeM storage: ${name}`);
        }
        await writeSyncedMcpServers({
            ...stored,
            [name]: {
                ...stored[name],
                enabled
            }
        });
        return;
    }

    throw new Error(disabledReason(server) || `MCP server ${name} is read-only from this panel.`);
}
