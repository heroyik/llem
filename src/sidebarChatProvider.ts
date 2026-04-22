import * as vscode from 'vscode';
import { _getBrainDir } from './config';
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

type ChatWebviewSurface = vscode.WebviewView | vscode.WebviewPanel;

// ============================================================
// Sidebar Chat Provider
// ============================================================

export class SidebarChatProvider implements vscode.WebviewViewProvider {
    private _view?: ChatWebviewSurface;
    private _panel?: vscode.WebviewPanel;
    private _terminal?: vscode.Terminal;
    private _ctx: vscode.ExtensionContext;

    private _isSyncingBrain: boolean = false;
    public _brainEnabled: boolean = true; // 🧠 ON/OFF 토글 상태
    private _abortController?: AbortController;
    private _lastPrompt?: string;
    private _lastModel?: string;

    // 🏛️ AI 파라미터 튜닝
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
            setLastPrompt: (prompt, modelName) => {
                this._lastPrompt = prompt;
                this._lastModel = modelName;
            }
        });
        // 두뇌 토글 상태 복원 (세션 뒤에도 유지)
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
                if (filePath.startsWith(_getBrainDir())) {
                    this.invalidateContextCaches({ brain: true });
                }
            }),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('connectAiLab.localBrainPath')) {
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
        if (this._view) {
            this._view.webview.postMessage({ type: 'clearChat' });
        }
        vscode.window.showInformationMessage('Connect AI: 새 대화가 시작되었습니다.');
    }

    /** 대화를 Markdown 파일로 내보내기 */
    public async exportChat() {
        await this._chatSession.exportMarkdown();
    }

    /** 채팅 입력창에 포커스 (Cmd+L) */
    public focusInput() {
        if (!this._view) {
            this.openChatPanel();
        }

        this._revealSurface(false);
        setTimeout(() => {
            this._view?.webview.postMessage({ type: 'focusInput' });
        }, 50);
    }

    public getHistoryText(): string {
        return this._chatSession.getHistoryText();
    }

    /** 외부에서 프롬프트 전송 (예: 코드 선택 → 설명) */
    public injectSystemMessage(message: string) {
        if (!this._view) {
            this.openChatPanel();
        }

        this._view?.webview.postMessage({ type: 'response', value: message });
        this._chatSession.appendAssistantMessage(message);
    }

    public sendPromptFromExtension(prompt: string) {
        if (!this._view) {
            this.openChatPanel();
        }

        this._revealSurface(false);
        setTimeout(() => {
            this._view?.webview.postMessage({ type: 'injectPrompt', value: prompt });
        }, 300);
    }

    public openChatPanel(): void {
        if (this._panel) {
            this._view = this._panel;
            this._panel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'connect-ai-lab-chat',
            'Connect AI',
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

    // --------------------------------------------------------
    // Webview Lifecycle
    // --------------------------------------------------------
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
            showBrainNetwork: () => vscode.commands.executeCommand('connect-ai-lab.showBrainNetwork'),
            showTerminal: () => this._showTerminal(),
            stopGeneration: () => this._stopGeneration()
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
        await this._handlePrompt(this._lastPrompt, this._lastModel || '');
    }

    private _showTerminal(): void {
        if (this._terminal) {
            this._terminal.show();
            return;
        }

        vscode.window.showInformationMessage('Connect AI: 실행 중인 터미널 세션이 없습니다.');
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

    /** 저장된 대화 메시지를 웹뷰에 다시 전송 (복원) */
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

    // --------------------------------------------------------
    // Execute ALL agent actions from AI response
    // --------------------------------------------------------
    private async _executeActions(aiMessage: string): Promise<string[]> {
        return executeActions(aiMessage, {
            appendChatMessage: (message) => this._chatSession.chatHistory.push(message),
            getTerminal: () => this._terminal,
            injectSystemMessage: (message) => this.injectSystemMessage(message),
            invalidateContextCaches: (scope) => this.invalidateContextCaches(scope),
            setTerminal: (terminal) => { this._terminal = terminal; }
        });
    }

    // ============================================================
    // Webview HTML — CINEMATIC UI v3 (Content-Grade Visuals)
    // ============================================================
    private _getHtml(webview: vscode.Webview): string {
        return getChatWebviewHtml(this._extensionUri, webview);
    }
}
