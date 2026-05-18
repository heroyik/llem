import * as vscode from 'vscode';
import * as path from 'path';
import { getLlemSettings, getVaultDir, getConfig } from './config';
import { executeActions } from './actionExecutor';
import { parseMcpSlashCommandActions } from './actionParser';
import { SYSTEM_PROMPT } from './prompts';
import { getChatWebviewHtml } from './webviewHtml';
import { ContextBuilder } from './contextBuilder';
import { ChatSession } from './chatSession';
import { HistoryManager } from './historyManager';
import { ChatPipeline } from './chatPipeline';
import { handleBrainMenu, handleInjectLocalBrain } from './brainCommands';
import type { BrainCommandsHost } from './brainCommands';
import { getInstalledModels, runFirstRunSetup } from './modelDiscovery';
import { handleSettingsMenu } from './settingsCommands';
import type { SettingsCommandsHost } from './settingsCommands';
import { routeWebviewMessage } from './webviewMessageRouter';
import type { WebviewMessageRouterHost } from './webviewMessageRouter';
import type {
    AttachedFile,
    ChatMessage,
    ModelProfile,
    QueuedRequest,
    QueueRequestKind,
    QueueRequestSummary,
    QueueStatePayload
} from './types';
import { openDocument, resolveLlemPath } from './fsUtils';
import { getLlemChannel } from './terminalManager';
import { logInfo, logError } from './logger';
import { isEditableFilePath, resolveEditableWorkspacePath } from './editableFiles';
import { ResponsePreferenceManager } from './responsePreferenceManager';
import type { MessageFeedback } from './responsePreferenceManager';
import { RequestRetryGuard } from './requestRetryGuard';
import { McpManager } from './mcp/mcpManager';
import { syncCodexMcpServers } from './mcp/mcpCodexSync';
import { importMcpFromGitHubUrl } from './mcp/mcpGithubImport';
import { listMcpServerUiState, setGlobalMcpEnabled, setMcpServerEnabled } from './mcp/mcpServerControl';
import { executionModeLabel, normalizeExecutionMode, type ExecutionMode } from './executionMode';
import { PerfLogger, type PerfMetrics } from './perfLogger';
import {
    cancelPendingRequest,
    clearPendingRequests,
    createRequestQueueState,
    enqueueRequest as enqueueQueueState,
    finishActiveRequest,
    movePendingRequest,
    pauseQueue,
    promoteNextRequest,
    resetQueueState,
    resumeQueue as resumeQueueState,
    type RequestQueueState
} from './queueState';

type ChatWebviewSurface = vscode.WebviewView | vscode.WebviewPanel;

const MAX_DROPPED_IMAGE_BYTES = 8 * 1024 * 1024;

function extractMcpTextParts(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .flatMap(item => extractMcpTextParts(item))
            .filter(Boolean);
    }
    if (!value || typeof value !== 'object') {
        return [];
    }

    const record = value as { type?: unknown; text?: unknown; content?: unknown };
    const directText = record.type === 'text' && typeof record.text === 'string'
        ? [record.text]
        : [];
    return [
        ...directText,
        ...extractMcpTextParts(record.content)
    ];
}

function renderMcpSlashResultMessage(content: string): string | undefined {
    if (!content.startsWith('[SYSTEM: MCP slash command result]')) {
        return undefined;
    }
    const commandMatch = content.match(/^Command:\s*\/([^\s]+)/m);
    const command = commandMatch ? commandMatch[1].replace(/-/g, '_') : '';
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(jsonMatch[1]);
        const textParts = extractMcpTextParts(parsed);
        if (textParts.length > 0) {
            const text = textParts.join('\n\n');
            if (command === 'ctx_stats') {
                return `\`\`\`text\n${text}\n\`\`\``;
            }
            return text;
        }
        return `\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
    } catch {
        return undefined;
    }
}

function collectMcpSlashResultMessages(messages: ChatMessage[], startIndex: number): string[] {
    return messages
        .slice(startIndex)
        .filter(message => message.role === 'user')
        .map(message => renderMcpSlashResultMessage(message.content))
        .filter((message): message is string => !!message);
}

function formatApproxKb(chars: number): string {
    if (!Number.isFinite(chars) || chars <= 0) {
        return '0 KB';
    }
    const kb = chars / 1024;
    return kb >= 10 ? `${kb.toFixed(1)} KB` : `${kb.toFixed(2)} KB`;
}

function formatMs(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) {
        return '0 ms';
    }
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms.toFixed(1)} ms`;
}

function countRole(messages: Array<{ role?: string }>, role: string): number {
    return messages.filter(message => message.role === role).length;
}
const MAX_DROPPED_TEXT_BYTES = 512 * 1024;
const IMAGE_ATTACHMENT_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const AUDIO_ATTACHMENT_EXTENSIONS = new Set(['mp3', 'wav', 'ogg']);
const TEXT_ATTACHMENT_EXTENSIONS = new Set([
    'txt', 'md', 'csv', 'json',
    'js', 'ts', 'html', 'css',
    'py', 'java', 'rs', 'go',
    'yaml', 'yml', 'xml', 'toml'
]);

