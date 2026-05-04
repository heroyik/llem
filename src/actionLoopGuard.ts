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
    return [
        action.kind,
        normalizeText(action.path),
        normalizeText(action.body)
    ].join('::');
}

export class ActionLoopGuard {
    private entries = new Map<string, ActionEntry>();

    constructor(private readonly ttlMs = 90_000) {}

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
