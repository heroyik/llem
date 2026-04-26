import * as vscode from 'vscode';
import * as path from 'path';
import { getVaultDir } from './config';
import { executeActions } from './actionExecutor';
import { SYSTEM_PROMPT } from './prompts';
import { getChatWebviewHtml } from './webviewHtml';
import { ContextBuilder } from './contextBuilder';
import { ChatSession } from './chatSession';
import { ChatPipeline } from './chatPipeline';
import { handleBrainMenu, handleInjectLocalBrain } from './brainCommands';
import type { BrainCommandsHost } from './brainCommands';
import { getInstalledModels, runFirstRunSetup } from './modelDiscovery';
import { handleSettingsMenu } from './settingsCommands';
import type { SettingsCommandsHost } from './settingsCommands';
import { routeWebviewMessage } from './webviewMessageRouter';
import type { WebviewMessageRouterHost } from './webviewMessageRouter';
import type { AttachedFile, ChatMessage } from './types';
import { openDocument } from './fsUtils';
import { getLlemTerminal } from './terminalManager';

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
    private readonly _chatPipeline: ChatPipeline;
    private _setupStarted = false;

    constructor(private readonly _extensionUri: vscode.Uri, ctx: vscode.ExtensionContext) {
        this._ctx = ctx;
        this._temperature = ctx.globalState.get<number>('aiTemperature', 0.8);
        this._topP = ctx.globalState.get<number>('aiTopP', 0.9);
        this._topK = ctx.globalState.get<number>('aiTopK', 40);
        this._systemPrompt = ctx.globalState.get<string>('aiSystemPrompt', SYSTEM_PROMPT);
        this._chatSession = new ChatSession(ctx, () => this._systemPrompt);
        this._chatPipeline = new ChatPipeline({
            buildRequestMessages: (internetEnabled, backgroundLabel) => this._buildRequestMessages(internetEnabled, backgroundLabel),
            executeActions: (aiMessage) => this._executeActions(aiMessage),
            getChatHistory: () => this._chatSession.chatHistory,
            getDisplayMessages: () => this._chatSession.displayMessages,
            getTemperature: () => this._temperature,
            getTopK: () => this._topK,
            getTopP: () => this._topP,
            postWebviewMessage: (message) => this._view?.webview.postMessage(message),
            readBrainFile: (filename) => this._contextBuilder.readBrainFile(filename),
            saveHistory: () => this._chatSession.save(),
            setAbortController: (controller) => { this._abortController = controller; },
            setLastPrompt: (prompt, modelName, files, internetEnabled) => {
                this._lastPrompt = prompt;
                this._lastModel = modelName;
                this._lastFiles = files?.map(file => ({ ...file }));
                this._lastInternetEnabled = internetEnabled;
            }
        });
        this._brainEnabled = this._ctx.globalState.get<boolean>('brainEnabled', true);
        this._registerContextInvalidation();
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
            })
        );
    }

    public invalidateContextCaches(scope: { workspace?: boolean; brain?: boolean } = { workspace: true, brain: true }): void {
        this._contextBuilder.invalidate(scope);
    }

    public ensureFirstRunSetup(): void {
        if (this._setupStarted || this._ctx.globalState.get('setupComplete')) {
            return;
        }
        this._setupStarted = true;
        void runFirstRunSetup(this._ctx);
    }

    public resetChat() {
        this._chatSession.reset();
        this._lastPrompt = undefined;
        this._lastModel = undefined;
        this._lastFiles = undefined;
        this._lastInternetEnabled = undefined;
        if (this._view) {
            this._view.webview.postMessage({ type: 'clearChat' });
        }
        vscode.window.showInformationMessage('LLeM spun up a fresh thread.');
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
        this._view = surface;
        this.ensureFirstRunSetup();
        surface.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        surface.webview.onDidReceiveMessage(async (msg) => {
            await routeWebviewMessage(msg, this._webviewMessageRouterHost());
        });

        surface.webview.html = this._getHtml(surface.webview);
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
            handlePrompt: (prompt, modelName, internetEnabled) => this._handlePrompt(prompt, modelName, internetEnabled),
            handlePromptWithFile: (prompt, modelName, files, internetEnabled) => this._handlePromptWithFile(prompt, modelName, files, internetEnabled),
            handleSettingsMenu: () => this._handleSettingsMenu(),
            regenerate: () => this._regenerate(),
            resetChat: () => this.resetChat(),
            restoreDisplayMessages: () => this._restoreDisplayMessages(),
            sendModels: () => this._sendModels(),
            showBrainNetwork: () => vscode.commands.executeCommand('llem.showVaultMap'),
            showTerminal: () => this._showTerminal(),
            stopGeneration: () => this._stopGeneration(),
            fetchUris: (uris, requestId) => this._fetchUris(uris, requestId),
            openAttachment: (file) => this._openAttachment(file)
        };
    }

    private _settingsCommandHost(): SettingsCommandsHost {
        return {
            getSystemPrompt: () => this._systemPrompt,
            getTemperature: () => this._temperature,
            getTopK: () => this._topK,
            getTopP: () => this._topP,
            resetConversationForSystemPromptChange: () => {
                this._chatSession.reset();
                this._view?.webview.postMessage({ type: 'clearChat' });
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

        this._chatSession.removeLastAssistantResponse();
        if (this._lastFiles?.length) {
            await this._handlePromptWithFile(this._lastPrompt, this._lastModel || '', this._lastFiles, this._lastInternetEnabled);
            return;
        }

        await this._handlePrompt(this._lastPrompt, this._lastModel || '', this._lastInternetEnabled);
    }

    private _showTerminal(): void {
        getLlemTerminal().show();
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
                    value: { name, type, data, requestId }
                });
            } catch (err) {
                this._view.webview.postMessage({
                    type: 'dropError',
                    value: `Could not read ${name}: ${summarizeDropError(err)}`
                });
            }
        }
    }

    private async _openAttachment(file: { name: string; data?: string; type?: string }) {
        if (!file.name) { return; }

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) { return; }

        const absolutePath = path.isAbsolute(file.name) ? file.name : path.join(workspaceRoot, file.name);
        try {
            await openDocument(vscode.Uri.file(absolutePath));
        } catch (err) {
            vscode.window.showWarningMessage(`Could not open ${file.name}: ${summarizeDropError(err)}`);
        }
    }

    private _stopGeneration(): void {
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
        this._view.webview.postMessage({ type: 'modelsList', value: await getInstalledModels() });
    }

    private async _handleBrainMenu() {
        if (!this._view) { return; }
        await handleBrainMenu(this._brainCommandHost());
    }

    public getBrainFileCount(): number {
        return this._contextBuilder.getBrainFileCount();
    }

    private _restoreDisplayMessages() {
        if (!this._view || this._chatSession.displayMessages.length === 0) { return; }
        this._view.webview.postMessage({
            type: 'restoreMessages',
            value: this._chatSession.displayMessages
        });
    }

    private _buildRequestMessages(internetEnabled?: boolean, backgroundLabel = 'BACKGROUND CONTEXT'): ChatMessage[] {
        return this._contextBuilder.buildRequestMessages({
            chatHistory: this._chatSession.chatHistory,
            systemPrompt: this._systemPrompt,
            brainEnabled: this._brainEnabled,
            internetEnabled,
            backgroundLabel
        });
    }

    private async _handlePromptWithFile(prompt: string, modelName: string, files: AttachedFile[], internetEnabled?: boolean) {
        if (!this._view) { return; }
        await this._chatPipeline.handlePromptWithFile(prompt, modelName, files, internetEnabled);
    }

    private async _handlePrompt(prompt: string, modelName: string, internetEnabled?: boolean) {
        if (!this._view) { return; }
        await this._chatPipeline.handlePrompt(prompt, modelName, internetEnabled);
    }

    private async _executeActions(aiMessage: string): Promise<string[]> {
        return executeActions(aiMessage, {
            appendChatMessage: (message) => this._chatSession.chatHistory.push(message),
            injectSystemMessage: (message) => this.injectSystemMessage(message),
            invalidateContextCaches: (scope) => this.invalidateContextCaches(scope)
        });
    }

    private _getHtml(webview: vscode.Webview): string {
        const version = String(this._ctx.extension.packageJSON.version || 'dev');
        return getChatWebviewHtml(this._extensionUri, webview, version);
    }
}
