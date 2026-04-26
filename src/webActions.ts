import { safeFetchWebText } from './security';
import type { ChatMessage } from './types';

export interface WebActionResult {
    report: string[];
    chatMessage?: ChatMessage;
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
                content: `[SYSTEM: read_url result]\nURL: ${finalUrl}\n\`\`\`\n${cleaned.slice(0, 15000)}\n\`\`\``
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
