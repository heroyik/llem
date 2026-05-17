import * as path from 'path';
import * as vscode from 'vscode';
import { ActionLoopGuard } from './actionLoopGuard';
import { FileStateGuard } from './fileStateGuard';
import { getConfig, getVaultDir } from './config';
import { openDocument, resolveLlemPath } from './fsUtils';
import { PathValidationStatus, SafePathResult, safeResolveActionPath } from './security';
import { executeTerminalAction } from './terminalActions';
import { executeReadUrlAction } from './webActions';
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
    parseCreateActions,
    parseDeleteActions,
    parseEditActions,
    parseFallbackFileBlocks,
    parseCallMcpToolActions,
    parseListActions,
    parseListMcpToolsActions,
    parseMcpSlashCommandActions,
    parseReadFileActions,
    parseUrlActions
} from './actionParser';
import { finalizeActionReport, type ActionReportContext } from './actionReport';
import { summarizeBlockedPlanActions, type ExecutionMode } from './executionMode';
import type { ChatMessage } from './types';

interface ResolvedMcpToolTarget {
    server: string;
    tool: string;
    report: string[];
}

export interface ActionExecutionHost {
    appendChatMessage(message: ChatMessage): void;
    injectSystemMessage(message: string): void;
    invalidateContextCaches(scope?: { workspace?: boolean; brain?: boolean }): void;
    listMcpTools?(): Promise<{ tools: any[]; report: string[] }>;
    callMcpTool?(server: string, tool: string, args: Record<string, unknown>): Promise<{ ok: boolean; content?: unknown; error?: string }>;
    getExecutionMode?(): ExecutionMode;
}

interface ActionHandlerContext extends ActionReportContext {
    aiMessage: string;
    rootPath: string;
    executionMode: ExecutionMode;
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
        hasMcpTag: /<(?:list_mcp_tools|call_mcp_tool)\b|(?:^|\n)[ \t]*\/[A-Za-z][A-Za-z0-9_-]*/i.test(aiMessage),
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

async function resolveMcpToolTarget(
    ctx: ActionHandlerContext,
    requestedServer: string,
    requestedTool: string
): Promise<ResolvedMcpToolTarget | undefined> {
    const server = requestedServer.trim();
    const tool = requestedTool.trim();
    if (server && !/^serverName$/i.test(server)) {
        return { server, tool, report: [] };
    }
    if (!ctx.host.listMcpTools) {
        return { server, tool, report: [] };
    }

    const listed = await ctx.host.listMcpTools();
    const matches = listed.tools.filter(item => String(item.name || '') === tool);
    if (matches.length === 1) {
        return {
            server: String(matches[0].server),
            tool,
            report: [...listed.report, `🔌 MCP placeholder server resolved: ${server || 'missing'}.${tool} → ${matches[0].server}.${tool}`]
        };
    }
    if (matches.length > 1) {
        return {
            server,
            tool,
            report: [...listed.report, `❌ MCP tool call skipped: ${tool} exists on multiple servers (${matches.map(item => item.server).join(', ')}). Use an explicit server.`]
        };
    }
    return {
        server,
        tool,
        report: [...listed.report, `❌ MCP tool call skipped: ${server || 'missing'}.${tool} could not be resolved to an available MCP tool.`]
    };
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
        if (ctx.executionMode === 'plan') {
            return;
        }
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
        if (ctx.executionMode === 'plan') {
            return;
        }
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
        if (ctx.executionMode === 'plan') {
            return;
        }
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
        if (ctx.executionMode === 'plan') {
            return;
        }
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
        for (const _action of parseListMcpToolsActions(ctx.aiMessage)) {
            if (!ctx.host.listMcpTools) {
                ctx.report.push('❌ MCP tools are not available in this LLeM host.');
                continue;
            }
            const result = await ctx.host.listMcpTools();
            ctx.report.push(...result.report);
            ctx.host.appendChatMessage({
                role: 'user',
                content: `[SYSTEM: MCP tools]\n${JSON.stringify(result.tools, null, 2)}`
            });
        }
    },
    async (ctx) => {
        if (ctx.executionMode === 'plan') {
            return;
        }
        for (const action of parseCallMcpToolActions(ctx.aiMessage)) {
            if (!ctx.host.callMcpTool) {
                ctx.report.push('❌ MCP tool calls are not available in this LLeM host.');
                continue;
            }
            let args: Record<string, unknown>;
            try {
                args = action.body.trim() ? JSON.parse(action.body) : {};
            } catch (err) {
                ctx.report.push(`❌ MCP tool call skipped: invalid JSON args for ${action.server}.${action.tool}.`);
                continue;
            }
            const target = await resolveMcpToolTarget(ctx, action.server, action.tool);
            if (!target || target.report.some(item => item.startsWith('❌'))) {
                ctx.report.push(...(target?.report || []));
                continue;
            }
            ctx.report.push(...target.report);
            const result = await ctx.host.callMcpTool(target.server, target.tool, args);
            if (result.ok) {
                ctx.report.push(`🔌 MCP tool called: ${target.server}.${target.tool}`);
                ctx.host.appendChatMessage({
                    role: 'user',
                    content: `[SYSTEM: MCP tool result]\nServer: ${target.server}\nTool: ${target.tool}\n\`\`\`json\n${JSON.stringify(result.content, null, 2)}\n\`\`\``
                });
            } else {
                ctx.report.push(`❌ MCP tool failed: ${target.server}.${target.tool} — ${result.error || 'unknown error'}`);
            }
        }
    },
    async (ctx) => {
        if (ctx.executionMode === 'plan') {
            return;
        }
        const actions = parseMcpSlashCommandActions(ctx.aiMessage);
        if (actions.length === 0) {
            return;
        }
        if (!ctx.host.listMcpTools || !ctx.host.callMcpTool) {
            ctx.report.push('❌ MCP slash commands are not available in this LLeM host.');
            return;
        }

        const listed = await ctx.host.listMcpTools();
        ctx.report.push(...listed.report);
        for (const action of actions) {
            const matches = listed.tools.filter(tool => String(tool.name || '') === action.command);
            if (matches.length === 0) {
                ctx.report.push(`❌ MCP slash command not found: /${action.command}`);
                continue;
            }
            if (matches.length > 1) {
                ctx.report.push(`❌ MCP slash command is ambiguous: /${action.command} exists on ${matches.map(tool => tool.server).join(', ')}.`);
                continue;
            }

            let args: Record<string, unknown>;
            try {
                args = action.body ? JSON.parse(action.body) : {};
            } catch {
                ctx.report.push(`❌ MCP slash command skipped: invalid JSON args for /${action.command}.`);
                continue;
            }

            const tool = matches[0];
            const result = await ctx.host.callMcpTool(String(tool.server), action.command, args);
            if (result.ok) {
                ctx.report.push(`🔌 MCP slash command called: /${action.command} (${tool.server}.${action.command})`);
                ctx.host.appendChatMessage({
                    role: 'user',
                    content: `[SYSTEM: MCP slash command result]\nCommand: /${action.command}\nServer: ${tool.server}\nTool: ${action.command}\n\`\`\`json\n${JSON.stringify(result.content, null, 2)}\n\`\`\``
                });
            } else {
                ctx.report.push(`❌ MCP slash command failed: /${action.command} — ${result.error || 'unknown error'}`);
            }
        }
    }
];

