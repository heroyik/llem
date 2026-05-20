import axios from 'axios';
import { normalizeChatMessages } from './chatPipelineHelpers';
import { streamCompletion } from './aiClient';
import { logInfo, logStreamEvent } from './logger';
import { PerfLogger } from './perfLogger';
import { RepetitionWatchdog } from './repetitionWatchdog';
import { RAPID_MLX_IMAGE_SAMPLING, buildRapidMlxTextSamplingProfile } from './samplingProfiles';
import type { AIEndpoint, ChatMessage, ModelProfile } from './types';
import type { StreamOutcome } from './streamOutcome';

export interface StreamManagerDeps {
    postWebviewMessage(message: unknown): void;
    getTemperature(): number;
    getTopK(): number;
    getTopP(): number;
    getRapidMlxTextSampling(): import('./samplingProfiles').RapidMlxTextSamplingSettings;
}

export interface StreamManager {
    streamMessages(
        endpoint: AIEndpoint,
        messages: ChatMessage[],
        modelName: string,
        timeout: number,
        signal?: AbortSignal,
        modelProfile?: ModelProfile,
        phase?: 'initial' | 'followup'
    ): Promise<StreamOutcome>;
    postStreamErrorDetail(error: any, formatDetail: (detail: string) => string): void;
}

