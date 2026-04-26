export interface WebviewMessageRouterHost {
    handleBrainMenu(): Promise<void>;
    handleInjectLocalBrain(files: any[]): Promise<void>;
    handlePrompt(prompt: string, modelName: string, internetEnabled?: boolean): Promise<void>;
    handlePromptWithFile(prompt: string, modelName: string, files: any[], internetEnabled?: boolean): Promise<void>;
    handleSettingsMenu(): Promise<void>;
    regenerate(): Promise<void>;
    resetChat(): void;
    restoreDisplayMessages(): void;
    sendModels(): Promise<void>;
    showBrainNetwork(): void;
    showTerminal(): void;
    stopGeneration(): void;
    fetchUris(uris: string[], requestId?: string): Promise<void>;
    openAttachment(file: { name?: string; sourceUri?: string }): Promise<void>;
}

export async function routeWebviewMessage(message: any, host: WebviewMessageRouterHost): Promise<void> {
    switch (message.type) {
        case 'getModels':
            await host.sendModels();
            break;
        case 'prompt':
            await host.handlePrompt(message.value, message.model, message.internet);
            break;
        case 'promptWithFile':
            await host.handlePromptWithFile(message.value, message.model, message.files, message.internet);
            break;
        case 'newChat':
            host.resetChat();
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
            await host.regenerate();
            break;
        case 'showTerminal':
            host.showTerminal();
            break;
        case 'fetchUris':
            await host.fetchUris(message.uris, message.requestId);
            break;
        case 'openAttachment':
            await host.openAttachment(message.file || {});
            break;
    }
}
