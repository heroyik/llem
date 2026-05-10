import * as fs from 'fs';
import * as path from 'path';
import { writeUtf8FileAtomic } from './atomicWrite';
import { FileMutationGuard } from './fileMutationGuard';
import { SafePathResult } from './security';
import { logStructured } from './logger';
import type { ChatMessage } from './types';

const EXCLUDED_DIRS = new Set([
    'node_modules', '.git', '.vscode', 'out', 'dist', 'build',
    '.next', '.cache', '__pycache__', '.DS_Store', 'coverage',
    '.turbo', '.nuxt', '.output', 'vendor', 'target'
]);

export interface FileActionResult {
    report: string[];
    workspaceModified: boolean;
    brainModified: boolean;
    openFile?: string;
    chatMessage?: ChatMessage;
    changes: FileChangeSummary[];
}

export type ResolveActionPath = (requestedPath: string) => Promise<SafePathResult>;

export interface FileChangeSummary {
    path: string;
    kind: 'created' | 'edited' | 'deleted';
    additions: number;
    deletions: number;
}

export interface FindReplaceResult {
    content: string;
    editCount: number;
    missingTargets: number;
    invalid?: string;
    pairs: FindReplacePairResult[];
}

export interface FindReplacePairResult {
    index: number;
    findChars: number;
    replaceChars: number;
    matched: boolean;
    findPreview: string;
}

const fileMutationGuard = new FileMutationGuard();
const MAX_CONTEXT_SNIPPET_CHARS = 2500;

function buildContextSnippet(content: string, limit = MAX_CONTEXT_SNIPPET_CHARS): string {
    const text = String(content || '');
    if (text.length <= limit) {
        return text;
    }

    const head = text.slice(0, Math.floor(limit * 0.6));
    const tail = text.slice(-Math.floor(limit * 0.25));
    const omitted = text.length - head.length - tail.length;
    return `${head}\n\n... [omitted ${omitted} chars] ...\n\n${tail}`;
}

export function emptyFileActionResult(): FileActionResult {
    return {
        report: [],
        workspaceModified: false,
        brainModified: false,
        changes: []
    };
}

export function mergeFileActionResult(target: FileActionResult, source: FileActionResult): FileActionResult {
    target.report.push(...source.report);
    target.workspaceModified = target.workspaceModified || source.workspaceModified;
    target.brainModified = target.brainModified || source.brainModified;
    target.openFile ??= source.openFile;
    target.changes.push(...source.changes);
    if (source.chatMessage) {
        target.chatMessage = source.chatMessage;
    }
    return target;
}

export async function executeCreateFileAction(
    relPath: string,
    content: string,
    resolvePath: ResolveActionPath,
    label = 'Created'
): Promise<FileActionResult> {
    try {
        const contentValidationError = validateCreateFileContent(content);
        if (contentValidationError) {
            logStructured('file.create.blocked.validation', {
                relPath,
                reason: contentValidationError,
                contentChars: content.length,
                contentPreview: previewForLog(content)
            });
            return {
                report: [`❌ Create blocked: ${relPath} — ${contentValidationError}`],
                workspaceModified: false,
                brainModified: false,
                changes: []
            };
        }
        const { absPath, isVaultPath } = await resolvePath(relPath);
        if (!fileMutationGuard.tryAcquire(absPath)) {
            return {
                report: [`⚠️ Create skipped: ${relPath} — another mutation is already in progress for this file.`],
                workspaceModified: false,
                brainModified: false,
                changes: []
            };
        }
        await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
        try {
            await writeUtf8FileAtomic(absPath, content);
        } finally {
            fileMutationGuard.release(absPath);
        }

        logStructured('file.create.success', {
            relPath,
            absPath,
            contentChars: content.length,
            isVaultPath
        });

        return {
            report: [`✅ ${label}: ${relPath}`],
            workspaceModified: true,
            brainModified: isVaultPath,
            openFile: absPath,
            changes: [{
                path: relPath,
                kind: 'created',
                additions: countLines(content),
                deletions: 0
            }]
        };
    } catch (err: any) {
        logStructured('file.create.failed', {
            relPath,
            error: err instanceof Error ? err.message : String(err)
        });
        return {
            report: [`❌ Create failed: ${relPath} — ${err.message}`],
            workspaceModified: false,
            brainModified: false,
            changes: []
        };
    }
}

