import * as vscode from 'vscode';
import * as path from 'path';
import { getLlemSettings, getVaultDir, getConfig } from './config';
import { executeActions } from './actionExecutor';
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
    private _abortController?: AbortController;
    private _activeRequestPromise?: Promise<void>;
    private _isProcessingQueue = false;
    private _queueState: RequestQueueState = createRequestQueueState();
    private _lastPrompt?: string;
    private _lastModel?: string;
    private _lastFiles?: AttachedFile[];
    private _lastInternetEnabled?: boolean;

    private _temperature: number;
    private _topP: number;
    private _topK: number;
    private _systemPrompt: string;
    private readonly _contextBuilder = new ContextBuilder();
    private readonly _chatSession: ChatSession;
    private readonly _historyManager: HistoryManager;
    private readonly _chatPipeline: ChatPipeline;
    private readonly _responsePreferenceManager: ResponsePreferenceManager;
    private _setupStarted = false;
    private readonly _largeModelWarningsShown = new Set<string>();

    constructor(private readonly _extensionUri: vscode.Uri, ctx: vscode.ExtensionContext) {
        this._ctx = ctx;
        this._temperature = ctx.globalState.get<number>('aiTemperature', 0.8);
        this._topP = ctx.globalState.get<number>('aiTopP', 0.9);
        this._topK = ctx.globalState.get<number>('aiTopK', 40);
        this._systemPrompt = ctx.globalState.get<string>('aiSystemPrompt', SYSTEM_PROMPT);
        this._historyManager = new HistoryManager(ctx);
        this._chatSession = new ChatSession(ctx, () => this._systemPrompt);
        this._responsePreferenceManager = new ResponsePreferenceManager(ctx);
        this._chatPipeline = new ChatPipeline({
            buildRequestMessages: (options) => this._buildRequestMessages(options),
            executeActions: (aiMessage) => this._executeActions(aiMessage),
            getChatHistory: () => this._chatSession.chatHistory,
            getDisplayMessages: () => this._chatSession.displayMessages,
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
            console.warn('LLeM: secondary sidebar view could not be opened, falling back to editor panel.', error);
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
            restoreDisplayMessages: () => this._restoreDisplayMessages(),
            sendModels: () => this._sendModels(),
            showBrainNetwork: () => vscode.commands.executeCommand('llem.showVaultMap'),
            showTerminal: () => this._showTerminal(),
            stopGeneration: () => this._stopGeneration(),
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
            setDefaultModel: (modelName) => this._setDefaultModel(modelName),
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
        const kind = input.kind;
        if (!kind) {
            return;
        }

        if (kind === 'regenerate') {
            await this._regenerate();
            return;
        }

        if (kind === 'editMessage' && (!Number.isInteger(input.messageIndex) || (input.messageIndex ?? -1) < 0)) {
            return;
        }

        const request = this._createQueuedRequest({
            kind,
            prompt: String(input.prompt || ''),
            modelName: String(input.modelName || this._lastModel || ''),
            files: input.files || [],
            internetEnabled: input.internetEnabled,
            messageIndex: input.messageIndex
        });
        await this._enqueueRequest(request);
    }

    private async _enqueueRequest(request: QueuedRequest): Promise<void> {
        this._queueState = enqueueQueueState(this._queueState, request);
        logInfo(`[QUEUE] Enqueued ${request.kind} (${request.id}); pending=${this._queueState.pendingRequests.length}`);
        this._syncQueueStateToWebview();
        void this._runNextRequestIfIdle();
    }

    private async _runNextRequestIfIdle(): Promise<void> {
        if (this._isProcessingQueue) {
            return;
        }

        const promoted = promoteNextRequest(this._queueState);
        this._queueState = promoted.state;
        const nextRequest = promoted.nextRequest;
        if (!nextRequest) {
            this._syncQueueStateToWebview();
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
                await this._runPromptWithFilesNow(request.prompt, request.modelName, request.files || [], request.internetEnabled);
                return;
            case 'editMessage':
                await this._runEditNow(request.messageIndex ?? -1, request.prompt, request.modelName, request.files || [], request.internetEnabled);
                return;
            case 'regenerate':
                this._chatSession.removeLastAssistantResponse();
                if ((request.files || []).length > 0) {
                    await this._runPromptWithFilesNow(request.prompt, request.modelName, request.files || [], request.internetEnabled);
                    return;
                }
                await this._runPromptNow(request.prompt, request.modelName, request.internetEnabled);
                return;
            case 'prompt':
                await this._runPromptNow(request.prompt, request.modelName, request.internetEnabled);
                return;
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
            }
        };
    }

    private async _handleSettingsMenu() {
        if (!this._view) { return; }
        await handleSettingsMenu(this._settingsCommandHost());
    }

    private async _regenerate(): Promise<void> {
        if (!this._lastPrompt) {
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

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) { return; }

        try {
            if (file.sourceUri) {
                const uri = parseDroppedUri(file.sourceUri);
                await openDocument(uri, { line: file.line, forceEditor: true });
                return;
            }

            let requestedPath = file.name;
            if (!requestedPath.includes('/') && !requestedPath.includes('\\')) {
                const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
                const relativePaths = files.map(entry => vscode.workspace.asRelativePath(entry, false));
                const matchedPath = resolveEditableWorkspacePath(requestedPath, relativePaths);
                if (matchedPath) {
                    requestedPath = matchedPath;
                }
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
            prunedAttachmentChars: options.prunedAttachmentChars
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
        logInfo('[PROMPT] handlePromptWithFile (model=' + modelName + ', files=' + files.length + ', internet=' + !!internetEnabled + ')');
        await this._chatPipeline.handlePromptWithFile(prompt, modelName, files, internetEnabled);
    }

    private async _runPromptNow(prompt: string, modelName: string, internetEnabled?: boolean) {
        if (!this._view) { logError('[PROMPT] handlePrompt called but no view', false); return; }
        logInfo('[PROMPT] handlePrompt (model=' + modelName + ', internet=' + !!internetEnabled + ', len=' + prompt.length + ')');
        await this._chatPipeline.handlePrompt(prompt, modelName, internetEnabled);
    }

    private async _executeActions(aiMessage: string): Promise<string[]> {
        return executeActions(aiMessage, {
            appendChatMessage: (message) => this._chatSession.chatHistory.push(message),
            injectSystemMessage: (message) => this.injectSystemMessage(message),
            invalidateContextCaches: (scope) => this.invalidateContextCaches(scope)
        });
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

    private async _runEditNow(messageIndex: number, prompt: string, modelName: string, files: AttachedFile[], internetEnabled?: boolean): Promise<void> {
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
                await this._runPromptWithFilesNow(prompt, modelName || this._lastModel || '', files, internetEnabled);
            } else {
                await this._runPromptNow(prompt, modelName || this._lastModel || '', internetEnabled);
            }

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
}
