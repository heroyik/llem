import axios from 'axios';
import type { AIEndpoint, ChatMessage, LlemConfig, StreamOptions } from './types';
import { getConfig } from './config';
import { extractStreamToken, parseStreamBuffer } from './streamParsing';
import { logInfo, logStreamEvent, logStructured } from './logger';
import { completedStreamOutcome, interruptedStreamOutcome, type StreamOutcome } from './streamOutcome';

const ENDPOINT_CACHE_TTL_MS = 60_000;
const REASONING_ONLY_ERROR = 'The selected model streamed reasoning without a final answer. Disable thinking for this model or choose one that returns answer content.';

let endpointCache: { baseUrl: string; endpoint: AIEndpoint; expiresAt: number } | undefined;

function createStreamId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function summarizeMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
    return messages.map((message, index) => {
        const contentArray = Array.isArray(message.content) ? message.content : [];
        const imageUrlParts = contentArray.filter((part: any) =>
            part?.type === 'image_url' || part?.type === 'input_image'
        );
        const ollamaImages = Array.isArray((message as any).images) ? (message as any).images : [];
        return {
            index,
            role: message.role,
            contentType: Array.isArray(message.content) ? 'array' : typeof message.content,
            charLength: typeof message.content === 'string'
                ? message.content.length
                : JSON.stringify(message.content || '').length,
            ollamaImageCount: ollamaImages.length,
            ollamaImageBytes: ollamaImages.reduce((sum: number, data: unknown) => sum + String(data || '').length, 0),
            imagePartCount: imageUrlParts.length
        };
    });
}

export function stripTrailingSlash(value: string): string {
    return value.endsWith('/') ? value.slice(0, -1) : value;
}

function hasPort(baseUrl: string, port: string): boolean {
    try {
        return new URL(baseUrl).port === port;
    } catch {
        return baseUrl.includes(`:${port}`);
    }
}

function isOpenAICompatibleBase(baseUrl: string): boolean {
    return hasPort(baseUrl, '1234')
        || hasPort(baseUrl, '8000')
        || baseUrl.includes('/v1')
        || baseUrl.endsWith('v1')
        || baseUrl.toLowerCase().includes('rapid-mlx');
}

function detectEngineKind(baseUrl: string): AIEndpoint['engineKind'] {
    const lower = baseUrl.toLowerCase();
    if (hasPort(baseUrl, '1234')) {
        return 'lm-studio';
    }
    if (hasPort(baseUrl, '8000') || lower.includes('rapid-mlx')) {
        return 'rapid-mlx';
    }
    if (isOpenAICompatibleBase(baseUrl)) {
        return 'openai-compatible';
    }
    return 'ollama';
}

export function getEngineDisplayName(baseUrl: string): string {
    if (hasPort(baseUrl, '1234')) {
        return 'LM Studio';
    }
    if (hasPort(baseUrl, '8000') || baseUrl.toLowerCase().includes('rapid-mlx')) {
        return 'Rapid-MLX';
    }
    if (baseUrl.includes('/v1') || baseUrl.endsWith('v1')) {
        return 'OpenAI-compatible local engine';
    }
    return 'Ollama';
}

export function normalizeAIEndpoint(baseUrl: string): AIEndpoint {
    let base = stripTrailingSlash(baseUrl);
    const isLMStudio = isOpenAICompatibleBase(base);
    const engineKind = detectEngineKind(base);
    if (base.endsWith('/chat/completions')) {
        base = stripTrailingSlash(base.slice(0, -'/chat/completions'.length));
    }
    if (isLMStudio && !base.endsWith('/v1')) {
        base += '/v1';
    }

    return {
        isLMStudio,
        engineKind,
        apiUrl: isLMStudio ? `${base}/chat/completions` : `${base}/api/chat`
    };
}

