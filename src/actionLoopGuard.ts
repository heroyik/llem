import * as crypto from 'crypto';

export type GuardedActionKind = 'create' | 'edit';

export interface GuardedAction {
    kind: GuardedActionKind;
    path: string;
    body: string;
}

interface ActionEntry {
    fingerprint: string;
    expiresAt: number;
}

function normalizeText(value: string): string {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

export function buildActionFingerprint(action: GuardedAction): string {
    const bodyHash = crypto.createHash('md5')
        .update(action.body)
        .digest('hex')
        .slice(0, 8);
    
    return [
        action.kind,
        normalizeText(action.path),
        bodyHash
    ].join('::');
}

export class ActionLoopGuard {
    private entries = new Map<string, ActionEntry>();

    constructor(private readonly ttlMs = 120_000) {}

    public shouldBlock(action: GuardedAction): boolean {
        this.pruneExpired();
        return this.entries.has(buildActionFingerprint(action));
    }

    public remember(action: GuardedAction): void {
        const fingerprint = buildActionFingerprint(action);
        this.entries.set(fingerprint, {
            fingerprint,
            expiresAt: Date.now() + this.ttlMs
        });
    }

    private pruneExpired(): void {
        const now = Date.now();
        for (const [fingerprint, entry] of this.entries.entries()) {
            if (entry.expiresAt <= now) {
                this.entries.delete(fingerprint);
            }
        }
    }
}
