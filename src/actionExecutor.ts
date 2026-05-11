import * as path from 'path';
import * as vscode from 'vscode';
import { ActionLoopGuard } from './actionLoopGuard';
import { FileStateGuard } from './fileStateGuard';
import { getConfig, getVaultDir } from './config';
import { openDocument, resolveLlemPath } from './fsUtils';
import { PathValidationStatus, SafePathResult, safeResolveActionPath } from './security';
import { executeTerminalAction } from './terminalActions';
import { executeReadUrlAction } from './webActions';
import { getMcpManager } from './mcpManager';
import { logStructured } from './logger';
import {
    emptyFileActionResult,
    executeCreateFileAction,
    executeDeleteFileAction,
    executeEditFileAction,
    executeListFilesAction,
    executeReadFileAction,
    mergeFileActionResult,
    type FileChangeSummary,
    type FileActionResult
} from './fileActions';
import {
    parseCommandActions,
    parseCallMcpToolActions,
    parseCreateActions,
    parseDeleteActions,
    parseEditActions,
    parseFallbackFileBlocks,
    parseListActions,
    parseListMcpToolsActions,
    parseReadFileActions,
    parseUrlActions
} from './actionParser';
import { finalizeActionReport, type ActionReportContext } from './actionReport';
import type { ChatMessage } from './types';

export interface ActionExecutionHost {
    appendChatMessage(message: ChatMessage): void;
    injectSystemMessage(message: string): void;
    invalidateContextCaches(scope?: { workspace?: boolean; brain?: boolean }): void;
}

interface ActionHandlerContext extends ActionReportContext {
    aiMessage: string;
    rootPath: string;
    fileResult: FileActionResult;
}

type ActionHandler = (ctx: ActionHandlerContext) => Promise<void>;

const actionLoopGuard = new ActionLoopGuard();
// 5순위: 파일 수정 전후 해시 비교로 <find> 실패 즉시 감지
const fileStateGuard = new FileStateGuard();

function buildActionTraceId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function summarizeAiMessageForActions(aiMessage: string): Record<string, unknown> {
    return {
        chars: aiMessage.length,
        hasCreateTag: /<(?:create_file|file)\b/i.test(aiMessage),
        hasEditTag: /<(?:edit_file|edit)\b/i.test(aiMessage),
        hasFindTag: /<find>/i.test(aiMessage),
        hasReplaceTag: /<replace>/i.test(aiMessage),
        hasDeleteTag: /<(?:delete_file|delete)\b/i.test(aiMessage),
        hasReadTag: /<(?:read_file|read)\b/i.test(aiMessage),
        hasListTag: /<(?:list_files|list_dir|ls)\b/i.test(aiMessage),
        hasCommandTag: /<(?:run_command|command|bash|terminal)\b/i.test(aiMessage),
        preview: aiMessage.slice(0, 1200)
    };
}

function buildFileChangesReport(changes: FileChangeSummary[]): string | undefined {
    if (changes.length === 0) {
        return undefined;
    }

    const byPath = new Map<string, FileChangeSummary>();
    for (const change of changes) {
        const existing = byPath.get(change.path);
        if (!existing) {
            byPath.set(change.path, { ...change });
            continue;
        }

        existing.additions += change.additions;
        existing.deletions += change.deletions;
        if (existing.kind !== change.kind) {
            existing.kind = 'edited';
        }
    }

    const files = Array.from(byPath.values());
    const summary = {
        files,
        totalFiles: files.length,
        additions: files.reduce((sum, file) => sum + file.additions, 0),
        deletions: files.reduce((sum, file) => sum + file.deletions, 0)
    };

    return `@@LLEM_FILE_CHANGES ${JSON.stringify(summary)}`;
}

async function resolveActionPath(rootPath: string, requestedPath: string): Promise<SafePathResult> {
    return resolveLlemPath(rootPath, requestedPath);
}

function applyFileActionResult(ctx: ActionHandlerContext, result: FileActionResult): void {
    mergeFileActionResult(ctx.fileResult, result);
}

