import type { McpChangedServerDiff, McpSyncDiff, ResolvedMcpServerConfig } from './types';

const COMPARED_FIELDS = ['transport', 'command', 'args', 'env', 'enabled', 'cwd', 'timeout'] as const;

export function buildMcpSyncDiff(
    previous: Record<string, ResolvedMcpServerConfig>,
    next: Record<string, ResolvedMcpServerConfig>,
    localServers: Record<string, ResolvedMcpServerConfig> = {}
): McpSyncDiff {
    const added: ResolvedMcpServerConfig[] = [];
    const removed: ResolvedMcpServerConfig[] = [];
    const changed: McpChangedServerDiff[] = [];
    const unchanged: ResolvedMcpServerConfig[] = [];
    const names = Array.from(new Set([...Object.keys(previous), ...Object.keys(next)])).sort();

    for (const name of names) {
        const before = previous[name];
        const after = next[name];
        if (!before && after) {
            added.push(withShadow(after, localServers));
            continue;
        }
        if (before && !after) {
            removed.push(withShadow(before, localServers));
            continue;
        }
        if (!before || !after) {
            continue;
        }

        const changedFields = COMPARED_FIELDS.filter(field => !sameComparable((before as any)[field], (after as any)[field]));
        const envDiff = diffEnv(before.env || {}, after.env || {});
        if (changedFields.length > 0) {
            changed.push({
                name,
                before,
                after: withShadow(after, localServers),
                changedFields,
                envDiff,
                shadowedByLocal: Boolean(localServers[name])
            });
        } else {
            unchanged.push(withShadow(after, localServers));
        }
    }

    return { added, removed, changed, unchanged };
}

export function summarizeMcpSyncDiff(diff: McpSyncDiff): string {
    return `+${diff.added.length} added, -${diff.removed.length} removed, ~${diff.changed.length} changed`;
}

export function hasMcpSyncDiff(diff: McpSyncDiff): boolean {
    return diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;
}

export function renderMcpSyncDiffMarkdown(diff: McpSyncDiff): string {
    const lines = [
        '# MCP Codex Sync Diff',
        '',
        `Summary: ${summarizeMcpSyncDiff(diff)}`,
        ''
    ];
    appendServerSection(lines, 'Added', diff.added, server => describeServer(server));
    appendServerSection(lines, 'Removed', diff.removed, server => describeServer(server));
    appendServerSection(lines, 'Changed', diff.changed, change => {
        const fieldList = change.changedFields.join(', ');
        const envParts = [
            change.envDiff.addedKeys.length ? `env added: ${change.envDiff.addedKeys.join(', ')}` : '',
            change.envDiff.removedKeys.length ? `env removed: ${change.envDiff.removedKeys.join(', ')}` : '',
            change.envDiff.changedKeys.length ? `env changed: ${change.envDiff.changedKeys.join(', ')}` : ''
        ].filter(Boolean).join('; ');
        return [
            `- ${change.name}${change.shadowedByLocal ? ' (shadowed by local config)' : ''}`,
            `  - fields: ${fieldList}`,
            envParts ? `  - ${envParts}` : '',
            `  - before: ${describeCommand(change.before)}`,
            `  - after: ${describeCommand(change.after)}`
        ].filter(Boolean).join('\n');
    });
    if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
        lines.push('No Codex MCP changes detected.');
    }
    return lines.join('\n');
}

function appendServerSection<T>(lines: string[], title: string, values: T[], render: (value: T) => string): void {
    if (values.length === 0) {
        return;
    }
    lines.push(`## ${title}`, '');
    for (const value of values) {
        lines.push(render(value), '');
    }
}

function describeServer(server: ResolvedMcpServerConfig): string {
    return `- ${server.name}${server.shadowedByLocal ? ' (shadowed by local config)' : ''}: ${describeCommand(server)}${server.sourcePath ? `\n  - source: ${server.sourcePath}` : ''}`;
}

function describeCommand(server: ResolvedMcpServerConfig): string {
    if (server.transport !== 'stdio') {
        return `${server.transport}${server.url ? ` ${server.url}` : ''}`;
    }
    return [server.command, ...(server.args || [])].filter(Boolean).join(' ');
}

function withShadow(server: ResolvedMcpServerConfig, localServers: Record<string, ResolvedMcpServerConfig>): ResolvedMcpServerConfig {
    return { ...server, shadowedByLocal: Boolean(localServers[server.name]) };
}

function diffEnv(before: Record<string, string>, after: Record<string, string>): McpChangedServerDiff['envDiff'] {
    const beforeKeys = Object.keys(before).sort();
    const afterKeys = Object.keys(after).sort();
    return {
        addedKeys: afterKeys.filter(key => !beforeKeys.includes(key)),
        removedKeys: beforeKeys.filter(key => !afterKeys.includes(key)),
        changedKeys: afterKeys.filter(key => beforeKeys.includes(key) && before[key] !== after[key])
    };
}

function sameComparable(left: unknown, right: unknown): boolean {
    return JSON.stringify(sortValue(left)) === JSON.stringify(sortValue(right));
}

function sortValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortValue);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortValue(v)]));
    }
    return value;
}

