import type { ChatMessage } from './types';

export function buildContinuationSystemMessage(internalSystemFeedback: string, externalReport: string[]): string {
    const parts: string[] = [];

    if (internalSystemFeedback.trim()) {
        parts.push(internalSystemFeedback.trim());
    }

    if (externalReport.length > 0) {
        parts.push(
            `[Observation: Action Results]\n${externalReport.join('\n')}`
        );
    }

    if (parts.length > 0) {
        parts.push(
            "IMPORTANT: Use the observation above to continue and answer the user's request. DO NOT repeat your previous reasoning or re-emit the same action. If an action failed (Mismatch or Safety Block), DO NOT explain the failure to the user. Instead, perform a recovery action (e.g., <read_file>) or fix the match. Be concise and prioritize task completion."
        );
    }

    return parts.join('\n\n').trim();
}

/**
 * Merges two message contents, supporting both string-based and array-based multimodal inputs.
 */
export function mergeMessageContent(a: unknown, b: unknown): unknown {
    const parts: any[] = [];

    const addContent = (content: unknown) => {
        if (typeof content === 'string') {
            if (content.trim()) {
                parts.push({ type: 'text', text: content });
            }
        } else if (Array.isArray(content)) {
            parts.push(...content);
        } else if (content !== undefined && content !== null) {
            parts.push({ type: 'text', text: String(content) });
        }
    };

    addContent(a);
    addContent(b);

    // If all parts are plain text, simplify back to a single string
    const allText = parts.every(p => p.type === 'text');
    if (allText) {
        return parts.map(p => p.text).join('\n\n');
    }

    return parts;
}

/**
 * Normalizes a list of chat messages to satisfy:
 * 1. The first message after the system prompt is a 'user' message.
 * 2. Strict alternation between 'user' and 'assistant' roles (merging consecutive same-role messages).
 */
export function normalizeChatMessages(messages: ChatMessage[]): ChatMessage[] {
    if (messages.length === 0) {
        return [];
    }

    const result: ChatMessage[] = [];

    // 1. Gather all system messages and combine them
    const systemMsgs = messages.filter(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');

    if (systemMsgs.length > 0) {
        const mergedSystem = systemMsgs
            .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
            .join('\n\n');
        result.push({ role: 'system', content: mergedSystem });
    }

    if (nonSystemMsgs.length === 0) {
        return result;
    }

    // 2. Ensure the first non-system message is a 'user' message
    if (nonSystemMsgs[0].role === 'assistant') {
        nonSystemMsgs.unshift({ role: 'user', content: 'Continue' });
    }

    // 3. Alternate roles, merging consecutive same-role messages
    for (const msg of nonSystemMsgs) {
        if (result.length === 0 || result[result.length - 1].role === 'system') {
            result.push({ ...msg });
            continue;
        }

        const lastMsg = result[result.length - 1];
        if (lastMsg.role === msg.role) {
            lastMsg.content = mergeMessageContent(lastMsg.content, msg.content);
        } else {
            result.push({ ...msg });
        }
    }

    return result;
}

