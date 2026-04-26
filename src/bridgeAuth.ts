import * as crypto from 'crypto';
import type { IncomingHttpHeaders } from 'http';

export function isBridgeRequestAuthorized(headers: IncomingHttpHeaders, configuredToken: string): boolean {
    const token = configuredToken.trim();
    if (!token) {
        return true;
    }

    const headerToken = firstHeaderValue(headers['x-llem-token']);
    const bearerToken = parseBearerToken(firstHeaderValue(headers.authorization));
    return constantTimeEquals(headerToken, token) ||
        constantTimeEquals(bearerToken, token);
}

function firstHeaderValue(value: string | string[] | undefined): string {
    return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function parseBearerToken(value: string): string {
    const match = value.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : '';
}

function constantTimeEquals(a: string, b: string): boolean {
    if (!a || !b) {
        return false;
    }

    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}
