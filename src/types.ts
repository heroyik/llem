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
    mcpEnabled: boolean;
    mcpServers: McpServersConfig;
    mcpConfigSources: string[];
    mcpConfigPaths: string[];
}

export interface McpServerConfig {
    type?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    url?: string;
    headers?: Record<string, string>;
    disabled?: boolean;
    enabled?: boolean;
    timeoutSeconds?: number;
    startupTimeoutSeconds?: number;
    toolTimeoutSeconds?: number;
    source?: string;
    enabledTools?: string[];
    disabledTools?: string[];
    [key: string]: unknown;
}

export type McpServersConfig = Record<string, McpServerConfig>;

export interface McpResolvedServer {
    name: string;
    config: McpServerConfig;
    source: string;
    transport: 'stdio' | 'http' | 'sse' | 'unknown';
    supported: boolean;
    disabled: boolean;
    warning?: string;
}

export interface McpToolSummary {
    server: string;
    name: string;
    description?: string;
    inputSchema?: unknown;
}

export interface McpCallResult {
    ok: boolean;
    server: string;
    tool?: string;
    text: string;
    raw?: unknown;
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
    capabilities?: string[];
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
    scheduledAt?: number;
    retryCount?: number;
}

export interface QueueRequestSummary {
    id: string;
    kind: QueueRequestKind;
    prompt: string;
    modelName: string;
    internetEnabled?: boolean;
    messageIndex?: number;
    createdAt: number;
    scheduledAt?: number;
    retryCount?: number;
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
