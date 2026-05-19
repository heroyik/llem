import type { ChatMessage } from './types';

export function stripInvalidUnicodeSurrogates(value: string): string {
    let result = '';
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                result += value[index] + value[index + 1];
                index++;
            }
            continue;
        }
        if (code >= 0xdc00 && code <= 0xdfff) {
            continue;
        }
        result += value[index];
    }
    return result;
}

export function sanitizeStreamBodyValue<T>(value: T): T {
    if (typeof value === 'string') {
        return stripInvalidUnicodeSurrogates(value) as T;
    }
    if (Array.isArray(value)) {
        return value.map(item => sanitizeStreamBodyValue(item)) as T;
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
                key,
                sanitizeStreamBodyValue(entry)
            ])
        ) as T;
    }
    return value;
}

export function buildStreamBody(
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
    const defaultPredict = 4096;
    const finalPredict = (predictTokens && predictTokens > 0) ? predictTokens : defaultPredict;
    const safeMessages = sanitizeStreamBodyValue(messages);

    return {
        model: stripInvalidUnicodeSurrogates(model),
        messages: safeMessages,
        stream: true,
        ...(isLMStudio
            ? {
                max_tokens: finalPredict,
                temperature,
                top_p: topP,
                top_k: topK,
                ...(repeatPenalty ? { repetition_penalty: repeatPenalty } : {})
            }
            : {
                think: false,
                options: {
                    num_ctx: contextWindow ?? 8192,
                    num_predict: predictTokens ?? finalPredict,
                    repeat_penalty: repeatPenalty ?? 1.1,
                    temperature,
                    top_p: topP,
                    top_k: topK,
                    stop: ['<|endoftext|>', '### Instruction:', '### Response:']
                }
            }),
    };
}