async function approveCommand(command: string): Promise<boolean> {
    const trimmed = command.trim();
    if (!trimmed) {
        return false;
    }

    const choice = await vscode.window.showWarningMessage(
        `Run this terminal command?\n\n${trimmed}`,
        { modal: true },
        'Run Command'
    );
    return choice === 'Run Command';
}

async function approveFileAction(actionType: string, filePath: string): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(
        `${actionType[0].toUpperCase()}${actionType.slice(1)} a file outside the workspace?\n\n${filePath}`,
        { modal: true },
        'Approve'
    );
    return choice === 'Approve';
}

const HANDLERS: ActionHandler[] = [
    async (ctx) => {
        for (const action of parseCreateActions(ctx.aiMessage)) {
            const validation = await resolveActionPath(ctx.rootPath, action.path);
            if (validation.status === 'forbidden') {
                ctx.fileResult.report.push(`❌ Create blocked: ${action.path} — security restriction (forbidden path).`);
                continue;
            }
            if (validation.status === 'out-of-scope') {
                const approved = await approveFileAction('create', validation.absPath);
                if (!approved) {
                    ctx.fileResult.report.push(`🛑 Action Denied: create ${action.path}`);
                    continue;
                }
            }

            if (actionLoopGuard.shouldBlock({ kind: 'create', path: action.path, body: action.body })) {
                ctx.fileResult.report.push(`⚠️ Create skipped: ${action.path} — repeated create action was blocked.`);
                continue;
            }
            applyFileActionResult(ctx, await executeCreateFileAction(action.path, action.body, async () => validation));
            if (!ctx.fileResult.report.some(item => item.includes(`❌ Create blocked: ${action.path}`) || item.includes(`❌ Create failed: ${action.path}`))) {
                actionLoopGuard.remember({ kind: 'create', path: action.path, body: action.body });
            }
        }
        if (ctx.fileResult.openFile) {
            await openDocument(vscode.Uri.file(ctx.fileResult.openFile));
            ctx.fileResult.openFile = undefined;
        }
    },
    async (ctx) => {
        for (const action of parseEditActions(ctx.aiMessage)) {
            const validation = await resolveActionPath(ctx.rootPath, action.path);
            if (validation.status === 'forbidden') {
                ctx.fileResult.report.push(`❌ Edit blocked: ${action.path} — security restriction (forbidden path).`);
                continue;
            }
            if (validation.status === 'out-of-scope') {
                const approved = await approveFileAction('edit', validation.absPath);
                if (!approved) {
                    ctx.fileResult.report.push(`🛑 Action Denied: edit ${action.path}`);
                    continue;
                }
            }

            if (actionLoopGuard.shouldBlock({ kind: 'edit', path: action.path, body: action.body })) {
                ctx.fileResult.report.push(`⚠️ Edit skipped: ${action.path} — repeated edit action was blocked.`);
                continue;
            }

            // 5순위: 수정 전 hash 스냅샷
            fileStateGuard.snapshot(validation.absPath);

            applyFileActionResult(ctx, await executeEditFileAction(action.path, action.body, async () => validation));

            // 5순위: 수정 후 hash 비교
            const editEffect = fileStateGuard.checkResult(validation.absPath);
            if (editEffect === 'no-effect') {
                ctx.fileResult.report.push(
                    `⚠️ Edit had no effect on ${action.path} — the <find> text may not match the current file content. ` +
                    `Try using <read_file> to get the current content first.`
                );
                // 🔧 추가: 다음 시도를 위해 현재 파일 상태를 스냅샷으로 저장
                fileStateGuard.snapshot(validation.absPath);
            } else if (editEffect === 'loop-detected') {
                ctx.fileResult.report.push(
                    `🛑 Edit loop detected on ${action.path} — same file edited repeatedly with no change. ` +
                    `Stopping to prevent infinite retries. ` +
                    `Please use <read_file> to verify current content and adjust your <find> text accordingly.`
                );
                actionLoopGuard.remember({ kind: 'edit', path: action.path, body: action.body });
                // 🔧 추가: 이 파일에 대한 편집 시도 무시 설정
                fileStateGuard.clearPath(validation.absPath);
                break;
            } else if (!ctx.fileResult.report.some(item => item.includes(`❌ Edit blocked: ${action.path}`) || item.includes(`❌ Edit failed: ${action.path}`))) {
                actionLoopGuard.remember({ kind: 'edit', path: action.path, body: action.body });
            }
        }
    },
    async (ctx) => {
        for (const action of parseDeleteActions(ctx.aiMessage)) {
            const validation = await resolveActionPath(ctx.rootPath, action.path);
            if (validation.status === 'forbidden') {
                ctx.fileResult.report.push(`❌ Delete blocked: ${action.path} — security restriction (forbidden path).`);
                continue;
            }
            if (validation.status === 'out-of-scope') {
                const approved = await approveFileAction('delete', validation.absPath);
                if (!approved) {
                    ctx.fileResult.report.push(`🛑 Action Denied: delete ${action.path}`);
                    continue;
                }
            }
            applyFileActionResult(ctx, await executeDeleteFileAction(action.path, async () => validation));
        }
    },
    async (ctx) => {
        for (const action of parseReadFileActions(ctx.aiMessage)) {
            const validation = await resolveActionPath(ctx.rootPath, action.path);
            if (validation.status === 'forbidden') {
                ctx.fileResult.report.push(`❌ Read blocked: ${action.path} — security restriction (forbidden path).`);
                continue;
            }
            if (validation.status === 'out-of-scope') {
                const approved = await approveFileAction('read', validation.absPath);
                if (!approved) {
                    ctx.fileResult.report.push(`🛑 Action Denied: read ${action.path}`);
                    continue;
                }
            }
            applyFileActionResult(ctx, await executeReadFileAction(action.path, async () => validation));
        }
    },
    async (ctx) => {
        for (const action of parseListActions(ctx.aiMessage)) {
            const validation = await resolveActionPath(ctx.rootPath, action.path);
            if (validation.status === 'forbidden') {
                ctx.fileResult.report.push(`❌ List blocked: ${action.path} — security restriction (forbidden path).`);
                continue;
            }
            if (validation.status === 'out-of-scope') {
                const approved = await approveFileAction('list', validation.absPath);
                if (!approved) {
                    ctx.fileResult.report.push(`🛑 Action Denied: list ${action.path}`);
                    continue;
                }
            }
            applyFileActionResult(ctx, await executeListFilesAction(action.path, async () => validation));
        }
    },
    async (ctx) => {
        for (const action of parseCommandActions(ctx.aiMessage)) {
            const result = await executeTerminalAction(action.text, ctx.rootPath, {
                approveCommand
            });
            ctx.report.push(...result.report);
        }
    },
    async (ctx) => {
        for (const action of parseUrlActions(ctx.aiMessage)) {
            const result = await executeReadUrlAction(action.text);
            ctx.report.push(...result.report);
            if (result.chatMessage) {
                ctx.host.appendChatMessage(result.chatMessage);
            }
        }
    },
    async (ctx) => {
        if (!getConfig().mcpEnabled) {
            if (parseListMcpToolsActions(ctx.aiMessage) || parseCallMcpToolActions(ctx.aiMessage).length > 0) {
                ctx.report.push('⚠️ MCP is disabled in settings.');
            }
            return;
        }

        const manager = getMcpManager(ctx.rootPath);
        if (parseListMcpToolsActions(ctx.aiMessage)) {
            const result = await manager.listTools();
            ctx.report.push(...result.report);
            ctx.host.appendChatMessage({
                role: 'user',
                content: `[SYSTEM: MCP tools available]\n${JSON.stringify(result.tools, null, 2)}`
            });
        }

        for (const action of parseCallMcpToolActions(ctx.aiMessage)) {
            let args: Record<string, unknown>;
            try {
                args = action.body.trim() ? JSON.parse(action.body) : {};
            } catch (error) {
                ctx.report.push(`❌ MCP tool call failed: ${action.server}.${action.tool} — invalid JSON arguments.`);
                continue;
            }

            const result = await manager.callTool(action.server, action.tool, args);
            ctx.report.push(result.ok
                ? `✅ MCP tool called: ${action.server}.${action.tool}`
                : `❌ MCP tool failed: ${action.server}.${action.tool} — ${result.text}`);
            ctx.host.appendChatMessage({
                role: 'user',
                content: `[SYSTEM: MCP tool result]\nserver=${action.server}\ntool=${action.tool}\nok=${result.ok}\n${result.text}`
            });
        }
    }
];

