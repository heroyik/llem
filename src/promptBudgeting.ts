import * as path from 'path';
import type { ChatMessage, ModelContextBudget } from './types';

function stringifyContent(content: unknown): string {
    if (typeof content === 'string') {
        return content;
    }

    if (content === undefined || content === null) {
        return '';
    }

    try {
        return JSON.stringify(content);
    } catch {
        return String(content);
    }
}

function isActionSystemMessage(message: ChatMessage): boolean {
    return message.role === 'user' && stringifyContent(message.content).trimStart().startsWith('[SYSTEM:');
}

function hasRelevantTerm(content: string, relevantTerms: string[]): boolean {
    const haystack = content.toLowerCase();
    return relevantTerms.some(term => haystack.includes(term));
}

export function estimateMessageChars(message: ChatMessage): number {
    return stringifyContent(message.content).length;
}

export function truncateText(value: string, maxChars: number): string {
    if (maxChars <= 0) {
        return '';
    }

    if (value.length <= maxChars) {
        return value;
    }

    const truncatedCount = value.length - maxChars;
    const note = `\n...[truncated ${truncatedCount} chars]`;
    if (maxChars <= note.length + 32) {
        return value.slice(0, maxChars);
    }

    return `${value.slice(0, maxChars - note.length)}${note}`;
}

export function collectRelevantTerms(activeFileName?: string, attachmentNames: string[] = []): string[] {
    const terms = new Set<string>();

    for (const name of [activeFileName, ...attachmentNames]) {
        if (!name) {
            continue;
        }

        const normalized = name.replace(/\\/g, '/');
        const base = path.basename(normalized).toLowerCase();
        const ext = path.extname(base);
        const stem = ext ? base.slice(0, -ext.length) : base;
        const slashless = normalized.toLowerCase();

        for (const term of [slashless, base, stem]) {
            if (term && term.length >= 3) {
                terms.add(term);
            }
        }
    }

    return Array.from(terms);
}

export function getAttachmentBudgetLimits(contextBudget?: ModelContextBudget): { perFileChars: number; totalChars: number } {
    if (!contextBudget) {
        return {
            perFileChars: 20_000,
            totalChars: Number.POSITIVE_INFINITY
        };
    }

    return {
        perFileChars: contextBudget.attachmentFileChars,
        totalChars: contextBudget.attachmentTotalChars
    };
}

export function allocateAttachmentPreview(
    preview: string,
    remainingChars: number,
    perFileChars: number
): { included: string; remainingChars: number; prunedChars: number } {
    const allowed = Math.max(0, Math.min(perFileChars, remainingChars));
    const included = preview.slice(0, allowed);
    return {
        included,
        remainingChars: Number.isFinite(remainingChars) ? Math.max(0, remainingChars - included.length) : remainingChars,
        prunedChars: Math.max(0, preview.length - included.length)
    };
}

export function pruneHistoryMessages(
    messages: ChatMessage[],
    maxChars: number,
    relevantTerms: string[]
): { messages: ChatMessage[]; keptChars: number; prunedMessages: number } {
    if (maxChars <= 0) {
        for (let i = messages.length - 1; i >= 0; i -= 1) {
            if (messages[i].role === 'user' && !isActionSystemMessage(messages[i])) {
                const content = stringifyContent(messages[i].content);
                const truncated = truncateText(content, Math.min(4_000, content.length));
                return {
                    messages: [{ ...messages[i], content: truncated }],
                    keptChars: truncated.length,
                    prunedMessages: messages.length - 1
                };
            }
        }

        return { messages: [], keptChars: 0, prunedMessages: messages.length };
    }

    const working = messages.map(message => ({ ...message }));
    const pinned = new Set<number>();
    const lastUserIndex = (() => {
        for (let i = working.length - 1; i >= 0; i -= 1) {
            if (working[i].role === 'user' && !isActionSystemMessage(working[i])) {
                return i;
            }
        }
        return -1;
    })();

    if (lastUserIndex >= 0) {
        pinned.add(lastUserIndex);
    }

    let recentConversationCount = 0;
    for (let i = working.length - 1; i >= 0 && recentConversationCount < 4; i -= 1) {
        if (isActionSystemMessage(working[i])) {
            continue;
        }
        pinned.add(i);
        recentConversationCount += 1;
    }

    for (let i = 0; i < working.length; i += 1) {
        if (isActionSystemMessage(working[i])) {
            pinned.add(i);
        }
    }

    const retained = new Set<number>(working.map((_, index) => index));
    let keptChars = working.reduce((sum, message) => sum + estimateMessageChars(message), 0);
    const removable = working
        .map((message, index) => ({
            index,
            content: stringifyContent(message.content),
            relevant: hasRelevantTerm(stringifyContent(message.content), relevantTerms)
        }))
        .filter(entry => !pinned.has(entry.index))
        .sort((a, b) => {
            if (a.relevant !== b.relevant) {
                return a.relevant ? 1 : -1;
            }
            return a.index - b.index;
        });

    let prunedMessages = 0;

    for (const candidate of removable) {
        if (keptChars <= maxChars) {
            break;
        }
        retained.delete(candidate.index);
        keptChars -= candidate.content.length;
        prunedMessages += 1;
    }

    if (keptChars > maxChars) {
        const compressionCandidates = Array.from(retained)
            .filter(index => index !== lastUserIndex)
            .sort((a, b) => a - b);

        for (const index of compressionCandidates) {
            if (keptChars <= maxChars) {
                break;
            }

            const content = stringifyContent(working[index].content);
            if (content.length <= 320) {
                continue;
            }

            const targetChars = Math.max(220, content.length - (keptChars - maxChars));
            const nextContent = truncateText(content, targetChars);
            keptChars -= content.length - nextContent.length;
            working[index] = { ...working[index], content: nextContent };
        }
    }

    if (keptChars > maxChars && lastUserIndex >= 0 && retained.has(lastUserIndex)) {
        const content = stringifyContent(working[lastUserIndex].content);
        // 첨부파일([ATTACHED FILE:) 또는 워크스페이스 파일([WORKSPACE FILE:) 블록이 있으면
        // 최소 4,000자 이상 보존하여 AI가 파일 내용을 잃지 않도록 함
        const hasAttachedContent = /\[ATTACHED FILE:|\[WORKSPACE FILE:/i.test(content);
        const minRetain = hasAttachedContent ? 4_000 : 160;
        const targetChars = Math.max(minRetain, content.length - (keptChars - maxChars));
        const nextContent = truncateText(content, targetChars);
        keptChars -= content.length - nextContent.length;
        working[lastUserIndex] = { ...working[lastUserIndex], content: nextContent };
    }

    if (keptChars > maxChars) {
        for (const index of Array.from(retained).sort((a, b) => a - b)) {
            if (keptChars <= maxChars) {
                break;
            }
            if (index === lastUserIndex) {
                continue;
            }
            retained.delete(index);
            keptChars -= estimateMessageChars(working[index]);
            prunedMessages += 1;
        }
    }

    const finalMessages = working.filter((_, index) => retained.has(index));
    const finalChars = finalMessages.reduce((sum, message) => sum + estimateMessageChars(message), 0);

    return {
        messages: finalMessages,
        keptChars: finalChars,
        prunedMessages
    };
}