export async function executeActions(aiMessage: string, host: ActionExecutionHost): Promise<string[]> {
    const traceId = buildActionTraceId();
    const executionMode = host.getExecutionMode?.() ?? 'default';
    let rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!rootPath && vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.scheme === 'file') {
        rootPath = path.dirname(vscode.window.activeTextEditor.document.uri.fsPath);
    }

    if (!rootPath) {
        const hasActions = /<(?:create_file|edit_file|run_command|delete_file|read_file|list_files|file|list_mcp_tools|call_mcp_tool)/i.test(aiMessage) ||
            parseMcpSlashCommandActions(aiMessage).length > 0;
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
        listMcpTools: parseListMcpToolsActions(aiMessage).length,
        callMcpTool: parseCallMcpToolActions(aiMessage).length,
        mcpSlashCommand: parseMcpSlashCommandActions(aiMessage).length,
        fallbackFileBlocks: parseFallbackFileBlocks(aiMessage).length
    };

    if (executionMode === 'plan') {
        const blockedPlanActions = summarizeBlockedPlanActions(parsedCounts);
        if (blockedPlanActions.length > 0) {
            logStructured('action.execute.plan_block', {
                traceId,
                rootPath,
                parsedCounts,
                blockedPlanActions
            });
        }
    }

    logStructured('action.execute.start', {
        traceId,
        rootPath,
        parsedCounts,
        executionMode,
        ...summarizeAiMessageForActions(aiMessage)
    });

    const ctx: ActionHandlerContext = {
        aiMessage,
        rootPath,
        executionMode,
        host,
        report: [],
        workspaceModified: false,
        brainModified: false,
        fileResult: emptyFileActionResult()
    };

    if (executionMode === 'plan') {
        const blockedPlanActions = summarizeBlockedPlanActions(parsedCounts);
        if (blockedPlanActions.length > 0) {
            ctx.report.push(`🛑 Plan Mode blocked execution: ${blockedPlanActions.join(', ')}. Approve the plan or switch to Agent Mode to implement it.`);
        }
    }

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
        if (executionMode === 'plan' && parseFallbackFileBlocks(aiMessage).length > 0) {
            ctx.report.push('🛑 Plan Mode blocked inferred file creation. Approve the plan or switch to Agent Mode to implement it.');
        }
        for (const action of parseFallbackFileBlocks(aiMessage)) {
            if (executionMode === 'plan') {
                continue;
            }
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
