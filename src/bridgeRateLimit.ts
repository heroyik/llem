export interface RateLimitResult {
    allowed: boolean;
    retryAfterMs: number;
}

interface RateBucket {
    count: number;
    resetAt: number;
}

export class FixedWindowRateLimiter {
    private readonly buckets = new Map<string, RateBucket>();

    constructor(
        private readonly maxRequests: number,
        private readonly windowMs: number,
        private readonly now: () => number = () => Date.now()
    ) {}

    check(key: string): RateLimitResult {
        const now = this.now();
        const existing = this.buckets.get(key);

        if (!existing || existing.resetAt <= now) {
            this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
            return { allowed: true, retryAfterMs: 0 };
        }

        if (existing.count >= this.maxRequests) {
            return { allowed: false, retryAfterMs: Math.max(0, existing.resetAt - now) };
        }

        existing.count += 1;
        return { allowed: true, retryAfterMs: 0 };
    }

    prune(): void {
        const now = this.now();
        for (const [key, bucket] of this.buckets) {
            if (bucket.resetAt <= now) {
                this.buckets.delete(key);
            }
        }
    }
}
