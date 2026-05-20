import * as vscode from 'vscode';
import type { WebviewMessageRouterHost } from './webviewMessageRouter';
import type { QueueRequestKind, AttachedFile } from './types';
import { logInfo, logError } from './logger';

export interface RouterHostDeps {
    handleBrainMenu(): Promise<void>;
    handleInjectLocalBrain(files: any[]): Promise<void>;
    handleSettingsMenu(): Promise<void>;
    resetChat(): Promise<void>;
    restoreDisplayMessages(): void;
    sendExecutionMode(): void;
    sendModels(): Promise<void>;
    showTerminal(): void;
    reviewChanges(): void;
    stopGeneration(): void;
    openExternalUrl(url: string): Promise<void>;
    fetchUris(uris: string[], requestId?: string): Promise<void>;
    openAttachment(file: { name?: string; sourceUri?: string; line?: number }): Promise<void>;
    branchChat(messageIndex: number): Promise<void>;
    enqueueWebviewRequest(request: {
        kind?: QueueRequestKind;
        prompt?: string;
        modelName?: string;
        files?: AttachedFile[];
        internetEnabled?: boolean;
        messageIndex?: number;
    }): Promise<void>;
    cancelQueuedRequest(id: string): Promise<void>;
    clearQueuedRequests(): Promise<void>;
    moveQueuedRequest(id: string, direction: 'up' | 'down'): Promise<void>;
    editQueuedRequest(id: string): Promise<void>;
    resumeQueue(): Promise<void>;
    setMessageFeedback(messageIndex: number, feedback: 'like' | 'dislike' | null): Promise<void>;
    getHistory(): Promise<void>;
    loadHistory(id: string): Promise<void>;
    deleteHistory(id: string): Promise<void>;
    deleteAllHistory(): Promise<void>;
    requestDeleteHistory(id: string, title: string): Promise<void>;
    requestClearAllHistory(): Promise<void>;
    sendWorkspaceFiles(): Promise<void>;
    sendMcpServers(): Promise<void>;
    setGlobalMcpEnabled(enabled: boolean): Promise<void>;
    setMcpServerEnabled(name: string, enabled: boolean): Promise<void>;
    reloadMcpServers(): Promise<void>;
    syncCodexMcpServers(): Promise<void>;
    importMcpFromGitHub(): Promise<void>;
    setDefaultModel(modelName: string): Promise<void>;
    setExecutionMode(mode: 'default' | 'plan' | 'agent'): Promise<void>;
    setEngine(engine: string): Promise<void>;
    setPerformanceProfile(profile: string): Promise<void>;
    setSamplingParam(key: string, value: number): Promise<void>;
    setSystemPromptFromWebview(value: string): Promise<void>;
    resetRapidMlxParams(): Promise<void>;
    resetSystemPromptFromWebview(): Promise<void>;
    sendSettingsData(): Promise<void>;
    fetchFileContent(path: string, requestId?: string): Promise<void>;
}

export function createWebviewMessageRouterHost(deps: RouterHostDeps): WebviewMessageRouterHost {
    return {
        handleBrainMenu: () => deps.handleBrainMenu(),
        handleInjectLocalBrain: (files) => deps.handleInjectLocalBrain(files),
        handleSettingsMenu: () => deps.handleSettingsMenu(),
        resetChat: () => deps.resetChat(),
        restoreDisplayMessages: () => {
            deps.restoreDisplayMessages();
            deps.sendExecutionMode();
        },
        sendModels: () => deps.sendModels(),
        showBrainNetwork: () => vscode.commands.executeCommand('llem.showVaultMap'),
        showTerminal: () => deps.showTerminal(),
        reviewChanges: () => deps.reviewChanges(),
        stopGeneration: () => deps.stopGeneration(),
        openExternalUrl: (url) => deps.openExternalUrl(url),
        fetchUris: (uris, requestId) => deps.fetchUris(uris, requestId),
        openAttachment: (file) => deps.openAttachment(file),
        branchChat: (messageIndex) => deps.branchChat(messageIndex),
        enqueueRequest: (request) => deps.enqueueWebviewRequest(request),
        cancelQueuedRequest: (id) => deps.cancelQueuedRequest(id),
        clearQueuedRequests: () => deps.clearQueuedRequests(),
        moveQueuedRequest: (id, direction) => deps.moveQueuedRequest(id, direction),
        editQueuedRequest: (id) => deps.editQueuedRequest(id),
        resumeQueue: () => deps.resumeQueue(),
        setMessageFeedback: (messageIndex, feedback) => deps.setMessageFeedback(messageIndex, feedback),
        getHistory: () => deps.getHistory(),
        loadHistory: (id) => deps.loadHistory(id),
        deleteHistory: (id) => deps.deleteHistory(id),
        deleteAllHistory: () => deps.deleteAllHistory(),
        requestDeleteHistory: (id, title) => deps.requestDeleteHistory(id, title),
        requestClearAllHistory: () => deps.requestClearAllHistory(),
        getWorkspaceFiles: () => deps.sendWorkspaceFiles(),
        getMcpServers: () => deps.sendMcpServers(),
        setGlobalMcpEnabled: (enabled) => deps.setGlobalMcpEnabled(enabled),
        setMcpServerEnabled: (name, enabled) => deps.setMcpServerEnabled(name, enabled),
        reloadMcpServers: () => deps.reloadMcpServers(),
        syncCodexMcpServers: () => deps.syncCodexMcpServers(),
        importMcpFromGitHub: () => deps.importMcpFromGitHub(),
        setDefaultModel: (modelName) => deps.setDefaultModel(modelName),
        setExecutionMode: (mode) => deps.setExecutionMode(mode),
        setEngine: (engine) => deps.setEngine(engine),
        setPerformanceProfile: (profile) => deps.setPerformanceProfile(profile),
        setSamplingParam: (key, value) => deps.setSamplingParam(key, value),
        setSystemPromptFromWebview: (value) => deps.setSystemPromptFromWebview(value),
        resetRapidMlxParams: () => deps.resetRapidMlxParams(),
        resetSystemPromptFromWebview: () => deps.resetSystemPromptFromWebview(),
        getSettingsData: () => deps.sendSettingsData(),
        fetchFileContent: (path, requestId) => deps.fetchFileContent(path, requestId),
        log: (message, level) => {
            if (level === 'error') logError(message, false);
            else logInfo(message);
        }
    };
}
