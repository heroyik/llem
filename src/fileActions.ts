import * as fs from 'fs';
import * as path from 'path';
import { writeUtf8FileAtomic } from './atomicWrite';
import type { ChatMessage } from './types';

const EXCLUDED_DIRS = new Set([
    'node_modules', '.git', '.vscode', 'out', 'dist', 'build',
    '.next', '.cache', '__pycache__', '.DS_Store', 'coverage',
    '.turbo', '.nuxt', '.output', 'vendor', 'target'
]);

export interface ResolvedActionPath {
    absPath: string;
    isVaultPath: boolean;
}

export interface FileActionResult {
    report: string[];
    workspaceModified: boolean;
    brainModified: boolean;
    openFile?: string;
    chatMessage?: ChatMessage;
}

export type ResolveActionPath = (requestedPath: string) => Promise<ResolvedActionPath>;

export interface FindReplaceResult {
    content: string;
    editCount: number;
    missingTargets: number;
}

export function emptyFileActionResult(): FileActionResult {
    return {
        report: [],
        workspaceModified: false,
        brainModified: false
    };
}

export function mergeFileActionResult(target: FileActionResult, source: FileActionResult): FileActionResult {
    target.report.push(...source.report);
    target.workspaceModified = target.workspaceModified || source.workspaceModified;
    target.brainModified = target.brainModified || source.brainModified;
    target.openFile ??= source.openFile;
    target.chatMessage ??= source.chatMessage;
    return target;
}

export async function executeCreateFileAction(
    relPath: string,
    content: string,
    resolvePath: ResolveActionPath,
    label = 'Created'
): Promise<FileActionResult> {
    try {
        const { absPath, isVaultPath } = await resolvePath(relPath);
        await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
        await writeUtf8FileAtomic(absPath, content);

        return {
            report: [`✅ ${label}: ${relPath}`],
            workspaceModified: true,
            brainModified: isVaultPath,
            openFile: absPath
        };
    } catch (err: any) {
        return {
            report: [`❌ Create failed: ${relPath} — ${err.message}`],
            workspaceModified: false,
            brainModified: false
        };
    }
}

export async function executeEditFileAction(
    relPath: string,
    body: string,
    resolvePath: ResolveActionPath
): Promise<FileActionResult> {
    let safePath: ResolvedActionPath;
    try {
        safePath = await resolvePath(relPath);
    } catch (err: any) {
        return {
            report: [`❌ Edit blocked: ${relPath} — ${err.message}`],
            workspaceModified: false,
            brainModified: false
        };
    }

    if (!(await pathExists(safePath.absPath))) {
        return {
            report: [`❌ Edit failed: ${relPath} — file does not exist.`],
            workspaceModified: false,
            brainModified: false
        };
    }

    try {
        const stat = await fs.promises.stat(safePath.absPath);
        if (!stat.isFile()) {
            return {
                report: [`❌ Edit blocked: ${relPath} — target is not a file.`],
                workspaceModified: false,
                brainModified: false
            };
        }

        const originalContent = await fs.promises.readFile(safePath.absPath, 'utf-8');
        const edited = applyFindReplacePairs(originalContent, body);
        const report: string[] = [];

        for (let i = 0; i < edited.missingTargets; i += 1) {
            report.push(`⚠️ ${relPath}: could not find the target text.`);
        }

        if (edited.editCount === 0) {
            return {
                report,
                workspaceModified: false,
                brainModified: false
            };
        }

        await writeUtf8FileAtomic(safePath.absPath, edited.content, stat.mode);
        report.push(`✏️ Edited: ${relPath} (${edited.editCount} replacement${edited.editCount === 1 ? '' : 's'})`);

        return {
            report,
            workspaceModified: true,
            brainModified: safePath.isVaultPath,
            openFile: safePath.absPath
        };
    } catch (err: any) {
        return {
            report: [`❌ Edit failed: ${relPath} — ${err.message}`],
            workspaceModified: false,
            brainModified: false
        };
    }
}

