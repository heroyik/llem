import axios from 'axios';
import type { AIEndpoint, ChatMessage, ConnectAiConfig, StreamOptions } from './types';
import { getConfig } from './config';

export function stripTrailingSlash(value: string): string {
    return value.endsWith('/') ? value.slice(0, -1) : value;
}

function isLMStudioBase(baseUrl: string): boolean {
    return baseUrl.includes('1234') || baseUrl.includes('/v1') || baseUrl.endsWith('v1');
}

export function normalizeAIEndpoint(baseUrl: string): AIEndpoint {
    let base = stripTrailingSlash(baseUrl);
    const isLMStudio = isLMStudioBase(base);
    if (isLMStudio && !base.endsWith('/v1')) {
        base += '/v1';
    }

    return {
        isLMStudio,
        apiUrl: isLMStudio ? `${base}/chat/completions` : `${base}/api/chat`
    };
}

export async function resolveAIEndpoint(config: ConnectAiConfig): Promise<AIEndpoint> {
    const endpoint = normalizeAIEndpoint(config.ollamaBase);
    if (endpoint.isLMStudio) {
        return endpoint;
    }

    try {
        await axios.get(`${stripTrailingSlash(config.ollamaBase)}/api/tags`, { timeout: 1000 });
        return endpoint;
    } catch {
        return {
            isLMStudio: true,
            apiUrl: 'http://127.0.0.1:1234/v1/chat/completions'
        };
    }
}

function buildStreamBody(
    model: string,
    messages: ChatMessage[],
    isLMStudio: boolean,
    temperature: number,
    topP: number,
    topK: number
) {
    return {
        model,
        messages,
        stream: true,
        ...(isLMStudio
            ? { max_tokens: 4096, temperature, top_p: topP }
            : { options: { num_ctx: 16384, num_predict: 4096, temperature, top_p: topP, top_k: topK } }),
    };
}

function extractStreamToken(line: string, isLMStudio: boolean): string {
    if (!line.trim() || line.trim() === 'data: [DONE]') {
        return '';
    }

    const raw = line.startsWith('data: ') ? line.slice(6) : line;
    const json = JSON.parse(raw);
    if (json.error) {
        return `[API 오류] ${json.error.message || json.error}`;
    }
    return isLMStudio
        ? json.choices?.[0]?.delta?.content || ''
        : json.message?.content || '';
}

export async function streamCompletion(options: StreamOptions, onToken: (token: string) => void): Promise<string> {
    const response = await axios.post(options.endpoint.apiUrl, {
        ...buildStreamBody(
            options.modelName,
            options.messages,
            options.endpoint.isLMStudio,
            options.temperature,
            options.topP,
            options.topK
        ),
    }, {
        timeout: options.timeout,
        responseType: 'stream',
        signal: options.signal
    });

    let output = '';
    await new Promise<void>((resolve, reject) => {
        const stream = response.data;
        let buffer = '';
        stream.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                try {
                    const token = extractStreamToken(line, options.endpoint.isLMStudio);
                    if (token) {
                        output += token;
                        onToken(token);
                    }
                } catch {
                    // Ignore malformed partial JSON chunks.
                }
            }
        });
        stream.on('end', () => resolve());
        stream.on('error', (err: any) => reject(err));
    });

    return output;
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