export async function resolveAIEndpoint(config: LlemConfig): Promise<AIEndpoint> {
    const now = Date.now();
    if (endpointCache && endpointCache.baseUrl === config.ollamaBase && endpointCache.expiresAt > now) {
        return endpointCache.endpoint;
    }

    const endpoint = normalizeAIEndpoint(config.ollamaBase);
    if (endpoint.isLMStudio) {
        endpointCache = { baseUrl: config.ollamaBase, endpoint, expiresAt: now + ENDPOINT_CACHE_TTL_MS };
        return endpoint;
    }

    try {
        await axios.get(`${stripTrailingSlash(config.ollamaBase)}/api/tags`, { timeout: 1000 });
        endpointCache = { baseUrl: config.ollamaBase, endpoint, expiresAt: now + ENDPOINT_CACHE_TTL_MS };
        return endpoint;
    } catch {
        const fallback = {
            isLMStudio: true,
            engineKind: 'lm-studio' as const,
            apiUrl: 'http://127.0.0.1:1234/v1/chat/completions'
        };
        endpointCache = { baseUrl: config.ollamaBase, endpoint: fallback, expiresAt: now + ENDPOINT_CACHE_TTL_MS };
        return fallback;
    }
}

function buildStreamBody(
    model: string,
    messages: ChatMessage[],
    isLMStudio: boolean,
    temperature: number,
    topP: number,
    topK: number,
    contextWindow?: number,
    predictTokens?: number,
    repeatPenalty?: number
) {
    // Determine a safe default for predictTokens if not provided
    const defaultPredict = 4096;
    const finalPredict = (predictTokens && predictTokens > 0) ? predictTokens : defaultPredict;

    return {
        model,
        messages,
        stream: true,
        ...(isLMStudio
            ? { 
                max_tokens: finalPredict,
                temperature, 
                top_p: topP 
            }
            : {
                think: false,
                options: {
                    num_ctx: contextWindow ?? 8192,
                    num_predict: predictTokens ?? finalPredict, // Use finalPredict if null
                    repeat_penalty: repeatPenalty ?? 1.1,
                    temperature,
                    top_p: topP,
                    top_k: topK,
                    stop: ["<|endoftext|>", "### Instruction:", "### Response:"] // Add common stop sequences
                }
            }),
    };
}

function containsReasoningTrace(rawText: string): boolean {
    return /"thinking"\s*:|"reasoning(?:_content|_text)?"\s*:|"thought"\s*:/.test(rawText);
}

