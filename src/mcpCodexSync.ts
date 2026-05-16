import * as vscode from 'vscode';
import { getLlemSettings } from './config';
import { readCodexConfigs, readSettingsServers, toSettingsObject } from './mcpConfig';
import { buildMcpSyncDiff, hasMcpSyncDiff, renderMcpSyncDiffMarkdown, summarizeMcpSyncDiff } from './mcpSyncDiff';
import type { ResolvedMcpServerConfig } from './types';

export async function syncCodexMcpServers(options: { promptForApproval?: boolean } = { promptForApproval: true }): Promise<string> {
    const errors: string[] = [];
    const nextCodex = await readCodexConfigs(errors);
    const previousAll = readSettingsServers('mcpSyncedServers', 'codex', errors);
    const previousCodex = Object.fromEntries(Object.entries(previousAll).filter(([, server]) => server.sourceKind === 'codex'));
    const local = readSettingsServers('mcpServers', 'llem', errors, true);
    const stampedNext = stampSynced(nextCodex);
    const diff = buildMcpSyncDiff(previousCodex, stampedNext, local);
    const summary = summarizeMcpSyncDiff(diff);

    if (!hasMcpSyncDiff(diff)) {
        return errors.length ? `No Codex MCP changes. ${errors.join(' ')}` : 'No Codex MCP changes detected.';
    }

    const markdown = renderMcpSyncDiffMarkdown(diff);
    await showDiffMarkdown(markdown);

    if (options.promptForApproval !== false) {
        const pick = await vscode.window.showWarningMessage(
            `Apply Codex MCP sync? ${summary}`,
            { modal: true },
            'Apply Sync'
        );
        if (pick !== 'Apply Sync') {
            return `Codex MCP sync not applied. ${summary}`;
        }
    }

    const nonCodexSynced = Object.fromEntries(Object.entries(previousAll).filter(([, server]) => server.sourceKind !== 'codex'));
    await getLlemSettings().update('mcpSyncedServers', toSettingsObject({ ...nonCodexSynced, ...stampedNext }), vscode.ConfigurationTarget.Global);
    return `Codex MCP sync applied. ${summary}`;
}

export async function previewCodexMcpSync(): Promise<string> {
    const errors: string[] = [];
    const nextCodex = await readCodexConfigs(errors);
    const previous = Object.fromEntries(Object.entries(readSettingsServers('mcpSyncedServers', 'codex', errors)).filter(([, server]) => server.sourceKind === 'codex'));
    const local = readSettingsServers('mcpServers', 'llem', errors, true);
    const diff = buildMcpSyncDiff(previous, stampSynced(nextCodex), local);
    const markdown = renderMcpSyncDiffMarkdown(diff);
    await showDiffMarkdown(markdown);
    return errors.length ? `${summarizeMcpSyncDiff(diff)} (${errors.length} warning(s))` : summarizeMcpSyncDiff(diff);
}

export async function getCodexMcpSyncSummary(): Promise<string | undefined> {
    const errors: string[] = [];
    const nextCodex = await readCodexConfigs(errors);
    const previous = Object.fromEntries(Object.entries(readSettingsServers('mcpSyncedServers', 'codex', errors)).filter(([, server]) => server.sourceKind === 'codex'));
    const local = readSettingsServers('mcpServers', 'llem', errors, true);
    const diff = buildMcpSyncDiff(previous, stampSynced(nextCodex), local);
    return hasMcpSyncDiff(diff) ? summarizeMcpSyncDiff(diff) : undefined;
}

function stampSynced(servers: Record<string, ResolvedMcpServerConfig>): Record<string, ResolvedMcpServerConfig> {
    const syncedAt = new Date().toISOString();
    return Object.fromEntries(Object.entries(servers).map(([name, server]) => [name, { ...server, sourceKind: 'codex' as const, syncedAt }]));
}

async function showDiffMarkdown(markdown: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: markdown
    });
    await vscode.window.showTextDocument(doc, { preview: true });
}
