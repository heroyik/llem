import * as vscode from 'vscode';

export type MessageFeedback = 'like' | 'dislike';

interface StoredPreference {
    sourceKey: string;
    feedback: MessageFeedback;
    excerpt: string;
    updatedAt: number;
}

const STORAGE_KEY = 'responsePreferenceMemory';
const MAX_PREFERENCES = 24;
const EXCERPT_LIMIT = 220;

export class ResponsePreferenceManager {
    constructor(private readonly ctx: vscode.ExtensionContext) {}

    public getDirective(): string {
        const items = this.read();
        if (items.length === 0) {
            return '';
        }

        const liked = items.filter(item => item.feedback === 'like').slice(-8);
        const disliked = items.filter(item => item.feedback === 'dislike').slice(-8);
        const sections: string[] = [];

        if (liked.length > 0) {
            sections.push('Prefer answer styles similar to these examples the user liked:');
            sections.push(...liked.map(item => `- ${item.excerpt}`));
        }

        if (disliked.length > 0) {
            sections.push('Avoid answer styles similar to these examples the user disliked unless explicitly requested:');
            sections.push(...disliked.map(item => `- ${item.excerpt}`));
        }

        if (sections.length === 0) {
            return '';
        }

        return `\n\n[USER RESPONSE PREFERENCES]\nThese preferences persist across new chats and branches.\n${sections.join('\n')}`;
    }

    public async setFeedback(sourceKey: string, messageText: string, feedback: MessageFeedback | null): Promise<void> {
        const current = this.read();
        const withoutSource = current.filter(item => item.sourceKey !== sourceKey);

        if (!feedback) {
            await this.ctx.globalState.update(STORAGE_KEY, withoutSource);
            return;
        }

        const updated: StoredPreference = {
            sourceKey,
            feedback,
            excerpt: summarizeMessageForPreference(messageText),
            updatedAt: Date.now()
        };

        withoutSource.push(updated);
        withoutSource.sort((a, b) => a.updatedAt - b.updatedAt);
        const trimmed = withoutSource.slice(-MAX_PREFERENCES);
        await this.ctx.globalState.update(STORAGE_KEY, trimmed);
    }

    private read(): StoredPreference[] {
        const stored = this.ctx.globalState.get<StoredPreference[]>(STORAGE_KEY, []);
        return Array.isArray(stored) ? stored.filter(isStoredPreference) : [];
    }
}

function summarizeMessageForPreference(messageText: string): string {
    const compact = String(messageText || '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!compact) {
        return 'Empty response';
    }

    if (compact.length <= EXCERPT_LIMIT) {
        return compact;
    }

    return `${compact.slice(0, EXCERPT_LIMIT - 1).trim()}…`;
}

function isStoredPreference(value: StoredPreference | unknown): value is StoredPreference {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const item = value as StoredPreference;
    return typeof item.sourceKey === 'string'
        && (item.feedback === 'like' || item.feedback === 'dislike')
        && typeof item.excerpt === 'string'
        && typeof item.updatedAt === 'number';
}