export async function streamCompletion(options: StreamOptions, onToken: (token: string) => void): Promise<StreamOutcome> {
    const streamId = createStreamId();
    logStreamEvent(streamId, 'request_start', {
        endpoint: options.endpoint.apiUrl,
        isLMStudio: options.endpoint.isLMStudio,
        engineKind: options.endpoint.engineKind || (options.endpoint.isLMStudio ? 'openai-compatible' : 'ollama'),
        modelName: options.modelName,
        timeoutMs: options.timeout,
        temperature: options.temperature,
        topP: options.topP,
        topK: options.topK,
        contextWindow: options.contextWindow ?? null,
        predictTokens: options.predictTokens ?? null,
        repeatPenalty: options.repeatPenalty ?? null,
        messageCount: options.messages.length,
        messages: summarizeMessages(options.messages)
    });

    const response = await axios.post(options.endpoint.apiUrl, {
        ...buildStreamBody(
            options.modelName,
            options.messages,
            options.endpoint.isLMStudio,
            options.temperature,
            options.topP,
            options.topK,
            options.contextWindow,
            options.predictTokens,
            options.repeatPenalty
        ),
    }, {
        timeout: options.timeout,
        responseType: 'stream',
        signal: options.signal
    });

    let output = '';
    let rawPreview = '';
    let chunkIndex = 0;
    let repetitionDetected = false;
    let resolved = false;
    await new Promise<void>((resolve, reject) => {
        const resolveOnce = () => {
            if (resolved) {
                return;
            }
            resolved = true;
            resolve();
        };
        const stream = response.data;
        let buffer = '';
        stream.on('data', (chunk: Buffer) => {
            if (repetitionDetected) return;
            const chunkText = chunk.toString();
            const bufferBefore = buffer.length;
            buffer += chunkText;
            if (rawPreview.length < 8000) {
                rawPreview += chunkText.slice(0, 8000 - rawPreview.length);
            }
            const parsed = parseStreamBuffer(buffer, options.endpoint.isLMStudio);
            buffer = parsed.remainder;
            logStreamEvent(streamId, 'raw_chunk', {
                chunkIndex,
                chunkBytes: chunk.length,
                chunkChars: chunkText.length,
                bufferBefore,
                bufferAfterAppend: bufferBefore + chunkText.length,
                tokensParsed: parsed.tokens.length,
                remainderChars: buffer.length,
                chunkText
            });
            if (parsed.tokens.length > 0) {
                logStreamEvent(streamId, 'parsed_tokens', {
                    chunkIndex,
                    tokens: parsed.tokens
                });
            }
            for (const token of parsed.tokens) {
                if (repetitionDetected) continue;
                output += token;
                onToken(token);

            }
            chunkIndex += 1;
        });
        stream.on('end', () => {
            if (repetitionDetected) {
                resolveOnce();
                return;
            }
            const parsed = parseStreamBuffer(buffer, options.endpoint.isLMStudio, true);
            logStreamEvent(streamId, 'stream_end_flush', {
                trailingBufferChars: buffer.length,
                tokensParsed: parsed.tokens.length,
                remainderChars: parsed.remainder.length,
                trailingBuffer: buffer
            });
            for (const token of parsed.tokens) {
                output += token;
                onToken(token);
            }
            resolveOnce();
        });
        stream.on('error', (err: any) => {
            if (repetitionDetected) {
                resolveOnce();
                return;
            }
            logStreamEvent(streamId, 'stream_error', {
                name: err?.name || 'Error',
                message: err?.message || String(err)
            });
            reject(err);
        });
    });

    if (!output.trim()) {
        const preview = rawPreview
            .replace(/\r/g, '\\r')
            .replace(/\n/g, '\\n')
            .slice(0, 1000);
        logInfo(`[STREAM] Completed with empty parsed output from ${options.endpoint.apiUrl}. Raw preview: ${preview || '(empty)'}`);
        logStreamEvent(streamId, 'empty_output', {
            rawPreview,
            outputLength: output.length
        });

        if (containsReasoningTrace(rawPreview)) {
            const reasoningOnlyError = new Error(REASONING_ONLY_ERROR);
            reasoningOnlyError.name = 'ReasoningOnlyStreamError';
            throw reasoningOnlyError;
        }
    }

    logStreamEvent(streamId, 'request_complete', {
        outputLength: output.length,
        outputPreview: output.slice(0, 1000),
        chunkCount: chunkIndex
    });
    logStructured('stream_completion_summary', {
        streamId,
        endpoint: options.endpoint.apiUrl,
        modelName: options.modelName,
        outputLength: output.length,
        chunkCount: chunkIndex
    });

    return completedStreamOutcome(output);
}

function buildNonStreamingBody(model: string, prompt: string): Record<string, unknown> {
    return {
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false
    };
}

export async function runLocalChatCompletion(prompt: string, config = getConfig()): Promise<string> {
    const endpoint = normalizeAIEndpoint(config.ollamaBase);
    const response = await axios.post(
        endpoint.apiUrl,
        buildNonStreamingBody(config.defaultModel, prompt),
        { timeout: config.timeout }
    );

    if (response.data?.error) {
        const error = response.data.error;
        throw new Error(typeof error === 'string' ? error : JSON.stringify(error));
    }

    return endpoint.isLMStudio
        ? response.data.choices?.[0]?.message?.content || ''
        : response.data.message?.content || '';
}