export async function executeEditFileAction(
    relPath: string,
    body: string,
    resolvePath: ResolveActionPath
): Promise<FileActionResult> {
    let safePath: SafePathResult;
    try {
        safePath = await resolvePath(relPath);
    } catch (err: any) {
        return {
            report: [`❌ Edit blocked: ${relPath} — ${err.message}`],
            workspaceModified: false,
            brainModified: false,
            changes: []
        };
    }

    if (!(await pathExists(safePath.absPath))) {
        logStructured('file.edit.failed.missing_file', {
            relPath,
            absPath: safePath.absPath
        });
        return {
            report: [`❌ Edit failed: ${relPath} — file does not exist.`],
            workspaceModified: false,
            brainModified: false,
            changes: []
        };
    }

    try {
        const stat = await fs.promises.stat(safePath.absPath);
        if (!stat.isFile()) {
            logStructured('file.edit.blocked.not_file', {
                relPath,
                absPath: safePath.absPath
            });
            return {
                report: [`❌ Edit blocked: ${relPath} — target is not a file.`],
                workspaceModified: false,
                brainModified: false,
                changes: []
            };
        }

        const originalContent = await fs.promises.readFile(safePath.absPath, 'utf-8');
        const edited = applyFindReplacePairs(originalContent, body);
        if (edited.invalid) {
            logStructured('file.edit.blocked.invalid_body', {
                relPath,
                absPath: safePath.absPath,
                reason: edited.invalid,
                bodyChars: body.length,
                bodyPreview: previewForLog(body),
                pairs: edited.pairs
            });
            return {
                report: [`❌ Edit blocked: ${relPath} — ${edited.invalid}`],
                workspaceModified: false,
                brainModified: false,
                changes: []
            };
        }
        const report: string[] = [];

        for (let i = 0; i < edited.missingTargets; i += 1) {
            report.push(`❌ Edit failed: ${relPath} — replacement 0/${edited.pairs.length}; the <find> text did not match the current file content.`);
        }

        if (edited.editCount === 0) {
            logStructured('file.edit.no_replacements', {
                relPath,
                absPath: safePath.absPath,
                originalChars: originalContent.length,
                bodyChars: body.length,
                missingTargets: edited.missingTargets,
                pairs: edited.pairs,
                originalPreview: previewForLog(originalContent),
                bodyPreview: previewForLog(body)
            });
            return {
                report,
                workspaceModified: false,
                brainModified: false,
                changes: [],
                chatMessage: {
                    role: 'user',
                    content: `[SYSTEM: Edit failed — <find> text mismatch in ${relPath}.]\n\nCorrect file content is below. RE-ISSUE your <edit_file> using EXACT text matching.\n\n\`\`\`\n${buildContextSnippet(originalContent)}\n\`\`\``
                }
            };
        }

        if (!fileMutationGuard.tryAcquire(safePath.absPath)) {
            return {
                report: [`⚠️ Edit skipped: ${relPath} — another mutation is already in progress for this file.`],
                workspaceModified: false,
                brainModified: false,
                changes: []
            };
        }
        try {
            await writeUtf8FileAtomic(safePath.absPath, edited.content, stat.mode);
        } finally {
            fileMutationGuard.release(safePath.absPath);
        }
        report.push(`✏️ Edited: ${relPath} (${edited.editCount} replacement${edited.editCount === 1 ? '' : 's'})`);
        const lineDelta = countLineDelta(originalContent, edited.content);

        logStructured('file.edit.success', {
            relPath,
            absPath: safePath.absPath,
            originalChars: originalContent.length,
            editedChars: edited.content.length,
            editCount: edited.editCount,
            missingTargets: edited.missingTargets,
            pairs: edited.pairs
        });

        return {
            report,
            workspaceModified: true,
            brainModified: safePath.isVaultPath,
            openFile: safePath.absPath,
            changes: [{
                path: relPath,
                kind: 'edited',
                additions: lineDelta.additions,
                deletions: lineDelta.deletions
            }]
        };
    } catch (err: any) {
        logStructured('file.edit.failed.exception', {
            relPath,
            error: err instanceof Error ? err.message : String(err)
        });
        return {
            report: [`❌ Edit failed: ${relPath} — ${err.message}`],
            workspaceModified: false,
            brainModified: false,
            changes: []
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
                brainModified: false,
                changes: []
            };
        }

        const stat = await fs.promises.stat(absPath);
        if (stat.isDirectory()) {
            return {
                report: [`❌ Delete blocked: ${relPath} — directory deletion is not allowed from model actions.`],
                workspaceModified: false,
                brainModified: false,
                changes: []
            };
        }

        const originalContent = await fs.promises.readFile(absPath, 'utf-8').catch(() => '');
        await fs.promises.unlink(absPath);
        return {
            report: [`🗑️ Deleted: ${relPath}`],
            workspaceModified: true,
            brainModified: isVaultPath,
            changes: [{
                path: relPath,
                kind: 'deleted',
                additions: 0,
                deletions: countLines(originalContent)
            }]
        };
    } catch (err: any) {
        return {
            report: [`❌ Delete failed: ${relPath} — ${err.message}`],
            workspaceModified: false,
            brainModified: false,
            changes: []
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
                brainModified: false,
                changes: []
            };
        }

        const content = await fs.promises.readFile(absPath, 'utf-8');
        const preview = content.slice(0, 500).split('\n').slice(0, 10).join('\n');

        return {
            report: [`📖 Read: ${relPath} (${content.length} chars)\n\`\`\`\n${preview}...\n\`\`\``],
            workspaceModified: false,
            brainModified: false,
            changes: [],
            chatMessage: {
                role: 'user',
                content: `[SYSTEM: read_file result]\nFile: ${relPath}\nChars: ${content.length}\n\`\`\`\n${buildContextSnippet(content)}\n\`\`\``
            }
        };
    } catch (err: any) {
        return {
            report: [`❌ Read failed: ${relPath} — ${err.message}`],
            workspaceModified: false,
            brainModified: false,
            changes: []
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
                brainModified: false,
                changes: []
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
            changes: [],
            chatMessage: {
                role: 'user',
                content: `[SYSTEM: list_files result]\nDirectory: ${relDir}/\n${listing}`
            }
        };
    } catch (err: any) {
        return {
            report: [`❌ List failed: ${relDir} — ${err.message}`],
            workspaceModified: false,
            brainModified: false,
            changes: []
        };
    }
}