function cleanDroppedUriString(uriString: string): string {
    return String(uriString || '').trim().replace(/^["']|["']$/g, '');
}

function parseDroppedUri(uriString: string): vscode.Uri {
    const rawUriString = cleanDroppedUriString(uriString);
    if (/^[a-zA-Z]:[\\/]/.test(rawUriString) || /^\\\\/.test(rawUriString)) {
        return vscode.Uri.file(rawUriString);
    }

    try {
        const uri = vscode.Uri.parse(rawUriString, true);
        if (!uri.scheme) {
            return vscode.Uri.file(rawUriString);
        }
        return uri;
    } catch (_error) {
        return vscode.Uri.file(rawUriString);
    }
}

function droppedUriKey(uri: vscode.Uri): string {
    if (uri.scheme === 'file') {
        return `file:${uri.fsPath.toLowerCase()}`;
    }
    return uri.toString(true).toLowerCase();
}

function basenameFromUri(uri: vscode.Uri): string {
    const pathName = uri.path.split('/').pop() || '';
    return pathName || 'file';
}

function extensionFromName(name: string): string {
    const dotIndex = name.lastIndexOf('.');
    return dotIndex >= 0 ? name.slice(dotIndex + 1).toLowerCase() : '';
}

function attachmentTypeFromName(name: string): string {
    const ext = extensionFromName(name);
    if (ext === 'jpg' || ext === 'jpeg') {
        return 'image/jpeg';
    }
    if (ext === 'svg') {
        return 'image/svg+xml';
    }
    if (['png', 'gif', 'webp'].includes(ext)) {
        return `image/${ext}`;
    }
    if (ext === 'mp3') {
        return 'audio/mpeg';
    }
    if (['wav', 'ogg'].includes(ext)) {
        return `audio/${ext}`;
    }
    return 'text/plain';
}

function isSupportedDroppedAttachment(name: string): boolean {
    const ext = extensionFromName(name);
    return IMAGE_ATTACHMENT_EXTENSIONS.has(ext) ||
        AUDIO_ATTACHMENT_EXTENSIONS.has(ext) ||
        TEXT_ATTACHMENT_EXTENSIONS.has(ext);
}

function droppedAttachmentLimit(type: string): number {
    return type.startsWith('image/') ? MAX_DROPPED_IMAGE_BYTES : MAX_DROPPED_TEXT_BYTES;
}

function summarizeDropError(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
    }
    return String(error);
}

function isSafeAttachmentLookupName(name: string): boolean {
    return Boolean(name) &&
        !/[{}[\]*?]/.test(name);
}

export const LLEM_VIEW_ID = 'llem.chat';
export const LLEM_VIEW_CONTAINER_COMMAND = 'workbench.view.extension.llem';

export class SidebarChatProvider implements vscode.WebviewViewProvider {
    private _view?: ChatWebviewSurface;
    private _panel?: vscode.WebviewPanel;
    private _ctx: vscode.ExtensionContext;

    private _isSyncingBrain: boolean = false;
    public _brainEnabled: boolean = true;
    private _isProcessingQueue: boolean = false;
    private _activeRequestPromise: Promise<void> | undefined;
    private _queueCheckTimer: NodeJS.Timeout | undefined;
    private _abortController: AbortController | undefined;
    private _queueState: RequestQueueState = createRequestQueueState();
    private _lastPrompt?: string;
    private _lastModel?: string;
    private _lastFiles?: AttachedFile[];
    private _lastInternetEnabled?: boolean;
    private _executionMode: ExecutionMode;

    private _temperature: number;
    private _topP: number;
    private _topK: number;
    private _systemPrompt: string;
    private readonly _contextBuilder = new ContextBuilder();
    private readonly _chatSession: ChatSession;
    private readonly _historyManager: HistoryManager;
    private readonly _chatPipeline: ChatPipeline;
    private readonly _responsePreferenceManager: ResponsePreferenceManager;
    private readonly _requestRetryGuard = new RequestRetryGuard();
    private readonly _mcpManager = new McpManager();
    private _setupStarted = false;
    private readonly _largeModelWarningsShown = new Set<string>();

    constructor(private readonly _extensionUri: vscode.Uri, ctx: vscode.ExtensionContext) {
        this._ctx = ctx;
        this._temperature = ctx.globalState.get<number>('aiTemperature', 0.8);
        this._topP = ctx.globalState.get<number>('aiTopP', 0.9);
        this._topK = ctx.globalState.get<number>('aiTopK', 40);
        this._systemPrompt = ctx.globalState.get<string>('aiSystemPrompt', SYSTEM_PROMPT);
        this._executionMode = normalizeExecutionMode(ctx.globalState.get<string>('executionMode', 'default'));
        this._historyManager = new HistoryManager(ctx);
        this._chatSession = new ChatSession(ctx, () => this._systemPrompt);
        this._responsePreferenceManager = new ResponsePreferenceManager(ctx);
        this._chatPipeline = new ChatPipeline({
            buildRequestMessages: (options) => this._buildRequestMessages(options),
            executeActions: (aiMessage) => this._executeActions(aiMessage),
            getChatHistory: () => this._chatSession.chatHistory,
            getDisplayMessages: () => this._chatSession.displayMessages,
            getExecutionMode: () => this._executionMode,
            getTemperature: () => this._temperature,
            getTopK: () => this._topK,
            getTopP: () => this._topP,
            postWebviewMessage: (message) => this._view?.webview.postMessage(message),
            readBrainFile: (filename) => this._contextBuilder.readBrainFile(filename),
            saveHistory: async () => this.saveHistory(),
            setAbortController: (controller) => { this._abortController = controller; },
            setLastPrompt: (prompt, modelName, files, internetEnabled) => {
                this._lastPrompt = prompt;
                this._lastModel = modelName;
                this._lastFiles = files?.map(file => ({ ...file }));
                this._lastInternetEnabled = internetEnabled;
            },
            warnLargeModelTimeout: (profile, timeoutMs) => this._warnLargeModelTimeout(profile, timeoutMs)
        });
        this._brainEnabled = this._ctx.globalState.get<boolean>('brainEnabled', true);
        this._registerContextInvalidation();
        this._loadLastSession();
    }

    private async _loadLastSession(): Promise<void> {
        try {
            const history = await this._historyManager.listSessions();
            if (history.length > 0) {
                const sessionData = await this._historyManager.getSession(history[0].id);
                if (sessionData) {
                    this._chatSession.load(sessionData);
                    logInfo('[HISTORY] Auto-loaded most recent session: ' + history[0].id);
                }
            }
        } catch (err) {
            logError('[HISTORY] Failed to auto-load last session: ' + (err instanceof Error ? err.message : String(err)));
        }
    }

    private _registerContextInvalidation(): void {
        this._ctx.subscriptions.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this.invalidateContextCaches({ workspace: true });
            }),
            vscode.workspace.onDidSaveTextDocument((document) => {
                if (document.uri.scheme !== 'file') {
                    return;
                }

                const filePath = document.uri.fsPath;
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (workspaceRoot && filePath.startsWith(workspaceRoot)) {
                    this.invalidateContextCaches({ workspace: true });
                }
                if (filePath.startsWith(getVaultDir())) {
                    this.invalidateContextCaches({ brain: true });
                }
            }),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('llem.vaultPath')) {
                    this.invalidateContextCaches({ brain: true });
                }
            }),
            vscode.workspace.onDidCreateFiles(() => this._sendWorkspaceFiles()),
            vscode.workspace.onDidDeleteFiles(() => this._sendWorkspaceFiles()),
            vscode.workspace.onDidRenameFiles(() => this._sendWorkspaceFiles())
        );
    }

    public invalidateContextCaches(scope: { workspace?: boolean; brain?: boolean } = { workspace: true, brain: true }): void {
        this._contextBuilder.invalidate(scope);
    }

    public ensureFirstRunSetup(): void {
        const currentVersion = this._ctx.extension.packageJSON.version;
        const lastSetupVersion = this._ctx.globalState.get<string>('lastSetupVersion');

        if (this._setupStarted) {
            return;
        }

        // Run if setup not complete OR if we just updated to a new version (to ensure new defaults)
        if (!this._ctx.globalState.get('setupComplete') || lastSetupVersion !== currentVersion) {
            this._setupStarted = true;
            this._ctx.globalState.update('lastSetupVersion', currentVersion);
            void runFirstRunSetup(this._ctx);
        }
    }

    public async resetChat() {
        logInfo('[NEW CHAT] resetChat() called (history length=' + this._chatSession.chatHistory.length + ', display length=' + this._chatSession.displayMessages.length + ')');
        await this._resetQueueState({ abortActive: true });
        if (this._chatSession.displayMessages.length > 0) {
            try {
                logInfo('[NEW CHAT] Saving current session before reset (id=' + this._chatSession.id + ')');
                await this._historyManager.saveSession(this._chatSession);
            } catch (err) {
                logError('[NEW CHAT] Failed to save session during reset. Proceeding with reset anyway. ' + (err instanceof Error ? err.message : String(err)));
            }
        } else {
            logInfo('[NEW CHAT] Skipping save for empty session');
        }
        this._chatSession.reset();
        this._lastPrompt = undefined;
        this._lastModel = undefined;
        this._lastFiles = undefined;
        this._lastInternetEnabled = undefined;
        this._view?.webview.postMessage({ type: 'clearChat' });
        this._syncQueueStateToWebview();
        logInfo('[NEW CHAT] clearChat posted to webview — new thread ready');
    }

    public async deleteHistory(id: string) {
        logInfo('[HISTORY] deleteHistory(' + id + ') requested');
        try {
            await this._historyManager.deleteSession(id);
            logInfo('[HISTORY] Session ' + id + ' deleted from disk');
            if (this._chatSession.id === id) {
                logInfo('[HISTORY] Deleting current active session — resetting chat');
                await this.resetChat();
            }
            logInfo('[HISTORY] Refreshing history list after deletion');
            await this.getHistory();
        } catch (err) {
            logError('[HISTORY] Failed to delete session ' + id + ': ' + (err instanceof Error ? err.message : String(err)));
        }
    }

    public async deleteAllHistory() {
        logInfo('[HISTORY] deleteAllHistory() requested');
        try {
            await this._historyManager.clearAll();
            logInfo('[HISTORY] All sessions deleted from disk');
            await this.resetChat();
            logInfo('[HISTORY] Refreshing history list after bulk deletion');
            await this.getHistory();
        } catch (err) {
            logError('[HISTORY] Failed to clear all history: ' + (err instanceof Error ? err.message : String(err)));
        }
    }

    public async exportChat() {
        await this._chatSession.exportMarkdown();
    }

    public async focusInput(): Promise<void> {
        if (!this._view) {
            await this.openChatPanel();
        }

        this._revealSurface(false);
        setTimeout(() => {
            this._view?.webview.postMessage({ type: 'focusInput' });
        }, 50);
    }

    public getHistoryText(): string {
        return this._chatSession.getHistoryText();
    }

    public async injectSystemMessage(message: string): Promise<void> {
        if (!this._view) {
            await this.openChatPanel();
        }

        this._view?.webview.postMessage({ type: 'response', value: message });
        this._chatSession.appendAssistantMessage(message);
    }

    public async sendPromptFromExtension(prompt: string): Promise<void> {
        if (!this._view) {
            await this.openChatPanel();
        }

        this._revealSurface(false);
        setTimeout(() => {
            this._view?.webview.postMessage({ type: 'injectPrompt', value: prompt });
        }, 300);
    }

    public async openChatPanel(): Promise<void> {
        try {
            await vscode.commands.executeCommand(LLEM_VIEW_CONTAINER_COMMAND);
            this._revealSurface(false);
            return;
        } catch (error) {
            console.warn('Secondary sidebar view could not be opened, falling back to editor panel.', error);
        }

        if (this._panel) {
            this._view = this._panel;
            this._panel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'llem-chat',
            'LLeM',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this._extensionUri],
            }
        );

        this._panel = panel;
        this._attachWebviewSurface(panel);
        panel.onDidDispose(() => {
            if (this._view === panel) {
                this._view = undefined;
            }
            this._panel = undefined;
        });
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._attachWebviewSurface(webviewView);
    }

    private _attachWebviewSurface(surface: ChatWebviewSurface): void {
        logInfo('[WEBVIEW] Attaching webview surface');
        this._view = surface;
        this.ensureFirstRunSetup();
        surface.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        surface.webview.onDidReceiveMessage(async (msg) => {
            if (msg.type === 'ready') {
                this._sendWorkspaceFiles();
            }
            if (msg.type !== 'log') {
                logInfo('[MSG→] Received from webview: ' + msg.type);
            }
            await routeWebviewMessage(msg, this._webviewMessageRouterHost());
        });

        surface.webview.html = this._getHtml(surface.webview);
        this._syncQueueStateToWebview();
        logInfo('[WEBVIEW] Webview surface ready, HTML injected');
    }

    private _revealSurface(preserveFocus: boolean): void {
        if (!this._view) {
            return;
        }

        if ('show' in this._view) {
            this._view.show?.(preserveFocus);
            return;
        }

        this._view.reveal(undefined, preserveFocus);
    }

    private _webviewMessageRouterHost(): WebviewMessageRouterHost {
        return {
            handleBrainMenu: () => this._handleBrainMenu(),
            handleInjectLocalBrain: (files) => this._handleInjectLocalBrain(files),
            handleSettingsMenu: () => this._handleSettingsMenu(),
            resetChat: () => this.resetChat(),
            restoreDisplayMessages: () => {
                this._restoreDisplayMessages();
                this._sendExecutionMode();
            },
            sendModels: () => this._sendModels(),
            showBrainNetwork: () => vscode.commands.executeCommand('llem.showVaultMap'),
            showTerminal: () => this._showTerminal(),
            reviewChanges: () => this._reviewChanges(),
            stopGeneration: () => this._stopGeneration(),
            openExternalUrl: (url) => this._openExternalUrl(url),
            fetchUris: (uris, requestId) => this._fetchUris(uris, requestId),
            openAttachment: (file) => this._openAttachment(file),
            branchChat: (messageIndex) => this._branchChat(messageIndex),
            enqueueRequest: (request) => this._enqueueWebviewRequest(request),
            cancelQueuedRequest: (id) => this._cancelQueuedRequest(id),
            clearQueuedRequests: () => this._clearQueuedRequests(),
            moveQueuedRequest: (id, direction) => this._moveQueuedRequest(id, direction),
            editQueuedRequest: (id) => this._editQueuedRequest(id),
            resumeQueue: () => this._resumeQueue(),
            setMessageFeedback: (messageIndex, feedback) => this._setMessageFeedback(messageIndex, feedback),
            getHistory: () => this.getHistory(),
            loadHistory: (id) => this.loadHistory(id),
            deleteHistory: (id) => this.deleteHistory(id),
            deleteAllHistory: () => this.deleteAllHistory(),
            requestDeleteHistory: (id, title) => this.requestDeleteHistory(id, title),
            requestClearAllHistory: () => this.requestClearAllHistory(),
            getWorkspaceFiles: () => this._sendWorkspaceFiles(),
            getMcpServers: () => this._sendMcpServers(),
            setGlobalMcpEnabled: (enabled) => this._setGlobalMcpEnabled(enabled),
            setMcpServerEnabled: (name, enabled) => this._setMcpServerEnabled(name, enabled),
            reloadMcpServers: () => this.reloadMcpServers(),
            syncCodexMcpServers: () => this.syncCodexMcpServers(),
            importMcpFromGitHub: () => this.importMcpFromGitHub(),
            setDefaultModel: (modelName) => this._setDefaultModel(modelName),
            setExecutionMode: (mode) => this.setExecutionMode(mode),
            log: (message, level) => {
                if (level === 'error') logError(message, false);
                else logInfo(message);
            }
        };
    }

    private _createQueuedRequest(input: {
        kind: QueueRequestKind;
        prompt: string;
        modelName: string;
        files?: AttachedFile[];
        internetEnabled?: boolean;
        messageIndex?: number;
    }): QueuedRequest {
        return {
            id: `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            kind: input.kind,
            prompt: input.prompt,
            modelName: input.modelName,
            files: input.files?.map(file => ({ ...file })),
            internetEnabled: input.internetEnabled,
            messageIndex: input.messageIndex,
            createdAt: Date.now()
        };
    }

    private _summarizeQueuedRequest(request: QueuedRequest): QueueRequestSummary {
        return {
            id: request.id,
            kind: request.kind,
            prompt: request.prompt,
            modelName: request.modelName,
            internetEnabled: request.internetEnabled,
            messageIndex: request.messageIndex,
            createdAt: request.createdAt,
            attachmentCount: request.files?.length || 0
        };
    }

    private _queueStatePayload(): QueueStatePayload {
        return {
            running: Boolean(this._queueState.activeRequest),
            paused: this._queueState.paused,
            activeRequest: this._queueState.activeRequest ? this._summarizeQueuedRequest(this._queueState.activeRequest) : undefined,
            pendingRequests: this._queueState.pendingRequests.map(request => this._summarizeQueuedRequest(request))
        };
    }

    private _syncQueueStateToWebview(): void {
        this._view?.webview.postMessage({ type: 'queueState', value: this._queueStatePayload() });
    }

    private async _enqueueWebviewRequest(input: {
        kind?: QueueRequestKind;
        prompt?: string;
        modelName?: string;
        files?: AttachedFile[];
        internetEnabled?: boolean;
        messageIndex?: number;
    }): Promise<void> {
        const files = input.files || [];
        const kind = input.kind === 'prompt' && files.length > 0 ? 'promptWithFile' : input.kind;
        if (!kind) {
            return;
        }

        if (kind === 'regenerate') {
            await this._regenerate();
            return;
        }

        const promptText = String(input.prompt || '').trim();
        const modeMatch = /^\/(?:mode\s+)?(default|plan|agent)$/i.exec(promptText);
        if (kind === 'prompt' && modeMatch) {
            await this.setExecutionMode(normalizeExecutionMode(modeMatch[1].toLowerCase()));
            return;
        }
        if (kind === 'prompt' && /^\/(?:approve|run-plan)$/i.test(promptText)) {
            await this.setExecutionMode('agent');
            return;
        }
        if ((kind === 'prompt' || kind === 'promptWithFile') && await this._tryRunMcpSlashPrompt(promptText)) {
            return;
        }

        if (kind === 'editMessage' && (!Number.isInteger(input.messageIndex) || (input.messageIndex ?? -1) < 0)) {
            return;
        }

        const request = this._createQueuedRequest({
            kind,
            prompt: String(input.prompt || ''),
            modelName: String(input.modelName || this._lastModel || ''),
            files,
            internetEnabled: input.internetEnabled,
            messageIndex: input.messageIndex
        });
        await this._enqueueRequest(request);
    }

    private async _tryRunMcpSlashPrompt(promptText: string): Promise<boolean> {
        const actions = parseMcpSlashCommandActions(promptText);
        if (actions.length === 0) {
            return false;
        }

        const commandLines = promptText
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);
        if (commandLines.some(line => !this.isMcpDirectCommandLine(line))) {
            return false;
        }

        this._chatSession.chatHistory.push({ role: 'user', content: promptText });
        this._chatSession.displayMessages.push({ role: 'user', text: promptText, feedback: null });

        const localSlashResponse = await this._tryBuildLocalSlashResponse(actions);
        if (localSlashResponse) {
            await this._appendSlashResponse(localSlashResponse);
            return true;
        }

        const resultStartIndex = this._chatSession.chatHistory.length;
        const report = await this._executeActions(promptText);
        const resultMessages = collectMcpSlashResultMessages(this._chatSession.chatHistory, resultStartIndex);
        const responseText = resultMessages.length > 0
            ? resultMessages.join('\n\n')
            : report.length > 0 ? report.map(item => `> ${item}`).join('\n') : '> MCP slash command completed.';
        await this._appendSlashResponse(responseText);
        return true;
    }

    private async _tryBuildLocalSlashResponse(actions: ReturnType<typeof parseMcpSlashCommandActions>): Promise<string | undefined> {
        if (actions.length !== 1 || actions[0].command !== 'ctx_stats') {
            return undefined;
        }
        return this._buildLlemContextStatsMessage();
    }

    private async _appendSlashResponse(responseText: string): Promise<void> {
        this._chatSession.chatHistory.push({ role: 'assistant', content: responseText });
        this._chatSession.displayMessages.push({ role: 'ai', text: responseText, feedback: null });
        this._view?.webview.postMessage({
            type: 'response',
            message: { role: 'ai', text: responseText, feedback: null },
            messageIndex: this._chatSession.displayMessages.length - 1
        });
        await this.saveHistory();
    }

    private async _buildLlemContextStatsMessage(): Promise<string> {
        const metrics = PerfLogger.snapshot();
        const history = await this._historyManager.listSessions();
        const sessionCount = history.some(item => item.id === this._chatSession.id)
            ? history.length
            : history.length + 1;
        const savedMessageCount = await this._countSavedDisplayMessages(history.map(item => item.id));
        const currentDisplayCount = this._chatSession.displayMessages.length;
        const totalMessages = Math.max(savedMessageCount, currentDisplayCount);
        const userMessages = countRole(this._chatSession.displayMessages, 'user');
        const assistantMessages = countRole(this._chatSession.displayMessages, 'ai') + countRole(this._chatSession.displayMessages, 'assistant');
        const lastUpdated = new Date(this._chatSession.lastModified || Date.now()).toLocaleString();

        const lines = [
            `you ran ${sessionCount} conversations in LLeM.`,
            '',
            'LLeM context-mode stats',
            `context build ${formatMs(metrics.contextBuildMs)} | vault scan ${formatMs(metrics.vaultScanMs)} | ${metrics.vaultFileCount} vault files`,
            `${formatApproxKb(metrics.finalRequestChars)} entered context | ${metrics.prunedMessages} messages pruned | ${formatApproxKb(metrics.prunedAttachmentChars)} attachments pruned`,
            '',
            this._formatContextBreakdown(metrics),
            '',
            'Current LLeM chat',
            `${currentDisplayCount} messages | ${userMessages} user | ${assistantMessages} assistant`,
            `model ${metrics.modelName || '(unknown)'} | profile ${metrics.performancePreset || '(unknown)'}`,
            `stream ${formatMs(metrics.streamTotalMs)} | ${metrics.streamTotalTokens} tokens | ${metrics.streamTokensPerSecond.toFixed(1)} tokens/sec`,
            `session ${this._chatSession.id}`,
            `updated ${lastUpdated}`,
            '',
            'Persistent LLeM history preserved across compact, restart & upgrade',
            `${sessionCount} sessions | ${totalMessages} visible messages indexed locally`,
            '~/.llem-history',
            '',
            'Source: LLeM chat history and LLeM Performance metrics, not Codex CLI.'
        ];

        return `\`\`\`text\n${lines.join('\n')}\n\`\`\``;
    }

    private _formatContextBreakdown(metrics: PerfMetrics): string {
        return [
            `Prompt estimate ${formatApproxKb(metrics.promptSizeEstimateChars)} | final request ${formatApproxKb(metrics.finalRequestChars)}`,
            `History ${formatApproxKb(metrics.historyChars)} | attachments ${formatApproxKb(metrics.attachmentChars)}`,
            `Active editor ${formatApproxKb(metrics.activeEditorChars)} | workspace ${formatApproxKb(metrics.workspaceChars)} | vault ${formatApproxKb(metrics.vaultChars)}`
        ].join('\n');
    }

    private async _countSavedDisplayMessages(sessionIds: string[]): Promise<number> {
        let count = 0;
        for (const id of sessionIds) {
            const session = await this._historyManager.getSession(id);
            count += session?.displayMessages?.length || 0;
        }
        return count;
    }

    private isMcpDirectCommandLine(line: string): boolean {
        return /^\/(?:context-mode:)?[A-Za-z][A-Za-z0-9_-]*(?:\s|$)/.test(line) ||
            /^ctx\s+(?:stats|doctor|upgrade|purge|insight)(?:\s|$)/i.test(line);
    }

    private async _enqueueRequest(request: QueuedRequest): Promise<void> {
        const retryStatus = this._requestRetryGuard.shouldBlock(request);
        if (retryStatus.blocked) {
            const reason = retryStatus.reason || 'recent repetition stop';
            logInfo(`[QUEUE] Blocked immediate retry for ${request.kind} (${request.id}) due to ${reason}`);
            this._view?.webview.postMessage({
                type: 'response',
                value: `> ⚠️ 방금 반복 중단된 요청과 같은 요청이라 잠시 다시 실행하지 않았습니다. 이유: ${reason}`
            });
            return;
        }
        this._queueState = enqueueQueueState(this._queueState, request);
        logInfo(`[QUEUE] Enqueued ${request.kind} (${request.id}); pending=${this._queueState.pendingRequests.length}`);
        this._syncQueueStateToWebview();
        void this._runNextRequestIfIdle();
    }

    private async _runNextRequestIfIdle(): Promise<void> {
        if (this._isProcessingQueue) {
            return;
        }

        if (this._queueCheckTimer) {
            clearTimeout(this._queueCheckTimer);
            this._queueCheckTimer = undefined;
        }

        const promoted = promoteNextRequest(this._queueState);
        this._queueState = promoted.state;
        const nextRequest = promoted.nextRequest;
        if (!nextRequest) {
            this._syncQueueStateToWebview();

            // If there are pending requests, they might be scheduled for later.
            // Set a timer to check again.
            if (this._queueState.pendingRequests.length > 0) {
                const now = Date.now();
                const scheduledTimes = this._queueState.pendingRequests
                    .map(r => r.scheduledAt)
                    .filter((t): t is number => !!t);

                if (scheduledTimes.length > 0) {
                    const nextReadyTime = Math.min(...scheduledTimes);
                    const delay = Math.max(500, nextReadyTime - now);
                    logInfo(`[QUEUE] Next request ready in ${delay}ms; setting check timer.`);
                    this._queueCheckTimer = setTimeout(() => this._runNextRequestIfIdle(), delay);
                }
            }
            return;
        }

        this._isProcessingQueue = true;
        this._syncQueueStateToWebview();

        const execution = this._executeQueuedRequest(nextRequest)
            .catch((error) => {
                logError('[QUEUE] Failed to execute queued request: ' + (error instanceof Error ? error.message : String(error)));
            })
            .finally(async () => {
                this._queueState = finishActiveRequest(this._queueState);
                this._activeRequestPromise = undefined;
                this._isProcessingQueue = false;
                this._syncQueueStateToWebview();
                await this._runNextRequestIfIdle();
            });

        this._activeRequestPromise = execution;
        await execution;
    }

    private async _executeQueuedRequest(request: QueuedRequest): Promise<void> {
        logInfo(`[QUEUE] Starting ${request.kind} (${request.id})`);

        if (request.wasQueued && request.kind !== 'editMessage') {
            this._view?.webview.postMessage({
                type: 'queuedRequestStarting',
                value: {
                    prompt: request.prompt,
                    files: request.files || []
                }
            });
        }

        switch (request.kind) {
            case 'promptWithFile':
                await this._handleExecutionResult(
                    request,
                    await this._runPromptWithFilesNow(request.prompt, request.modelName, request.files || [], request.internetEnabled)
                );
                return;
            case 'editMessage':
                await this._handleExecutionResult(
                    request,
                    await this._runEditNow(request.messageIndex ?? -1, request.prompt, request.modelName, request.files || [], request.internetEnabled)
                );
                return;
            case 'regenerate':
                this._chatSession.removeLastAssistantResponse();
                if ((request.files || []).length > 0) {
                    await this._handleExecutionResult(
                        request,
                        await this._runPromptWithFilesNow(request.prompt, request.modelName, request.files || [], request.internetEnabled)
                    );
                    return;
                }
                await this._handleExecutionResult(
                    request,
                    await this._runPromptNow(request.prompt, request.modelName, request.internetEnabled)
                );
                return;
            case 'prompt':
                await this._handleExecutionResult(
                    request,
                    await this._runPromptNow(request.prompt, request.modelName, request.internetEnabled)
                );
                return;
        }
    }

    private async _handleExecutionResult(
        request: QueuedRequest,
        result?: { repeated: boolean; stopReason?: string }
    ): Promise<void> {
        if (!result?.repeated) {
            this._requestRetryGuard.clearRetryHistory(request);
            return;
        }

        const reason = result.stopReason || 'repetition detected';
        const { retryAllowed, nextDelayMs } = this._requestRetryGuard.markRepeated(request, reason);

        if (retryAllowed) {
            const retryCount = (request.retryCount ?? 0) + 1;
            const scheduledAt = Date.now() + nextDelayMs;

            // Inject a strategy shift hint to help the AI analyze the root cause
            const strategyHint = `\n\n[SYSTEM HINT] A repetition loop was detected. Please analyze why this happened (e.g., outdated file info, conflicting instructions). Shift your strategy by breaking the task into smaller units or trying a different approach. Avoid repeating the same logic.`;
            const updatedPrompt = request.prompt.includes('[SYSTEM HINT]') 
                ? request.prompt 
                : request.prompt + strategyHint;

            const retryRequest: QueuedRequest = {
                ...request,
                prompt: updatedPrompt,
                retryCount,
                scheduledAt,
                wasQueued: true
            };

            this._queueState = enqueueQueueState(this._queueState, retryRequest);
            logInfo(`[QUEUE] Scheduled retry ${retryCount} for ${request.id} in ${nextDelayMs}ms`);

            this._view?.webview.postMessage({
                type: 'streamChunk',
                value: `\n\n> ⏳ **[Cooldown]** Repetition detected. Analyzing cause and retrying in ${Math.round(nextDelayMs / 1000)}s... (Attempt ${retryCount}/3)\n\n`
            });

            this._syncQueueStateToWebview();
            void this._runNextRequestIfIdle();
        } else {
            const filtered = this._requestRetryGuard.filterBlocked(this._queueState.pendingRequests);
            if (filtered.blocked.length > 0) {
                this._queueState = {
                    ...this._queueState,
                    pendingRequests: filtered.allowed
                };
                logInfo(`[QUEUE] Removed ${filtered.blocked.length} queued retry request(s) after repetition limit reached`);
            }

            this._view?.webview.postMessage({
                type: 'streamChunk',
                value: `\n\n> ⚠️ **[Limit Reached]** I've attempted to fix the repetition loop 3 times but was unsuccessful. It seems the task might be conflicting with current constraints or logic. **Could you please point out which part is incorrect or provide more specific instructions to help me break this loop?**\n\n`
            });

            this._syncQueueStateToWebview();
        }
    }

    private async _cancelQueuedRequest(id: string): Promise<void> {
        const before = this._queueState.pendingRequests.length;
        this._queueState = cancelPendingRequest(this._queueState, id);
        if (this._queueState.pendingRequests.length === before) {
            return;
        }
        logInfo('[QUEUE] Cancelled queued request ' + id);
        this._syncQueueStateToWebview();
    }

    private async _clearQueuedRequests(): Promise<void> {
        if (this._queueState.pendingRequests.length === 0) {
            return;
        }
        this._queueState = clearPendingRequests(this._queueState);
        logInfo('[QUEUE] Cleared pending queue');
        this._syncQueueStateToWebview();
    }

    private async _moveQueuedRequest(id: string, direction: 'up' | 'down'): Promise<void> {
        const moved = movePendingRequest(this._queueState, id, direction);
        if (moved === this._queueState) {
            return;
        }
        this._queueState = moved;
        logInfo(`[QUEUE] Moved queued request ${id} ${direction}`);
        this._syncQueueStateToWebview();
    }

    private async _editQueuedRequest(id: string): Promise<void> {
        const request = this._queueState.pendingRequests.find(item => item.id === id);
        if (!request) {
            return;
        }

        this._queueState = cancelPendingRequest(this._queueState, id);
        this._syncQueueStateToWebview();
        this._view?.webview.postMessage({
            type: 'editQueuedRequest',
            value: {
                kind: request.kind,
                prompt: request.prompt,
                modelName: request.modelName,
                files: request.files || [],
                internetEnabled: request.internetEnabled,
                messageIndex: request.messageIndex
            }
        });
    }

    private async _resumeQueue(): Promise<void> {
        if (!this._queueState.paused) {
            return;
        }

        this._queueState = resumeQueueState(this._queueState);
        logInfo('[QUEUE] Resumed pending queue');
        this._syncQueueStateToWebview();
        void this._runNextRequestIfIdle();
    }

    private async _resetQueueState(options: { abortActive?: boolean } = {}): Promise<void> {
        this._queueState = resetQueueState();
        this._syncQueueStateToWebview();

        if (options.abortActive && this._abortController) {
            this._abortController.abort();
        }

        if (this._activeRequestPromise) {
            try {
                await this._activeRequestPromise;
            } catch {
                // Execution errors are already logged at the queue layer.
            }
        }

        this._activeRequestPromise = undefined;
        this._isProcessingQueue = false;
        this._queueState = resetQueueState();
        this._syncQueueStateToWebview();
    }

    private _settingsCommandHost(): SettingsCommandsHost {
        return {
            getSystemPrompt: () => this._systemPrompt,
            getTemperature: () => this._temperature,
            getTopK: () => this._topK,
            getTopP: () => this._topP,
            resetConversationForSystemPromptChange: async () => {
                await this._resetQueueState({ abortActive: true });
                this._chatSession.reset();
                this._view?.webview.postMessage({ type: 'clearChat' });
                this._syncQueueStateToWebview();
            },
            sendModels: () => this._sendModels(),
            setSystemPrompt: (value) => {
                this._systemPrompt = value;
                this._ctx.globalState.update('aiSystemPrompt', value);
            },
            setTemperature: (value) => {
                this._temperature = value;
                this._ctx.globalState.update('aiTemperature', value);
            },
            setTopK: (value) => {
                this._topK = value;
                this._ctx.globalState.update('aiTopK', value);
            },
            setTopP: (value) => {
                this._topP = value;
                this._ctx.globalState.update('aiTopP', value);
            },
            listMcpServers: () => this.listMcpServers(),
            reloadMcpServers: () => this.reloadMcpServers(),
            syncCodexMcpServers: () => this.syncCodexMcpServers(),
            importMcpFromGitHub: () => this.importMcpFromGitHub()
        };
    }

    private async _handleSettingsMenu() {
        if (!this._view) { return; }
        await handleSettingsMenu(this._settingsCommandHost());
    }

    private async _regenerate(): Promise<void> {
        if (!this._lastPrompt) {
            this._view?.webview.postMessage({
                type: 'response',
                value: '> ⚠️ 다시 생성할 이전 요청이 없습니다.'
            });
            return;
        }

        const request = this._createQueuedRequest({
            kind: 'regenerate',
            prompt: this._lastPrompt,
            modelName: this._lastModel || '',
            files: this._lastFiles,
            internetEnabled: this._lastInternetEnabled
        });
        await this._enqueueRequest(request);
    }

    private _showTerminal(): void {
        getLlemChannel().show();
    }

    private _reviewChanges(): void {
        void vscode.commands.executeCommand('workbench.view.scm');
    }

    private async _openExternalUrl(url: string): Promise<void> {
        const value = String(url || '').trim();
        if (!/^https?:\/\//i.test(value) && !/^mailto:/i.test(value)) {
            return;
        }

        try {
            await vscode.env.openExternal(vscode.Uri.parse(value, true));
        } catch (err) {
            void vscode.window.showErrorMessage(`Could not open link: ${value}`);
            logError('[LINK] Failed to open external URL: ' + (err instanceof Error ? err.message : String(err)));
        }
    }

    private async _fetchUris(uris: string[], requestId?: string): Promise<void> {
        if (!this._view) { return; }
        for (const uriString of uris) {
            const uri = parseDroppedUri(uriString);
            const name = basenameFromUri(uri);
            const type = attachmentTypeFromName(name);

            if (!isSafeAttachmentLookupName(name)) {
                continue;
            }

            try {
                const stat = await vscode.workspace.fs.stat(uri);
                if (stat.type === vscode.FileType.Directory) {
                    continue;
                }
                if (stat.size > droppedAttachmentLimit(type)) {
                    this._view.webview.postMessage({
                        type: 'dropError',
                        value: `File too large: ${name} (${Math.round(stat.size / 1024)} KB)`
                    });
                    continue;
                }
                const bytes = await vscode.workspace.fs.readFile(uri);
                const data = Buffer.from(bytes).toString('base64');
                this._view.webview.postMessage({
                    type: 'injectAttachment',
                    value: { name, type, data, requestId, sourceUri: uri.toString(true) }
                });
            } catch (err) {
                this._view.webview.postMessage({
                    type: 'dropError',
                    value: `Could not read ${name}: ${summarizeDropError(err)}`
                });
            }
        }
    }

    private async _openAttachment(file: { name?: string; data?: string; type?: string; sourceUri?: string; line?: number }) {
        if (!file.name) { return; }
        if (!isEditableFilePath(file.name)) {
            void vscode.window.showInformationMessage(`Only editable text/code files can be opened from chat: ${file.name}`);
            return;
        }

        try {
            if (file.sourceUri) {
                const uri = parseDroppedUri(file.sourceUri);
                await openDocument(uri, { line: file.line, forceEditor: true });
                return;
            }

            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) { return; }

            let requestedPath = file.name;
            const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
            const relativePaths = files.map(entry => vscode.workspace.asRelativePath(entry, false));
            const matchedPath = resolveEditableWorkspacePath(requestedPath, relativePaths);
            if (matchedPath) {
                requestedPath = matchedPath;
            }

            const { absPath } = await resolveLlemPath(workspaceRoot, requestedPath);
            await openDocument(vscode.Uri.file(absPath), { line: file.line, forceEditor: true });
        } catch (err) {
            vscode.window.showErrorMessage(`Could not open attachment: ${err}`);
        }
    }

    private _stopGeneration(): void {
        this._queueState = pauseQueue(this._queueState);
        this._syncQueueStateToWebview();

        if (!this._abortController) {
            return;
        }

        this._abortController.abort();
        this._abortController = undefined;
    }

    private _brainCommandHost(): BrainCommandsHost {
        return {
            findBrainFiles: (dir) => this._contextBuilder.findBrainFiles(dir),
            getBrainFiles: (brainDir) => this._contextBuilder.getBrainFiles(brainDir),
            injectSystemMessage: (message) => this.injectSystemMessage(message),
            invalidateContextCaches: (scope) => this.invalidateContextCaches(scope),
            isSyncingBrain: () => this._isSyncingBrain,
            postWebviewMessage: (message) => this._view?.webview.postMessage(message),
            pushChatMessage: (message) => this._chatSession.chatHistory.push(message),
            setBrainEnabled: (enabled) => {
                this._brainEnabled = enabled;
                this._ctx.globalState.update('brainEnabled', enabled);
            },
            setSyncingBrain: (value) => { this._isSyncingBrain = value; }
        };
    }

    private async _handleInjectLocalBrain(files: any[]) {
        if (!this._view) { return; }
        await handleInjectLocalBrain(files, this._brainCommandHost());
    }

    private async _sendModels() {
        if (!this._view) { return; }
        const models = await getInstalledModels();
        logInfo('[MODELS] Sending ' + models.length + ' model(s) to webview: ' + models.join(', '));
        this._view.webview.postMessage({
            type: 'modelsList',
            value: models,
            selectedModel: getConfig().defaultModel
        });
    }

    private async _setDefaultModel(modelName: string): Promise<void> {
        const nextModel = String(modelName || '').trim();
        if (!nextModel) {
            return;
        }

        const currentModel = getConfig().defaultModel;
        if (currentModel === nextModel) {
            return;
        }

        await getLlemSettings().update('defaultModel', nextModel, vscode.ConfigurationTarget.Global);
        
        this._lastModel = nextModel;
        logInfo('[MODELS] Default model updated from ' + currentModel + ' to ' + nextModel);
    }

    private async _handleBrainMenu() {
        if (!this._view) { return; }
        await handleBrainMenu(this._brainCommandHost());
    }

    public getBrainFileCount(): number {
        return this._contextBuilder.getBrainFileCount();
    }

    private _restoreDisplayMessages() {
        const count = this._chatSession.displayMessages.length;
        logInfo('[RESTORE] Restoring display messages (count=' + count + ')');
        if (!this._view || count === 0) {
            logInfo('[RESTORE] Nothing to restore — no view or empty displayMessages');
            return;
        }
        this._view.webview.postMessage({
            type: 'restoreMessages',
            value: this._chatSession.displayMessages
        });
    }

    private _buildRequestMessages(options: {
        internetEnabled?: boolean;
        backgroundLabel?: string;
        modelProfile?: ModelProfile;
        activeModelName?: string;
        activeEngineName?: string;
        attachmentNames?: string[];
        attachmentChars?: number;
        prunedAttachmentChars?: number;
        executionPhase?: 'initial' | 'followup';
    } = {}): ChatMessage[] {
        return this._contextBuilder.buildRequestMessages({
            chatHistory: this._chatSession.chatHistory,
            systemPrompt: this._systemPrompt,
            responsePreferenceDirective: this._responsePreferenceManager.getDirective(),
            brainEnabled: this._brainEnabled,
            internetEnabled: options.internetEnabled,
            backgroundLabel: options.backgroundLabel ?? 'BACKGROUND CONTEXT',
            modelProfile: options.modelProfile,
            activeModelName: options.activeModelName,
            activeEngineName: options.activeEngineName,
            attachmentNames: options.attachmentNames,
            attachmentChars: options.attachmentChars,
            prunedAttachmentChars: options.prunedAttachmentChars,
            executionPhase: options.executionPhase,
            executionMode: this._executionMode
        });
    }

    private _sendExecutionMode(): void {
        this._view?.webview.postMessage({
            type: 'executionMode',
            value: this._executionMode
        });
    }

    private _warnLargeModelTimeout(profile: ModelProfile, timeoutMs: number): void {
        if (profile.resolvedPreset !== 'large-local-26b' || !profile.warningTimeoutMs || timeoutMs >= profile.warningTimeoutMs) {
            return;
        }

        const warningKey = `${profile.modelName}:${profile.resolvedPreset}:${timeoutMs}`;
        if (this._largeModelWarningsShown.has(warningKey)) {
            return;
        }

        this._largeModelWarningsShown.add(warningKey);
        void vscode.window.showWarningMessage(`LLeM is using ${profile.modelName} with the ${profile.resolvedPreset} profile. For 26B local models, a request timeout of 600 seconds or higher is recommended.`);
    }

    private async _runPromptWithFilesNow(prompt: string, modelName: string, files: AttachedFile[], internetEnabled?: boolean) {
        if (!this._view) { logError('[PROMPT] handlePromptWithFile called but no view', false); return; }
        const imageCount = files.filter(file => String(file.type || '').startsWith('image/')).length;
        const imageDataChars = files
            .filter(file => String(file.type || '').startsWith('image/'))
            .reduce((sum, file) => sum + String(file.data || '').length, 0);
        logInfo('[PROMPT] handlePromptWithFile (model=' + modelName + ', files=' + files.length + ', images=' + imageCount + ', imageDataChars=' + imageDataChars + ', internet=' + !!internetEnabled + ')');
        return await this._chatPipeline.handlePromptWithFile(prompt, modelName, files, internetEnabled);
    }

    private async _runPromptNow(prompt: string, modelName: string, internetEnabled?: boolean) {
        if (!this._view) { logError('[PROMPT] handlePrompt called but no view', false); return; }
        logInfo('[PROMPT] handlePrompt (model=' + modelName + ', internet=' + !!internetEnabled + ', len=' + prompt.length + ')');
        return await this._chatPipeline.handlePrompt(prompt, modelName, internetEnabled);
    }

    private async _executeActions(aiMessage: string): Promise<string[]> {
        return executeActions(aiMessage, {
            appendChatMessage: (message) => this._chatSession.chatHistory.push(message),
            injectSystemMessage: (message) => this.injectSystemMessage(message),
            invalidateContextCaches: (scope) => this.invalidateContextCaches(scope),
            listMcpTools: () => this._mcpManager.listTools(),
            callMcpTool: async (server, tool, args) => {
                const startedAt = Date.now();
                this._view?.webview.postMessage({
                    type: 'mcpToolStatus',
                    state: 'running',
                    server,
                    tool,
                    startedAt
                });
                try {
                    return await this._mcpManager.callTool(server, tool, args);
                } finally {
                    this._view?.webview.postMessage({
                        type: 'mcpToolStatus',
                        state: 'done',
                        server,
                        tool,
                        durationMs: Date.now() - startedAt
                    });
                }
            },
            getExecutionMode: () => this._executionMode
        });
    }

    public getExecutionMode(): ExecutionMode {
        return this._executionMode;
    }

    public async setExecutionMode(mode: ExecutionMode): Promise<void> {
        const nextMode = normalizeExecutionMode(mode);
        this._executionMode = nextMode;
        await this._ctx.globalState.update('executionMode', nextMode);
        const label = executionModeLabel(nextMode);
        this.injectSystemMessage(`Mode changed: ${label}.`);
        this._sendExecutionMode();
        this._view?.webview.postMessage({ type: 'response', value: `> ${label} enabled.` });
        vscode.window.showInformationMessage(`LLeM ${label} enabled.`);
    }

    public getMcpManager(): McpManager {
        return this._mcpManager;
    }

    public async listMcpServers(): Promise<void> {
        const servers = await this._mcpManager.listServers();
        const doc = await vscode.workspace.openTextDocument({
            language: 'markdown',
            content: [
                '# LLeM MCP Servers',
                '',
                ...servers.map(server => `- ${server.name}: ${server.enabled ? server.transport : 'disabled'}${server.command ? ` \`${[server.command, ...server.args].join(' ')}\`` : ''}${server.sourcePath ? ` (${server.sourceKind}: ${server.sourcePath})` : ` (${server.sourceKind})`}`)
            ].join('\n')
        });
        await vscode.window.showTextDocument(doc, { preview: true });
    }

    public async reloadMcpServers(): Promise<void> {
        await this._mcpManager.reload();
        vscode.window.showInformationMessage('MCP runtime reloaded.');
    }

    public async syncCodexMcpServers(): Promise<void> {
        const message = await syncCodexMcpServers();
        vscode.window.showInformationMessage(message);
        await this._mcpManager.reload();
    }

    public async importMcpFromGitHub(): Promise<void> {
        const message = await importMcpFromGitHubUrl();
        vscode.window.showInformationMessage(message);
        await this._mcpManager.reload();
    }

    private async saveHistory() {
        if (this._chatSession) {
            try {
                logInfo(`[SIDEBAR] saveHistory: Saving session ${this._chatSession.id}`);
                await this._historyManager.saveSession(this._chatSession);
            } catch (err) {
                logError(`[SIDEBAR] saveHistory: Failed to save session ${this._chatSession.id}: ` + (err instanceof Error ? err.message : String(err)));
                // We don't throw here to avoid interrupting the chat pipeline if saving fails
            }
        }
    }

    private async _branchChat(messageIndex: number): Promise<void> {
        if (!Number.isInteger(messageIndex) || messageIndex < 0) {
            return;
        }

        const branch = this._chatSession.createBranchFromMessage(messageIndex);
        if (!branch) {
            return;
        }

        try {
            await this.saveHistory();
            this._chatSession.load(branch);
            await this.saveHistory();
            this._view?.webview.postMessage({ type: 'clearChat' });
            this._restoreDisplayMessages();
            this._view?.webview.postMessage({ type: 'historyLoaded', id: branch.id });
            void vscode.window.showInformationMessage('Opened a new chat branch from that response.');
        } catch (err) {
            logError('[BRANCH] Failed to create branch: ' + (err instanceof Error ? err.message : String(err)));
        }
    }

    private async _setMessageFeedback(messageIndex: number, feedback: MessageFeedback | null): Promise<void> {
        const message = this._chatSession.updateMessageFeedback(messageIndex, feedback);
        if (!message) {
            return;
        }

        const sourceKey = `${this._chatSession.id}:${messageIndex}`;
        await this._responsePreferenceManager.setFeedback(sourceKey, message.text, feedback);
        await this.saveHistory();
    }

    private async _runEditNow(messageIndex: number, prompt: string, modelName: string, files: AttachedFile[], internetEnabled?: boolean): Promise<{ repeated: boolean; stopReason?: string } | undefined> {
        if (!Number.isInteger(messageIndex) || messageIndex < 0) {
            return;
        }

        const branch = this._chatSession.createBranchBeforeMessage(messageIndex, prompt);
        if (!branch) {
            return;
        }

        try {
            await this.saveHistory();
            this._chatSession.load(branch);
            await this.saveHistory();
            this._view?.webview.postMessage({ type: 'clearChat' });
            this._restoreDisplayMessages();

            if (files.length > 0) {
                return await this._runPromptWithFilesNow(prompt, modelName || this._lastModel || '', files, internetEnabled);
            }
            return await this._runPromptNow(prompt, modelName || this._lastModel || '', internetEnabled);

            void vscode.window.showInformationMessage('Created a new edited branch from that message.');
        } catch (err) {
            logError('[EDIT] Failed to edit earlier message: ' + (err instanceof Error ? err.message : String(err)));
        }
    }

    private _getHtml(webview: vscode.Webview): string {
        const version = String(this._ctx.extension.packageJSON.version || 'dev');
        return getChatWebviewHtml(this._extensionUri, webview, version);
    }

    public async getHistory() {
        if (!this._view) { return; }
        const history = await this._historyManager.listSessions();
        logInfo('[HISTORY] Listing ' + history.length + ' session(s)');
        this._view.webview.postMessage({ type: 'historyList', value: history });
    }

    public async loadHistory(id: string) {
        if (!this._view) { return; }
        logInfo('[HISTORY] Loading session: ' + id);
        await this._resetQueueState({ abortActive: true });
        const sessionData = await this._historyManager.getSession(id);
        if (sessionData) {
            if (this._chatSession.chatHistory.length > 0) {
                logInfo('[HISTORY] Saving current session before loading: ' + id);
                await this._historyManager.saveSession(this._chatSession);
            }
            this._chatSession.load(sessionData);
            logInfo('[HISTORY] Session loaded, restoring display messages');
            this._restoreDisplayMessages();
            this._view.webview.postMessage({ type: 'historyLoaded', id });
        } else {
            logError('[HISTORY] Session not found: ' + id, false);
        }
    }

    public async requestDeleteHistory(id: string, title: string) {
        logInfo('[HISTORY] requestDeleteHistory(' + id + ', ' + title + ')');
        this._view?.webview.postMessage({ type: 'requestDeleteHistory', id, title });
    }

    public async requestClearAllHistory() {
        logInfo('[HISTORY] requestClearAllHistory()');
        this._view?.webview.postMessage({ type: 'requestClearAllHistory' });
    }

    private async _sendWorkspaceFiles(): Promise<void> {
        if (!this._view) { return; }
        try {
            const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
            const relativePaths = files.map(f => vscode.workspace.asRelativePath(f, false));
            logInfo(`[WEBVIEW] Sending ${relativePaths.length} workspace file paths`);
            this._view.webview.postMessage({ type: 'workspaceFilesList', value: relativePaths });
        } catch (err) {
            logError('[WEBVIEW] Failed to fetch workspace files: ' + (err instanceof Error ? err.message : String(err)));
        }
    }

    private async _sendMcpServers(): Promise<void> {
        if (!this._view) { return; }
        try {
            const state = await listMcpServerUiState();
            this._view.webview.postMessage({ type: 'mcpServersList', value: state });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logError('[MCP] Failed to list MCP servers for UI: ' + message);
            this._view.webview.postMessage({ type: 'mcpServersError', value: message });
        }
    }

    private async _setGlobalMcpEnabled(enabled: boolean): Promise<void> {
        try {
            await setGlobalMcpEnabled(enabled);
            await this._mcpManager.reload();
            await this._sendMcpServers();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logError('[MCP] Failed to toggle MCP runtime: ' + message);
            this._view?.webview.postMessage({ type: 'mcpServersError', value: message });
        }
    }

    private async _setMcpServerEnabled(name: string, enabled: boolean): Promise<void> {
        try {
            await setMcpServerEnabled(name, enabled);
            await this._mcpManager.reload();
            await this._sendMcpServers();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logError('[MCP] Failed to toggle MCP server ' + name + ': ' + message);
            this._view?.webview.postMessage({ type: 'mcpServersError', value: message });
            await this._sendMcpServers();
        }
    }

    public dispose(): void {
        void this._mcpManager.dispose();
    }
}
