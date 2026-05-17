import * as path from 'path';
import * as vscode from 'vscode';
import { getLlemSettings } from '../config';
import { normalizeMcpServer, toSettingsObject } from './mcpConfig';
import { safeFetchWebText } from '../security';
import type { ResolvedMcpServerConfig } from '../types';

interface GitHubRepoRef {
    owner: string;
    repo: string;
}

export interface McpImportCandidate {
    name: string;
    server: ResolvedMcpServerConfig;
    confidence: 'high' | 'medium' | 'low';
    reason: string;
}

export function parseGitHubRepoUrl(rawUrl: string): GitHubRepoRef {
    const url = new URL(String(rawUrl || '').trim());
    if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
        throw new Error('Only github.com URLs are supported.');
    }
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) {
        throw new Error('GitHub URL must include owner and repo.');
    }
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
}

export async function importMcpFromGitHubUrl(rawUrl?: string): Promise<string> {
    const url = rawUrl || await vscode.window.showInputBox({
        prompt: 'Paste an MCP GitHub repository URL',
        placeHolder: 'https://github.com/owner/mcp-server'
    });
    if (!url) {
        return 'MCP GitHub import cancelled.';
    }
    const candidates = await discoverMcpCandidatesFromGitHub(url);
    if (candidates.length === 0) {
        return 'No usable MCP server config was found in that GitHub repository.';
    }

    const pick = await vscode.window.showQuickPick(candidates.map(candidate => ({
        label: candidate.name,
        description: `${candidate.confidence}: ${candidate.reason}`,
        candidate
    })), { placeHolder: 'Pick MCP config to import' });
    if (!pick) {
        return 'MCP GitHub import cancelled.';
    }

    const preview = formatCandidatePreview(pick.candidate);
    const approve = await vscode.window.showWarningMessage(preview, { modal: true }, 'Import MCP Server');
    if (approve !== 'Import MCP Server') {
        return 'MCP GitHub import not applied.';
    }

    const current = getLlemSettings().get<Record<string, unknown>>('mcpServers', {});
    const next = {
        ...current,
        ...toSettingsObject({ [pick.candidate.name]: pick.candidate.server })
    };
    await getLlemSettings().update('mcpServers', next, vscode.ConfigurationTarget.Global);
    return `Imported MCP server from GitHub: ${pick.candidate.name}`;
}

export async function discoverMcpCandidatesFromGitHub(rawUrl: string): Promise<McpImportCandidate[]> {
    const repo = parseGitHubRepoUrl(rawUrl);
    const base = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/HEAD`;
    const docs = await fetchCandidateDocs(base);
    const candidates: McpImportCandidate[] = [];

    for (const doc of docs) {
        candidates.push(...extractConfigBlocks(doc.text, `${repo.repo}-${doc.name}`, rawUrl));
    }

    const packageDoc = docs.find(doc => doc.name === 'package.json');
    if (packageDoc) {
        try {
            const pkg = JSON.parse(packageDoc.text);
            if (pkg.name) {
                const server = normalizeMcpServer(safeServerName(pkg.name), {
                    command: 'npx',
                    args: ['-y', pkg.name],
                    enabled: true,
                    sourceKind: 'github',
                    sourcePath: rawUrl
                }, 'github', rawUrl);
                if (server) {
                    candidates.push({ name: server.name, server, confidence: 'medium', reason: 'package.json npm package fallback' });
                }
            }
        } catch {
            // Ignore invalid package JSON.
        }
    }

    return dedupeCandidates(candidates);
}

async function fetchCandidateDocs(base: string): Promise<Array<{ name: string; text: string }>> {
    const names = ['README.md', 'package.json', '.mcp.json', 'mcp.json', '.cursor/mcp.json', '.vscode/mcp.json', 'docs/mcp.md', 'docs/install.md', 'docs/installation.md'];
    const docs: Array<{ name: string; text: string }> = [];
    for (const name of names) {
        try {
            const { text } = await safeFetchWebText(`${base}/${name}`);
            docs.push({ name, text });
        } catch {
            // Missing docs are expected.
        }
    }
    return docs;
}

function extractConfigBlocks(text: string, fallbackName: string, sourcePath: string): McpImportCandidate[] {
    const candidates: McpImportCandidate[] = [];
    for (const match of text.matchAll(/```(?:json|toml)?\s*([\s\S]*?)```/gi)) {
        const block = match[1].trim();
        if (!/mcp_servers|mcpServers|command|args|npx|uvx/i.test(block)) {
            continue;
        }
        candidates.push(...extractJsonConfig(block, sourcePath));
        candidates.push(...extractCommandConfig(block, fallbackName, sourcePath));
    }
    candidates.push(...extractCommandConfig(text, fallbackName, sourcePath));
    return candidates;
}

function extractJsonConfig(block: string, sourcePath: string): McpImportCandidate[] {
    try {
        const parsed = JSON.parse(block);
        const rawServers = parsed.mcpServers || parsed.servers || {};
        return Object.entries(rawServers).map(([name, raw]) => {
            const server = normalizeMcpServer(name, raw, 'github', sourcePath);
            return server ? { name, server: { ...server, sourceKind: 'github' as const, sourcePath }, confidence: 'high' as const, reason: 'README JSON MCP config block' } : undefined;
        }).filter(Boolean) as McpImportCandidate[];
    } catch {
        return [];
    }
}

function extractCommandConfig(text: string, fallbackName: string, sourcePath: string): McpImportCandidate[] {
    const candidates: McpImportCandidate[] = [];
    const patterns = [
        /\bnpx\s+(?:-y\s+)?(@?[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+)([^\n\r`]*)/gi,
        /\buvx\s+([A-Za-z0-9_.-]+)([^\n\r`]*)/gi
    ];
    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
            const command = match[0].trim().startsWith('uvx') ? 'uvx' : 'npx';
            const pkg = match[1];
            const args = command === 'npx' ? ['-y', pkg] : [pkg];
            const server = normalizeMcpServer(safeServerName(pkg || fallbackName), { command, args, enabled: true }, 'github', sourcePath);
            if (server) {
                candidates.push({ name: server.name, server, confidence: 'medium', reason: `${command} install/run command found` });
            }
        }
    }
    return candidates;
}

function dedupeCandidates(candidates: McpImportCandidate[]): McpImportCandidate[] {
    const seen = new Set<string>();
    const result: McpImportCandidate[] = [];
    for (const candidate of candidates) {
        const key = `${candidate.name}:${candidate.server.command}:${candidate.server.args.join(' ')}`;
        if (!seen.has(key)) {
            seen.add(key);
            result.push(candidate);
        }
    }
    return result.sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence) || a.name.localeCompare(b.name));
}

function confidenceRank(value: McpImportCandidate['confidence']): number {
    return value === 'high' ? 3 : value === 'medium' ? 2 : 1;
}

function safeServerName(value: string): string {
    return path.basename(value.replace(/^@/, '').replace('/', '-')).replace(/[^A-Za-z0-9_.-]/g, '-').replace(/^-+|-+$/g, '') || 'github-mcp';
}

function formatCandidatePreview(candidate: McpImportCandidate): string {
    const command = [candidate.server.command, ...candidate.server.args].filter(Boolean).join(' ');
    return `Import MCP server "${candidate.name}"?\n\n${command}\n\nSource: ${candidate.server.sourcePath}`;
}
