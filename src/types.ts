export type ChatRole = 'system' | 'user' | 'assistant';
export type PerformancePreset = 'auto' | 'balanced' | 'large-local-26b';
export type ResolvedPerformancePreset = 'balanced' | 'large-local-26b';

export interface LlemConfig {
    bridgeEnabled: boolean;
    bridgeToken: string;
    ollamaBase: string;
    defaultModel: string;
    performancePreset: PerformancePreset;
    maxTreeFiles: number;
    timeout: number;
    vaultPath: string;
}

export interface ModelContextBudget {
    totalPromptChars: number;
    activeEditorChars: number;
    workspaceChars: number;
    vaultChars: number;
    attachmentFileChars: number;
    attachmentTotalChars: number;
}

export interface ModelRequestTuning {
    numCtx: number;
    initialPredict: number;
    followupPredict: number;
    repeatPenalty: number;
}

export interface InstalledModelInfo {
    name: string;
    parameterSize?: string;
    family?: string;
}

export interface ModelProfile {
    modelName: string;
    requestedPreset: PerformancePreset;
    resolvedPreset: ResolvedPerformancePreset;
    estimatedParameterSizeB?: number;
    family?: string;
    requestTuning: ModelRequestTuning;
    contextBudget?: ModelContextBudget;
    warningTimeoutMs?: number;
}

export interface ChatMessage {
    role: ChatRole;
    content: any;
}

export interface AttachedFile {
    name: string;
    type: string;
    data: string;
    sourceUri?: string;
    truncated?: boolean;
    originalSize?: number;
}

export interface DisplayMessage {
    role: string;
    text: string;
    files?: Pick<AttachedFile, 'name' | 'type' | 'data' | 'sourceUri' | 'truncated' | 'originalSize'>[];
    feedback?: 'like' | 'dislike' | null;
}

export type QueueRequestKind = 'prompt' | 'promptWithFile' | 'editMessage' | 'regenerate';

export interface QueuedRequest {
    id: string;
    kind: QueueRequestKind;
    prompt: string;
    modelName: string;
    files?: AttachedFile[];
    internetEnabled?: boolean;
    messageIndex?: number;
    createdAt: number;
    wasQueued?: boolean;
}

export interface QueueRequestSummary {
    id: string;
    kind: QueueRequestKind;
    prompt: string;
    modelName: string;
    internetEnabled?: boolean;
    messageIndex?: number;
    createdAt: number;
    attachmentCount: number;
}

export interface QueueStatePayload {
    running: boolean;
    paused: boolean;
    activeRequest?: QueueRequestSummary;
    pendingRequests: QueueRequestSummary[];
}

export interface AIEndpoint {
    apiUrl: string;
    isLMStudio: boolean;
}

export interface StreamOptions {
    modelName: string;
    messages: ChatMessage[];
    endpoint: AIEndpoint;
    timeout: number;
    temperature: number;
    topP: number;
    topK: number;
    contextWindow?: number;
    predictTokens?: number;
    repeatPenalty?: number;
    signal?: AbortSignal;
}

export interface TextContextCache {
    key: string;
    value: string;
    expiresAt: number;
}

export interface BrainFilesCache {
    key: string;
    files: string[];
    expiresAt: number;
}

export interface ChatHistoryMetadata {
    id: string;
    title: string;
    lastModified: number;
}

export interface ChatHistoryItem extends ChatHistoryMetadata {
    chatHistory: ChatMessage[];
    displayMessages: DisplayMessage[];
}
