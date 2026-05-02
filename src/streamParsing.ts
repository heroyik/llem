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

            const messageContent = extractTextParts(choice?.message?.content);
            if (messageContent) {
                return messageContent;
            }

            return typeof choice?.text === 'string' ? choice.text : '';
        }

        const msg = json.message;
        if (!msg) {
            return json.response || '';
        }

        if (msg.content) {
            return msg.content;
        }

        if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
            const firstCall = msg.tool_calls[0];
            const name = firstCall.function?.name || '';
            const args = firstCall.function?.arguments;
            const argsStr = typeof args === 'string' ? args : JSON.stringify(args || '');
            return `<${name} ${argsStr.includes('path=') ? '' : 'arguments='}"${argsStr.replace(/"/g, '&quot;')}" />`;
        }

        return '';
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
