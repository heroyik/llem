import * as path from 'path';
import * as vscode from 'vscode';
import { ActionLoopGuard } from './actionLoopGuard';
import { FileStateGuard } from './fileStateGuard';
import { getVaultDir } from './config';
import { openDocument, resolveLlemPath } from './fsUtils';
import { PathValidationStatus, SafePathResult, safeResolveActionPath } from './security';
import { executeTerminalAction } from './terminalActions';
import { executeReadUrlAction } from './webActions';
import {
    emptyFileActionResult,
    executeCreateFileAction,
    executeDeleteFileAction,
    executeEditFileAction,
    executeListFilesAction,
    executeReadFileAction,
    mergeFileActionResult,
    type FileActionResult
} from './fileActions';
import {
    parseCommandActions,
    parseCreateActions,
    parseDeleteActions,
    parseEditActions,
    parseFallbackFileBlocks,
    parseListActions,
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
        `LLeM wants to run this terminal command:\n\n${trimmed}`,
        { modal: true },
        'Run Command'
    );
    return choice === 'Run Command';
}

async function approveFileAction(actionType: string, filePath: string): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(
        `LLeM wants to ${actionType} a file outside the workspace:\n\n${filePath}`,
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
                    `🛑 Edit loop detected on ${action.path} — same file edited 5 times with no change. ` +
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
    }
];

export async function executeActions(aiMessage: string, host: ActionExecutionHost): Promise<string[]> {
    let rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!rootPath && vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.scheme === 'file') {
        rootPath = path.dirname(vscode.window.activeTextEditor.document.uri.fsPath);
    }

    if (!rootPath) {
        const hasActions = /<(?:create_file|edit_file|run_command|delete_file|read_file|list_files|file)/i.test(aiMessage);
        return hasActions ? ['❌ No workspace is open. Open a folder first so LLeM has somewhere to work.'] : [];
    }

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

    finalizeActionReport(ctx);

    return ctx.report;
}