export async function executeDeleteFileAction(
    relPath: string,
    resolvePath: ResolveActionPath
): Promise<FileActionResult> {
    try {
        const { absPath, isVaultPath } = await resolvePath(relPath);
        if (!(await pathExists(absPath))) {
            return {
                report: [`⚠️ Delete skipped: ${relPath} — file does not exist.`],
                workspaceModified: false,
                brainModified: false
            };
        }

        const stat = await fs.promises.stat(absPath);
        if (stat.isDirectory()) {
            return {
                report: [`❌ Delete blocked: ${relPath} — directory deletion is not allowed from model actions.`],
                workspaceModified: false,
                brainModified: false
            };
        }

        await fs.promises.unlink(absPath);
        return {
            report: [`🗑️ Deleted: ${relPath}`],
            workspaceModified: true,
            brainModified: isVaultPath
        };
    } catch (err: any) {
        return {
            report: [`❌ Delete failed: ${relPath} — ${err.message}`],
            workspaceModified: false,
            brainModified: false
        };
    }
}

export async function executeReadFileAction(
    relPath: string,
    resolvePath: ResolveActionPath
): Promise<FileActionResult> {
    try {
        const { absPath } = await resolvePath(relPath);
        if (!(await pathExists(absPath))) {
            return {
                report: [`⚠️ Read failed: ${relPath} — file does not exist.`],
                workspaceModified: false,
                brainModified: false
            };
        }

        const content = await fs.promises.readFile(absPath, 'utf-8');
        const preview = content.slice(0, 500).split('\n').slice(0, 10).join('\n');

        return {
            report: [`📖 Read: ${relPath} (${content.length} chars)\n\`\`\`\n${preview}...\n\`\`\``],
            workspaceModified: false,
            brainModified: false,
            chatMessage: {
                role: 'user',
                content: `[SYSTEM: read_file result]\nFile: ${relPath}\n\`\`\`\n${content.slice(0, 10000)}\n\`\`\``
            }
        };
    } catch (err: any) {
        return {
            report: [`❌ Read failed: ${relPath} — ${err.message}`],
            workspaceModified: false,
            brainModified: false
        };
    }
}

export async function executeListFilesAction(
    relDir: string,
    resolvePath: ResolveActionPath
): Promise<FileActionResult> {
    try {
        const { absPath: absDir } = await resolvePath(relDir);
        const dirStat = await fs.promises.stat(absDir).catch(() => undefined);
        if (!dirStat?.isDirectory()) {
            return {
                report: [`⚠️ List failed: ${relDir} — directory does not exist.`],
                workspaceModified: false,
                brainModified: false
            };
        }

        const entries = await fs.promises.readdir(absDir, { withFileTypes: true });
        const listing = entries
            .filter(entry => !entry.name.startsWith('.') && !EXCLUDED_DIRS.has(entry.name))
            .map(entry => entry.isDirectory() ? `📁 ${entry.name}/` : `📄 ${entry.name}`)
            .join('\n');

        return {
            report: [`📂 Listed: ${relDir}/\n\`\`\`\n${listing}\n\`\`\``],
            workspaceModified: false,
            brainModified: false,
            chatMessage: {
                role: 'user',
                content: `[SYSTEM: list_files result]\nDirectory: ${relDir}/\n${listing}`
            }
        };
    } catch (err: any) {
        return {
            report: [`❌ List failed: ${relDir} — ${err.message}`],
            workspaceModified: false,
            brainModified: false
        };
    }
}

export function applyFindReplacePairs(content: string, body: string): FindReplaceResult {
    const findReplaceRegex = /<find>([\s\S]*?)<\/find>\s*<replace>([\s\S]*?)<\/replace>/g;
    let result = content;
    let editCount = 0;
    let missingTargets = 0;
    let match: RegExpExecArray | null;

    while ((match = findReplaceRegex.exec(body)) !== null) {
        const findText = match[1];
        const replaceText = match[2];
        if (result.includes(findText)) {
            result = result.replace(findText, replaceText);
            editCount += 1;
        } else {
            missingTargets += 1;
        }
    }

    return {
        content: result,
        editCount,
        missingTargets
    };
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fs.promises.access(filePath);
        return true;
    } catch {
        return false;
    }
}
