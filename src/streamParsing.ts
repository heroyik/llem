function extractTextParts(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }

    if (!Array.isArray(value)) {
        return '';
    }

    return value
        .map(part => {
            if (typeof part === 'string') {
                return part;
            }
            if (part && typeof part === 'object') {
                const text = (part as any).text;
                return typeof text === 'string' ? text : '';
            }
            return '';
        })
        .join('');
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

        if (isLMStudio) {
            const choice = json.choices?.[0];
            const deltaContent = extractTextParts(choice?.delta?.content);
            if (deltaContent) {
                return deltaContent;
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
            return extractTextParts(json.response) || extractTextParts(json.content) || '';
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
