import { safeFetchWebText } from './security';
import type { ChatMessage } from './types';

export interface WebActionResult {
    report: string[];
    chatMessage?: ChatMessage;
}

const MAX_WEB_CONTEXT_CHARS = 2500;

function buildWebContextSnippet(content: string, limit = MAX_WEB_CONTEXT_CHARS): string {
    const text = String(content || '');
    if (text.length <= limit) {
        return text;
    }

    const head = text.slice(0, Math.floor(limit * 0.6));
    const tail = text.slice(-Math.floor(limit * 0.25));
    const omitted = text.length - head.length - tail.length;
    return `${head}\n\n... [omitted ${omitted} chars] ...\n\n${tail}`;
}

export async function executeReadUrlAction(url: string): Promise<WebActionResult> {
    try {
        const { finalUrl, text } = await safeFetchWebText(url);
        const cleaned = cleanHtmlText(text);
        const preview = cleaned.slice(0, 500);

        return {
            report: [`🌐 Read web: ${finalUrl} (${cleaned.length} chars)\n\`\`\`\n${preview}...\n\`\`\``],
            chatMessage: {
                role: 'user',
                content: `[SYSTEM: read_url result]\nURL: ${finalUrl}\nChars: ${cleaned.length}\n\`\`\`\n${buildWebContextSnippet(cleaned)}\n\`\`\``
            }
        };
    } catch (err: any) {
        return {
            report: [`❌ Web read failed: ${url} — ${err.message}`],
            chatMessage: {
                role: 'user',
                content: `[SYSTEM: read_url failed]\n${err.message}`
            }
        };
    }
}

export function cleanHtmlText(html: string): string {
    return String(html || '')
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