export async function executeActions(aiMessage: string, host: ActionExecutionHost): Promise<string[]> {
    const traceId = buildActionTraceId();
    let rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!rootPath && vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.scheme === 'file') {
        rootPath = path.dirname(vscode.window.activeTextEditor.document.uri.fsPath);
    }

    if (!rootPath) {
        const hasActions = /<(?:create_file|edit_file|run_command|delete_file|read_file|list_files|file)/i.test(aiMessage);
        if (hasActions) {
            logStructured('action.execute.no_workspace', {
                traceId,
                ...summarizeAiMessageForActions(aiMessage)
            });
        }
        return hasActions ? ['❌ No workspace is open. Open a folder first so LLeM has somewhere to work.'] : [];
    }

    const parsedCounts = {
        create: parseCreateActions(aiMessage).length,
        edit: parseEditActions(aiMessage).length,
        delete: parseDeleteActions(aiMessage).length,
        read: parseReadFileActions(aiMessage).length,
        list: parseListActions(aiMessage).length,
        command: parseCommandActions(aiMessage).length,
        url: parseUrlActions(aiMessage).length,
        mcpCall: parseCallMcpToolActions(aiMessage).length,
        mcpList: parseListMcpToolsActions(aiMessage),
        fallbackFileBlocks: parseFallbackFileBlocks(aiMessage).length
    };

    logStructured('action.execute.start', {
        traceId,
        rootPath,
        parsedCounts,
        ...summarizeAiMessageForActions(aiMessage)
    });

    const ctx: ActionHandlerContext = {
        aiMessage,
        rootPath,
        host,
        report: [],
        workspaceModified: false,
        brainModified: false,
        fileResult: emptyFileActionResult()
    };

    for (const handler of HANDLERS) {
        await handler(ctx);
    }

    if (ctx.fileResult.chatMessage) {
        host.appendChatMessage(ctx.fileResult.chatMessage);
    }

    ctx.report.push(...ctx.fileResult.report);
    ctx.workspaceModified = ctx.workspaceModified || ctx.fileResult.workspaceModified;
    ctx.brainModified = ctx.brainModified || ctx.fileResult.brainModified;

    if (ctx.report.length === 0) {
        for (const action of parseFallbackFileBlocks(aiMessage)) {
            const relPath = action.path;
            const content = action.body;
            if (relPath && content && relPath.includes('.')) {
                if (actionLoopGuard.shouldBlock({ kind: 'create', path: relPath, body: content })) {
                    ctx.fileResult.report.push(`⚠️ Create skipped: ${relPath} — repeated create action was blocked.`);
                    continue;
                }
                applyFileActionResult(ctx, await executeCreateFileAction(relPath, content, targetPath => resolveActionPath(ctx.rootPath, targetPath), 'Created (auto-detect)'));
                if (!ctx.fileResult.report.some(item => item.includes(`❌ Create blocked: ${relPath}`) || item.includes(`❌ Create failed: ${relPath}`))) {
                    actionLoopGuard.remember({ kind: 'create', path: relPath, body: content });
                }
            }
        }
        ctx.report.push(...ctx.fileResult.report);
        ctx.workspaceModified = ctx.workspaceModified || ctx.fileResult.workspaceModified;
        ctx.brainModified = ctx.brainModified || ctx.fileResult.brainModified;
        if (ctx.fileResult.openFile) {
            await openDocument(vscode.Uri.file(ctx.fileResult.openFile));
        }
    }

    const fileChangesReport = buildFileChangesReport(ctx.fileResult.changes);
    if (fileChangesReport) {
        ctx.report.push(fileChangesReport);
    }

    finalizeActionReport(ctx);

    logStructured('action.execute.end', {
        traceId,
        reportCount: ctx.report.length,
        workspaceModified: ctx.workspaceModified,
        brainModified: ctx.brainModified,
        reports: ctx.report
    });

    return ctx.report;
}
