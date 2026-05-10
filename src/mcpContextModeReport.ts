import type { McpCallResult, McpToolSummary } from './types';

export function contextModeListReport(tools: McpToolSummary[]): string | undefined {
    const count = tools.filter(tool => tool.server === 'context-mode').length;
    if (count === 0) {
        return undefined;
    }
    return `🧠 context-mode active: ${count} tool${count === 1 ? '' : 's'} available.`;
}

export function contextModeCallReport(result: McpCallResult): string | undefined {
    if (result.server !== 'context-mode') {
        return undefined;
    }
    const metrics = extractContextModeMetrics(result);
    const suffix = metrics.length > 0 ? ` ${metrics.join(', ')}.` : '';
    return result.ok
        ? `🧠 context-mode ran: ${result.tool || 'tool'}.${suffix}`
        : `🧠 context-mode failed: ${result.tool || 'tool'} — ${result.text}`;
}

function extractContextModeMetrics(result: McpCallResult): string[] {
    const values = collectValues(result.raw, result.text);
    const savedContext = firstMetric(values, [
        'savedContext',
        'contextSaved',
        'contextSavings',
        'reducedContext',
        'contextReduced',
        'savedChars',
        'charsSaved',
        'charactersSaved'
    ]);
    const savedTokens = firstMetric(values, [
        'savedTokens',
        'tokensSaved',
        'tokenSavings',
        'reducedTokens',
        'tokensReduced',
        'estimatedTokensSaved',
        'estimatedSavedTokens'
    ]);
    const originalTokens = firstMetric(values, ['originalTokens', 'beforeTokens', 'inputTokens', 'totalTokensBefore']);
    const finalTokens = firstMetric(values, ['finalTokens', 'afterTokens', 'outputTokens', 'totalTokensAfter']);
    const compressionRatio = firstMetric(values, ['compressionRatio', 'ratio', 'savingsRatio']);

    const metrics: string[] = [];
    if (savedContext !== undefined) {
        metrics.push(`context saved ${formatNumber(savedContext)} chars`);
    }
    if (savedTokens !== undefined) {
        metrics.push(`tokens saved ${formatNumber(savedTokens)}`);
    }
    if (originalTokens !== undefined && finalTokens !== undefined) {
        metrics.push(`tokens ${formatNumber(originalTokens)} → ${formatNumber(finalTokens)}`);
    }
    if (compressionRatio !== undefined) {
        metrics.push(`ratio ${formatRatio(compressionRatio)}`);
    }
    return metrics;
}

function collectValues(raw: unknown, text: string): Map<string, number> {
    const values = new Map<string, number>();
    visit(raw, values);
    const parsedText = parseJsonLike(text);
    if (parsedText !== undefined) {
        visit(parsedText, values);
    }
    collectTextMetrics(text, values);
    return values;
}

function visit(value: unknown, values: Map<string, number>, keyPath = ''): void {
    if (typeof value === 'number' && Number.isFinite(value) && keyPath) {
        values.set(normalizeKey(keyPath), value);
        return;
    }
    if (typeof value === 'string' && keyPath) {
        const numeric = parseNumeric(value);
        if (numeric !== undefined) {
            values.set(normalizeKey(keyPath), numeric);
        }
        const parsed = parseJsonLike(value);
        if (parsed !== undefined) {
            visit(parsed, values, keyPath);
        }
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, values, `${keyPath}.${index}`));
        return;
    }
    if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            visit(child, values, keyPath ? `${keyPath}.${key}` : key);
        }
    }
}

function collectTextMetrics(text: string, values: Map<string, number>): void {
    const patterns: Array<[string, RegExp]> = [
        ['savedTokens', /(?:tokens?\s*(?:saved|reduced)|saved\s*tokens?)\D+([0-9][0-9,]*(?:\.\d+)?)/i],
        ['savedContext', /(?:context|chars?|characters?)\s*(?:saved|reduced)\D+([0-9][0-9,]*(?:\.\d+)?)/i],
        ['compressionRatio', /(?:ratio|compression)\D+([0-9][0-9,]*(?:\.\d+)?%?)/i]
    ];
    for (const [key, pattern] of patterns) {
        const match = text.match(pattern);
        const numeric = match ? parseNumeric(match[1]) : undefined;
        if (numeric !== undefined) {
            values.set(normalizeKey(key), numeric);
        }
    }
}

function firstMetric(values: Map<string, number>, names: string[]): number | undefined {
    for (const name of names) {
        const normalized = normalizeKey(name);
        for (const [key, value] of values) {
            if (key.endsWith(normalized)) {
                return value;
            }
        }
    }
    return undefined;
}

function parseJsonLike(text: string): unknown {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        return undefined;
    }
    try {
        return JSON.parse(trimmed);
    } catch {
        return undefined;
    }
}

function parseNumeric(value: string): number | undefined {
    const normalized = value.replace(/,/g, '').trim();
    if (!/^[-+]?\d+(?:\.\d+)?%?$/.test(normalized)) {
        return undefined;
    }
    const number = Number(normalized.replace(/%$/, ''));
    return Number.isFinite(number) ? number : undefined;
}

function normalizeKey(value: string): string {
    return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function formatNumber(value: number): string {
    return Number.isInteger(value) ? value.toLocaleString('en-US') : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function formatRatio(value: number): string {
    return value > 1 ? `${formatNumber(value)}%` : `${formatNumber(value * 100)}%`;
}
