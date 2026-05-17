import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ResolvedMcpServerConfig } from '../types';

const SYNCED_MCP_FILE = 'llem-mcp-synced.json';
const DEFAULT_STORAGE_DIR = path.join(os.homedir(), '.llem');

let storageRoot: string | undefined;

export function initMcpStorage(rootPath: string | undefined): void {
    storageRoot = rootPath || DEFAULT_STORAGE_DIR;
}

export function getSyncedMcpStoragePath(): string | undefined {
    return path.join(storageRoot || DEFAULT_STORAGE_DIR, SYNCED_MCP_FILE);
}

export async function readSyncedMcpServers(): Promise<Record<string, ResolvedMcpServerConfig>> {
    const filePath = getSyncedMcpStoragePath();
    if (!filePath || !fs.existsSync(filePath)) {
        return {};
    }
    const parsed = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

export async function writeSyncedMcpServers(servers: Record<string, ResolvedMcpServerConfig>): Promise<void> {
    const filePath = getSyncedMcpStoragePath();
    if (!filePath) {
        throw new Error('LLeM MCP storage is not initialized.');
    }
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, `${JSON.stringify(servers, null, 2)}\n`, 'utf8');
}
