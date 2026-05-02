function extractTextParts(value: unknown, depth = 0): string {
    if (typeof value === 'string') {
        return value;
    }

    if (!value || depth > 3) {
        return '';
    }

    if (Array.isArray(value)) {
        return value.map(part => extractTextParts(part, depth + 1)).join('');
    }

    if (typeof value !== 'object') {
        return '';
    }

    const candidate = value as Record<string, unknown>;
    const directFields = [
        candidate.text,
        candidate.delta,
        candidate.value,
        candidate.output_text,
        candidate.reasoning_text,
        candidate.reasoning_content,
        candidate.reasoning,
        candidate.thinking,
        candidate.content
    ];

    for (const field of directFields) {
        const extracted = extractTextParts(field, depth + 1);
        if (extracted) {
            return extracted;
        }
    }

    return '';
}

function extractToolCallToken(toolCalls: unknown): string {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
        return '';
    }

    const firstCall = toolCalls[0] as any;
    const name = firstCall?.function?.name || firstCall?.name || '';
    const args = firstCall?.function?.arguments ?? firstCall?.arguments;
    const argsStr = typeof args === 'string'
        ? args
        : (args && typeof args === 'object' ? JSON.stringify(args) : '');

    if (!name) {
        return '';
    }

    return `<${name} ${argsStr.includes('path=') ? '' : 'arguments='}"${argsStr.replace(/"/g, '&quot;')}" />`;
}

export function extractStreamToken(line: string, isLMStudio: boolean): string {
    if (!line.trim() || line.trim() === 'data: [DONE]') {
        return '';
    }

    try {
        const raw = line.startsWith('data:') ? line.slice(5).trimStart() : line;
        const json = JSON.parse(raw);
        if (json.error) {
            return `[API error] ${json.error.message || json.error}`;
        }

        const choice = json.choices?.[0];

        if (isLMStudio) {
            const deltaContent = extractTextParts(choice?.delta?.content);
            if (deltaContent) {
                return deltaContent;
            }

            const deltaToken = extractTextParts(choice?.delta);
            if (deltaToken) {
                return deltaToken;
            }

            const deltaReasoning = extractTextParts(choice?.delta?.reasoning_content || choice?.delta?.reasoning);
            if (deltaReasoning) {
                return deltaReasoning;
            }

            const messageContent = extractTextParts(choice?.message?.content);
            if (messageContent) {
                return messageContent;
            }

            const messageReasoning = extractTextParts(choice?.message?.reasoning_content || choice?.message?.reasoning);
            if (messageReasoning) {
                return messageReasoning;
            }

            const toolCallToken = extractToolCallToken(choice?.message?.tool_calls || choice?.tool_calls);
            if (toolCallToken) {
                return toolCallToken;
            }

            return typeof choice?.text === 'string' ? choice.text : '';
        }

        const msg = json.message;
        if (!msg) {
            return extractTextParts(json.response)
                || extractTextParts(json.content)
                || extractTextParts(choice?.delta?.content)
                || extractTextParts(choice?.delta)
                || extractTextParts(choice?.message?.content)
                || '';
        }

        const messageContent = extractTextParts(msg.content);
        if (messageContent) {
            return messageContent;
        }

        const reasoningContent = extractTextParts(msg.reasoning_content || msg.reasoning);
        if (reasoningContent) {
            return reasoningContent;
        }

        return extractToolCallToken(msg.tool_calls);
    } catch {
        return '';
    }
}

export function parseStreamBuffer(buffer: string, isLMStudio: boolean, flush = false): { tokens: string[]; remainder: string } {
    const normalized = String(buffer || '');
    const lines = normalized.split('\n');
    const remainder = flush ? '' : (lines.pop() || '');
    const sourceLines = flush ? lines.concat(remainder ? [remainder] : []) : lines;
    const tokens: string[] = [];

    for (const line of sourceLines) {
        const token = extractStreamToken(line, isLMStudio);
        if (token) {
            tokens.push(token);
        }
    }

    return { tokens, remainder };
}
