export interface WebviewMessageRouterHost {
    handleBrainMenu(): Promise<void>;
    handleInjectLocalBrain(files: any[]): Promise<void>;
    handleSettingsMenu(): Promise<void>;
    resetChat(): void;
    restoreDisplayMessages(): void;
    sendModels(): Promise<void>;
    showBrainNetwork(): void;
    showTerminal(): void;
    reviewChanges(): void;
    stopGeneration(): void;
    openExternalUrl(url: string): Promise<void>;
    fetchUris(uris: string[], requestId?: string): Promise<void>;
    openAttachment(file: { name?: string; sourceUri?: string; line?: number }): Promise<void>;
    branchChat(messageIndex: number): Promise<void>;
    enqueueRequest(request: {
        kind: 'prompt' | 'promptWithFile' | 'editMessage' | 'regenerate';
        prompt: string;
        modelName: string;
        files?: any[];
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
    getWorkspaceFiles(): Promise<void>;
    getMcpServers(): Promise<void>;
    setGlobalMcpEnabled(enabled: boolean): Promise<void>;
    setMcpServerEnabled(name: string, enabled: boolean): Promise<void>;
    reloadMcpServers(): Promise<void>;
    syncCodexMcpServers(): Promise<void>;
    importMcpFromGitHub(): Promise<void>;
    setDefaultModel(modelName: string): Promise<void>;
    setExecutionMode(mode: 'default' | 'plan' | 'agent'): Promise<void>;
    log(message: string, level: 'info' | 'error'): void;
}

export async function routeWebviewMessage(message: any, host: WebviewMessageRouterHost): Promise<void> {
    switch (message.type) {
        case 'getModels':
            await host.sendModels();
            break;
        case 'getWorkspaceFiles':
            await host.getWorkspaceFiles();
            break;
        case 'getMcpServers':
            await host.getMcpServers();
            break;
        case 'setGlobalMcpEnabled':
            await host.setGlobalMcpEnabled(Boolean(message.enabled));
            break;
        case 'setMcpServerEnabled':
            await host.setMcpServerEnabled(String(message.name || ''), Boolean(message.enabled));
            break;
        case 'reloadMcpServers':
            await host.reloadMcpServers();
            break;
        case 'syncCodexMcpServers':
            await host.syncCodexMcpServers();
            break;
        case 'importMcpFromGitHub':
            await host.importMcpFromGitHub();
            break;
        case 'setDefaultModel':
            await host.setDefaultModel(message.model);
            break;
        case 'setExecutionMode':
            await host.setExecutionMode(message.mode);
            break;
        case 'prompt':
            await host.enqueueRequest({
                kind: 'prompt',
                prompt: message.value,
                modelName: message.model,
                internetEnabled: message.internet
            });
            break;
        case 'promptWithFile':
            await host.enqueueRequest({
                kind: 'promptWithFile',
                prompt: message.value,
                modelName: message.model,
                files: message.files,
                internetEnabled: message.internet
            });
            break;
        case 'newChat':
            await host.resetChat();
            break;
        case 'ready':
            host.restoreDisplayMessages();
            break;
        case 'openSettings':
            await host.handleSettingsMenu();
            break;
        case 'syncBrain':
            await host.handleBrainMenu();
            break;
        case 'showBrainNetwork':
            host.showBrainNetwork();
            break;
        case 'injectLocalBrain':
            await host.handleInjectLocalBrain(message.files);
            break;
        case 'stopGeneration':
            host.stopGeneration();
            break;
        case 'regenerate':
            await host.enqueueRequest({
                kind: 'regenerate',
                prompt: '',
                modelName: ''
            });
            break;
        case 'showTerminal':
            host.showTerminal();
            break;
        case 'reviewChanges':
            host.reviewChanges();
            break;
        case 'openExternalUrl':
            await host.openExternalUrl(message.url || '');
            break;
        case 'fetchUris':
            await host.fetchUris(message.uris, message.requestId);
            break;
        case 'enqueueRequest':
            await host.enqueueRequest(message.request || {});
            break;
        case 'cancelQueuedRequest':
            await host.cancelQueuedRequest(message.id);
            break;
        case 'clearQueuedRequests':
            await host.clearQueuedRequests();
            break;
        case 'moveQueuedRequest':
            await host.moveQueuedRequest(message.id, message.direction);
            break;
        case 'editQueuedRequest':
            await host.editQueuedRequest(message.id);
            break;
        case 'resumeQueue':
            await host.resumeQueue();
            break;
        case 'openAttachment':
            await host.openAttachment(message.file || {});
            break;
        case 'branchChat':
            await host.branchChat(message.messageIndex);
            break;
        case 'editMessage':
            await host.enqueueRequest({
                kind: 'editMessage',
                prompt: message.value,
                modelName: message.model,
                files: message.files || [],
                internetEnabled: message.internet,
                messageIndex: message.messageIndex
            });
            break;
        case 'setMessageFeedback':
            await host.setMessageFeedback(message.messageIndex, message.feedback ?? null);
            break;
        case 'getHistory':
            await host.getHistory();
            break;
        case 'loadHistory':
            await host.loadHistory(message.id);
            break;
        case 'deleteHistory':
            await host.deleteHistory(message.id);
            break;
        case 'deleteAllHistory':
            await host.deleteAllHistory();
            break;
        case 'requestDeleteHistory':
            await host.requestDeleteHistory(message.id, message.title);
            break;
        case 'requestClearAllHistory':
            await host.requestClearAllHistory();
            break;
        case 'log':
            if (message.level === 'error') {
                host.log(message.value, 'error');
            } else {
                host.log(message.value, 'info');
            }
            break;
    }
}
