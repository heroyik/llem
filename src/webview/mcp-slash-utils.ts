import type { ChatMessage } from '../types';

function extractMcpTextParts(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .flatMap(item => extractMcpTextParts(item))
            .filter(Boolean);
    }
    if (!value || typeof value !== 'object') {
        return [];
    }

    const record = value as { type?: unknown; text?: unknown; content?: unknown };
    const directText = record.type === 'text' && typeof record.text === 'string'
        ? [record.text]
        : [];
    return [
        ...directText,
        ...extractMcpTextParts(record.content)
    ];
}

function renderMcpSlashResultMessage(content: string): string | undefined {
    if (!content.startsWith('[SYSTEM: MCP slash command result]')) {
        return undefined;
    }
    const commandMatch = content.match(/^Command:\s*\/([^\s]+)/m);
    const command = commandMatch ? commandMatch[1].replace(/-/g, '_') : '';
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(jsonMatch[1]);
        const textParts = extractMcpTextParts(parsed);
        if (textParts.length > 0) {
            const text = textParts.join('\n\n');
            if (command === 'ctx_stats') {
                return `\`\`\`text\n${text}\n\`\`\``;
            }
            return text;
        }
        return `\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
    } catch {
        return undefined;
    }
}

export function collectMcpSlashResultMessages(messages: ChatMessage[], startIndex: number): string[] {
    return messages
        .slice(startIndex)
        .filter(message => message.role === 'user')
        .map(message => renderMcpSlashResultMessage(message.content))
        .filter((message): message is string => !!message);
}