export function applyFindReplacePairs(content: string, body: string): FindReplaceResult {
    const bodyValidationError = validateEditActionBody(body);
    if (bodyValidationError) {
        return {
            content,
            editCount: 0,
            missingTargets: 0,
            invalid: bodyValidationError,
            pairs: []
        };
    }

    const findReplaceRegex = /<find>([\s\S]*?)<\/find>\s*<replace>([\s\S]*?)<\/replace>/g;
    let result = content;
    let editCount = 0;
    let missingTargets = 0;
    const pairs: FindReplacePairResult[] = [];
    let match: RegExpExecArray | null;
    let index = 0;

    while ((match = findReplaceRegex.exec(body)) !== null) {
        const findText = match[1];
        const replaceText = match[2];
        const matched = result.includes(findText);
        pairs.push({
            index,
            findChars: findText.length,
            replaceChars: replaceText.length,
            matched,
            findPreview: previewForLog(findText)
        });
        if (matched) {
            result = result.replace(findText, replaceText);
            editCount += 1;
        } else {
            missingTargets += 1;
        }
        index += 1;
    }

    return {
        content: result,
        editCount,
        missingTargets,
        pairs
    };
}

function validateEditActionBody(body: string): string | undefined {
    const text = String(body || '');
    const openFind = countTagOccurrences(text, /<find>/g);
    const closeFind = countTagOccurrences(text, /<\/find>/g);
    const openReplace = countTagOccurrences(text, /<replace>/g);
    const closeReplace = countTagOccurrences(text, /<\/replace>/g);

    if (openFind !== closeFind) {
        return 'incomplete <find> block.';
    }
    if (openReplace !== closeReplace) {
        return 'incomplete <replace> block.';
    }
    if (openFind !== openReplace) {
        return 'each <find> must have a matching <replace>.';
    }
    if (openFind === 0) {
        return 'no valid <find>/<replace> pairs were provided.';
    }

    return undefined;
}

function countTagOccurrences(text: string, regex: RegExp): number {
    return (text.match(regex) || []).length;
}

function validateCreateFileContent(content: string): string | undefined {
    const text = String(content || '');
    if (!text.trim()) {
        return 'generated content was empty.';
    }

    const fenceCount = countTagOccurrences(text, /```/g);
    if (fenceCount % 2 !== 0) {
        return 'generated content appears truncated (unbalanced code fence).';
    }

    return undefined;
}

function previewForLog(value: string, limit = 500): string {
    const text = String(value || '');
    if (text.length <= limit) {
        return text;
    }
    return `${text.slice(0, limit)}... [truncated ${text.length - limit} chars]`;
}

function countLines(content: string): number {
    if (!content) {
        return 0;
    }
    return content.replace(/\r\n/g, '\n').split('\n').length;
}

function countLineDelta(before: string, after: string): { additions: number; deletions: number } {
    const beforeLines = before.replace(/\r\n/g, '\n').split('\n');
    const afterLines = after.replace(/\r\n/g, '\n').split('\n');
    let prefix = 0;
    while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) {
        prefix += 1;
    }

    let beforeSuffix = beforeLines.length - 1;
    let afterSuffix = afterLines.length - 1;
    while (beforeSuffix >= prefix && afterSuffix >= prefix && beforeLines[beforeSuffix] === afterLines[afterSuffix]) {
        beforeSuffix -= 1;
        afterSuffix -= 1;
    }

    return {
        additions: Math.max(0, afterSuffix - prefix + 1),
        deletions: Math.max(0, beforeSuffix - prefix + 1)
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
