import type { ChatMessage } from './types';

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

    return {
        model,
        messages,
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
