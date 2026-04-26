import axios from 'axios';
import * as dns from 'dns';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';

const dnsLookup = dns.promises.lookup;
const MAX_WEB_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_WEB_REDIRECTS = 3;
const WEB_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

export interface SafePathResult {
    absPath: string;
    isVaultPath: boolean;
}

export interface WebFetchResult {
    finalUrl: string;
    text: string;
}

export interface SafePathOptions {
    extraAllowedRoots?: string[];
    vaultRoot?: string;
}

export async function safeResolveActionPath(
    workspaceRoot: string,
    requestedPath: string,
    options: SafePathOptions = {}
): Promise<SafePathResult> {
    const rawPath = String(requestedPath || '').trim();
    if (!rawPath) {
        throw new Error('empty path is not allowed');
    }
    if (rawPath.includes('\0')) {
        throw new Error('path contains an invalid null byte');
    }
    if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(rawPath) && !/^[a-zA-Z]:[\\/]/.test(rawPath)) {
        throw new Error('URL-style paths are not allowed');
    }

    const vaultDir = options.vaultRoot ? path.resolve(options.vaultRoot) : undefined;
    const allowedRoots = [workspaceRoot, ...(options.extraAllowedRoots ?? [])].map(root => path.resolve(root));
    const absPath = path.resolve(path.isAbsolute(rawPath) ? rawPath : path.join(workspaceRoot, rawPath));
    const matchedRoot = allowedRoots.find(root => isPathInside(absPath, root));

    if (!matchedRoot) {
        throw new Error('path escapes the workspace and configured vault');
    }

    await verifyRealParentInside(absPath, matchedRoot);

    return {
        absPath,
        isVaultPath: vaultDir ? isPathInside(absPath, vaultDir) : false
    };
}

export async function safeFetchWebText(rawUrl: string): Promise<WebFetchResult> {
    const url = parsePublicHttpUrl(rawUrl);
    return fetchPublicUrl(url, 0);
}

async function fetchPublicUrl(url: URL, redirectCount: number): Promise<WebFetchResult> {
    await assertPublicHostname(url.hostname);
    const response = await axios.get(url.toString(), {
        headers: { 'User-Agent': WEB_USER_AGENT },
        maxContentLength: MAX_WEB_RESPONSE_BYTES,
        maxRedirects: 0,
        responseType: 'text',
        timeout: 10000,
        transformResponse: data => data,
        validateStatus: status => (status >= 200 && status < 400)
    });

    if (response.status >= 300 && response.status < 400) {
        if (redirectCount >= MAX_WEB_REDIRECTS) {
            throw new Error('too many redirects');
        }

        const location = response.headers.location;
        if (!location) {
            throw new Error('redirect did not include a location');
        }

        const nextUrl = parsePublicHttpUrl(new URL(location, url).toString());
        return fetchPublicUrl(nextUrl, redirectCount + 1);
    }

    return {
        finalUrl: url.toString(),
        text: String(response.data || '')
    };
}

export function parsePublicHttpUrl(rawUrl: string): URL {
    let parsed: URL;
    try {
        parsed = new URL(String(rawUrl || '').trim());
    } catch {
        throw new Error('invalid URL');
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('only http and https URLs are allowed');
    }
    if (parsed.username || parsed.password) {
        throw new Error('URLs with embedded credentials are not allowed');
    }

    return parsed;
}

async function assertPublicHostname(hostname: string): Promise<void> {
    const normalizedHost = hostname.toLowerCase();
    if (!normalizedHost || normalizedHost === 'localhost' || normalizedHost.endsWith('.localhost')) {
        throw new Error('local hostnames are blocked');
    }

    const directIpVersion = net.isIP(normalizedHost);
    if (directIpVersion) {
        assertPublicIp(normalizedHost);
        return;
    }

    const records = await dnsLookup(normalizedHost, { all: true, verbatim: true });
    if (records.length === 0) {
        throw new Error('hostname did not resolve');
    }

    for (const record of records) {
        assertPublicIp(record.address);
    }
}

function assertPublicIp(address: string): void {
    if (isPrivateOrLocalIp(address)) {
        throw new Error('private and local network addresses are blocked');
    }
}

export function isPrivateOrLocalIp(address: string): boolean {
    const version = net.isIP(address);
    if (version === 4) {
        const parts = address.split('.').map(Number);
        const [a, b] = parts;
        return a === 0 ||
            a === 10 ||
            a === 127 ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 100 && b >= 64 && b <= 127) ||
            a >= 224;
    }

    if (version === 6) {
        const value = address.toLowerCase();
        return value === '::1' ||
            value === '::' ||
            value.startsWith('fc') ||
            value.startsWith('fd') ||
            value.startsWith('fe80:') ||
            value.startsWith('ff');
    }

    return true;
}

function isPathInside(childPath: string, parentPath: string): boolean {
    const child = normalizeForCompare(childPath);
    const parent = normalizeForCompare(parentPath);
    return child === parent || child.startsWith(`${parent}${path.sep}`);
}

async function verifyRealParentInside(targetPath: string, allowedRoot: string): Promise<void> {
    const realRoot = await fs.promises.realpath(allowedRoot).catch(() => path.resolve(allowedRoot));
    const existingParent = await findExistingParent(targetPath);
    const realParent = await fs.promises.realpath(existingParent);

    if (!isPathInside(realParent, realRoot)) {
        throw new Error('path resolves through a location outside the allowed root');
    }
}

async function findExistingParent(targetPath: string): Promise<string> {
    let current = path.dirname(targetPath);
    while (current && current !== path.dirname(current)) {
        try {
            const stat = await fs.promises.stat(current);
            if (stat.isDirectory()) {
                return current;
            }
        } catch {
            // Keep walking upward until an existing parent is found.
        }
        current = path.dirname(current);
    }
    return current;
}

function normalizeForCompare(value: string): string {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
