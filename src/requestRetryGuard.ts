import type { QueuedRequest } from './types';
import { buildQueuedRequestFingerprint } from './requestFingerprint';

interface RetryEntry {
    fingerprint: string;
    reason: string;
    retryCount: number;
    lastAttemptAt: number;
    expiresAt: number;
}

export class RequestRetryGuard {
    private blocked = new Map<string, RetryEntry>();

    constructor(private readonly ttlMs = 2 * 60 * 1000) {}

    public markRepeated(request: QueuedRequest, reason = 'repetition detected'): { retryAllowed: boolean; nextDelayMs: number } {
        const fingerprint = buildQueuedRequestFingerprint(request);
        const existing = this.blocked.get(fingerprint);
        
        const retryCount = (existing?.retryCount ?? 0) + 1;
        const lastAttemptAt = Date.now();
        
        // Tiered delays: 3s, 10s, 30s
        const delays = [3000, 10000, 30000];
        const nextDelayMs = retryCount <= delays.length ? delays[retryCount - 1] : 0;
        const retryAllowed = retryCount <= delays.length;

        this.blocked.set(fingerprint, {
            fingerprint,
            reason,
            retryCount,
            lastAttemptAt,
            expiresAt: Date.now() + (retryAllowed ? nextDelayMs + 5000 : this.ttlMs) 
        });

        return { retryAllowed, nextDelayMs };
    }

    public clearRetryHistory(request: QueuedRequest): void {
        const fingerprint = buildQueuedRequestFingerprint(request);
        this.blocked.delete(fingerprint);
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
