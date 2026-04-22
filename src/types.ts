export type ChatRole = 'system' | 'user' | 'assistant';

export interface ConnectAiConfig {
    ollamaBase: string;
    defaultModel: string;
    maxTreeFiles: number;
    timeout: number;
    localBrainPath: string;
}

export interface ChatMessage {
    role: ChatRole;
    content: any;
}

export interface AttachedFile {
    name: string;
    type: string;
    data: string;
}

export interface DisplayMessage {
    role: string;
    text: string;
    files?: Pick<AttachedFile, 'name' | 'type' | 'data'>[];
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
