import type { QueuedRequest } from './types';
import { buildQueuedRequestFingerprint } from './requestFingerprint';

interface RetryEntry {
    fingerprint: string;
    reason: string;
    expiresAt: number;
}

export class RequestRetryGuard {
    private blocked = new Map<string, RetryEntry>();

    constructor(private readonly ttlMs = 2 * 60 * 1000) {}

    public markRepeated(request: QueuedRequest, reason = 'repetition detected'): void {
        const fingerprint = buildQueuedRequestFingerprint(request);
        this.blocked.set(fingerprint, {
            fingerprint,
            reason,
            expiresAt: Date.now() + this.ttlMs
        });
    }

    public shouldBlock(request: QueuedRequest): { blocked: boolean; reason?: string } {
        this.pruneExpired();
        const fingerprint = buildQueuedRequestFingerprint(request);
        const entry = this.blocked.get(fingerprint);
        if (!entry) {
            return { blocked: false };
        }
        return { blocked: true, reason: entry.reason };
    }

    public filterBlocked(requests: QueuedRequest[]): { allowed: QueuedRequest[]; blocked: QueuedRequest[] } {
        const allowed: QueuedRequest[] = [];
        const blocked: QueuedRequest[] = [];

        for (const request of requests) {
            if (this.shouldBlock(request).blocked) {
                blocked.push(request);
            } else {
                allowed.push(request);
            }
        }

        return { allowed, blocked };
    }

    private pruneExpired(): void {
        const now = Date.now();
        for (const [fingerprint, entry] of this.blocked.entries()) {
            if (entry.expiresAt <= now) {
                this.blocked.delete(fingerprint);
            }
        }
    }
}