export function createStreamManager(deps: StreamManagerDeps): StreamManager {
    function buildLivePreview(text: string): string {
        if (!text) {
            return '';
        }

        return text
            .replace(/(?:<|call:)\s*create_file\s+path="([^"]+)"[^>]*>[\s\S]*?<\/create_file>/gi, '\n📁 Creating file: $1\n')
            .replace(/(?:<|call:)\s*edit_file\s+path="([^"]+)"[^>]*>[\s\S]*?<\/edit_file>/gi, '\n✏️ Editing file: $1\n')
            .replace(/(?:<|call:)\s*create_file\s+path="([^"]+)"[^>]*>[\s\S]*$/gi, '\n📁 Creating file: $1\n')
            .replace(/(?:<|call:)\s*edit_file\s+path="([^"]+)"[^>]*>[\s\S]*$/gi, '\n✏️ Editing file: $1\n')
            .replace(/<\/?(?:find|replace)\b[^>]*>/gi, '')
            .replace(/\n{3,}/g, '\n\n');
    }

    function createCombinedSignal(s1: AbortSignal, s2: AbortSignal): AbortSignal {
        const controller = new AbortController();
        const onAbort = () => controller.abort();
        s1.addEventListener('abort', onAbort);
        s2.addEventListener('abort', onAbort);
        return controller.signal;
    }

    async function streamMessages(
        endpoint: AIEndpoint,
        messages: ChatMessage[],
        modelName: string,
        timeout: number,
        signal?: AbortSignal,
        modelProfile?: ModelProfile,
        phase: 'initial' | 'followup' = 'initial'
    ): Promise<StreamOutcome> {
        const streamStart = performance.now();
        let firstTokenTime = 0;
        let tokenCount = 0;

        const normalizedMessages = normalizeChatMessages(messages);
        const roles = normalizedMessages.map(m => m.role);
        logInfo(`[PIPELINE] Normalized messages for stream: roles=${JSON.stringify(roles)}`);
        const hasImages = normalizedMessages.some(message => Array.isArray(message.content)
            && message.content.some((part: any) => part?.type === 'image_url'));
        const useRapidMlxImageSafeProfile = endpoint.engineKind === 'rapid-mlx' && hasImages;
        const useRapidMlxTextSafeProfile = endpoint.engineKind === 'rapid-mlx' && !hasImages;
        const sampling = useRapidMlxImageSafeProfile
            ? RAPID_MLX_IMAGE_SAMPLING
            : useRapidMlxTextSafeProfile
                ? buildRapidMlxTextSamplingProfile(deps.getRapidMlxTextSampling())
                : undefined;

        // Repetition Watchdog
        const watchdog = new RepetitionWatchdog();
        let loopDetected = false;
        let loopResult = watchdog.getResult();
        let streamedText = '';

        const abortController = new AbortController();
        const combinedSignal = signal
            ? createCombinedSignal(signal, abortController.signal)
            : abortController.signal;

        let buffer = '';
        const flushBuffer = () => {
            if (buffer) {
                deps.postWebviewMessage({
                    type: 'streamChunk',
                    value: buffer,
                    preview: buildLivePreview(streamedText)
                });
                buffer = '';
            }
        };

        const flushInterval = setInterval(flushBuffer, 50);

        try {
            const result = await streamCompletion({
                endpoint,
                messages: normalizedMessages,
                modelName,
                timeout,
                temperature: sampling ? sampling.temperature : deps.getTemperature(),
                topP: sampling ? sampling.topP : deps.getTopP(),
                topK: sampling ? sampling.topK : deps.getTopK(),
                contextWindow: !endpoint.isLMStudio ? modelProfile?.requestTuning.numCtx : undefined,
                predictTokens: sampling
                    ? sampling.predictTokens
                    : !endpoint.isLMStudio
                    ? (phase === 'followup'
                        ? modelProfile?.requestTuning.followupPredict
                        : modelProfile?.requestTuning.initialPredict)
                    : undefined,
                repeatPenalty: sampling
                    ? sampling.repeatPenalty
                    : modelProfile?.requestTuning.repeatPenalty,
                samplingProfile: sampling?.profile,
                signal: combinedSignal
            }, token => {
                if (firstTokenTime === 0) {
                    firstTokenTime = performance.now();
                    PerfLogger.update({ streamFirstTokenMs: firstTokenTime - streamStart });
                }
                tokenCount++;
                buffer += token;
                streamedText += token;

                // Watchdog Logic
                if (!loopDetected && token.trim().length > 0) {
                    if (watchdog.addToken(token)) {
                        loopDetected = true;
                        loopResult = watchdog.getResult();
                        loopResult = {
                            ...loopResult,
                            cleanText: watchdog.cleanText(streamedText)
                        };
                        const reason = loopResult.reason || watchdog.getAbortedReason();
                        const recentPreview = streamedText.slice(-240).replace(/\s+/g, ' ').trim();
                        logInfo(`[WATCHDOG] Loop detected (${reason}). Aborting stream. Recent output: ${recentPreview}`);
                        logStreamEvent('watchdog', 'repetition_stop', {
                            repeatedKind: loopResult.kind,
                            repeatedToken: loopResult.repeatedToken,
                            cleanChars: loopResult.cleanText.length,
                            retryable: loopResult.retryable,
                            reason
                        });
                        abortController.abort();
                    }
                }
            });

            clearInterval(flushInterval);
            flushBuffer();

            const totalSeconds = (performance.now() - firstTokenTime) / 1000;
            const totalMs = performance.now() - streamStart;
            PerfLogger.update({
                streamTotalMs: totalMs,
                streamTotalTokens: tokenCount,
                streamTokensPerSecond: firstTokenTime > 0 && totalSeconds > 0 ? tokenCount / totalSeconds : 0
            });

            if (loopDetected && !result.repeated) {
                let text = loopResult.cleanText || streamedText || result.text;
                // Tag correction: close unclosed action tags
                if (text.includes('<edit_file') && !text.includes('</edit_file>')) text += '\n</edit_file>';
                if (text.includes('<create_file') && !text.includes('</create_file>')) text += '\n</create_file>';
                if (text.includes('<run_command') && !text.includes('</run_command>')) text += '\n</run_command>';

                return {
                    text,
                    stopReason: 'watchdog_loop',
                    repeated: true,
                    aborted: true,
                    repeatedKind: loopResult.kind,
                    repeatedToken: loopResult.repeatedToken,
                    retryable: loopResult.retryable,
                    cleanText: text
                };
            }
            return result;
        } catch (err: any) {
            clearInterval(flushInterval);
            flushBuffer();
            if (loopDetected || err?.name === 'AbortError' || axios.isCancel(err)) {
                let text = loopDetected ? (loopResult.cleanText || streamedText) : streamedText;
                // Tag correction: close unclosed action tags
                if (text.includes('<edit_file') && !text.includes('</edit_file>')) text += '\n</edit_file>';
                if (text.includes('<create_file') && !text.includes('</create_file>')) text += '\n</create_file>';
                if (text.includes('<run_command') && !text.includes('</run_command>')) text += '\n</run_command>';

                return {
                    text,
                    stopReason: loopDetected ? 'watchdog_loop' : 'manual_abort',
                    repeated: loopDetected,
                    aborted: true,
                    repeatedKind: loopDetected ? loopResult.kind : undefined,
                    repeatedToken: loopDetected ? loopResult.repeatedToken : undefined,
                    retryable: loopDetected ? loopResult.retryable : undefined,
                    cleanText: loopDetected ? text : undefined
                };
            }
            throw err;
        }
    }

    function postStreamErrorDetail(error: any, formatDetail: (detail: string) => string): void {
        if (!error.response?.data?.on) {
            return;
        }

        let buf = '';
        error.response.data.on('data', (chunk: any) => buf += chunk.toString());
        error.response.data.on('end', () => {
            try {
                const parsed = JSON.parse(buf);
                const detail = parsed.error?.message || parsed.error || '';
                if (detail) {
                    deps.postWebviewMessage({ type: 'error', value: formatDetail(detail) });
                }
            } catch {
                // ignore parsing errors
            }
        });
    }

    return {
        streamMessages,
        postStreamErrorDetail
    };
}
