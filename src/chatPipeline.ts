import axios from 'axios';
import { containsActionTags } from './actionTagGuard';
import { sanitizeAssistantOutput } from './assistantOutputSanitizer';
import { getConfig } from './config';
import { findInstalledModelInfo, buildModelProfile } from './performanceProfiles';
import { PerfLogger } from './perfLogger';
import { getEngineDisplayName, resolveAIEndpoint } from './aiClient';
import { buildContinuationSystemMessage } from './chatPipelineHelpers';
import { getInstalledModelCatalog } from './modelDiscovery';
import { logInfo, logStreamEvent } from './logger';
import type { AIEndpoint, AttachedFile, ChatMessage, DisplayMessage, ModelProfile } from './types';
import { shouldUseDesignPlanningMode } from './designPlanningMode';
import type { RequestExecutionPhase } from './designPlanningMode';
import type { ExecutionMode } from './executionMode';
import type { RapidMlxTextSamplingSettings } from './samplingProfiles';
import { prepareAttachments, compactFilesForReuse, attachImagesToRequest } from './pipeline-attachments';
import { modelSupportsVision } from './pipeline-vision';
import { createStreamManager, type StreamManager } from './pipeline-stream';
import {
    isAbortError,
    formatPromptWithFileError,
    formatPromptError,
    cleanHtmlText,
    extractChunkHint
} from './pipeline-utils';

export interface ChatPipelineHost {
    buildRequestMessages(options?: {
        internetEnabled?: boolean;
        backgroundLabel?: string;
        modelProfile?: ModelProfile;
        activeModelName?: string;
        activeEngineName?: string;
        attachmentNames?: string[];
        attachmentChars?: number;
        prunedAttachmentChars?: number;
        executionPhase?: RequestExecutionPhase;
        executionMode?: ExecutionMode;
    }): ChatMessage[];
    executeActions(aiMessage: string): Promise<string[]>;
    readWorkspaceFile(filepath: string): string;
    getChatHistory(): ChatMessage[];
    getDisplayMessages(): DisplayMessage[];
    getExecutionMode?(): ExecutionMode;
    getRapidMlxTextSampling(): RapidMlxTextSamplingSettings;
    getTemperature(): number;
    getTopK(): number;
    getTopP(): number;
    postWebviewMessage(message: unknown): void;
    readBrainFile(filename: string): string;
    saveHistory(): Promise<void>;
    setAbortController(controller?: AbortController): void;
    setLastPrompt(prompt: string, modelName: string, files?: AttachedFile[], internetEnabled?: boolean): void;
    warnLargeModelTimeout(profile: ModelProfile, timeoutMs: number): void;
}

export interface PromptExecutionResult {
    repeated: boolean;
    stopReason?: string;
    repeatedKind?: string;
    repeatedToken?: string;
    retryable?: boolean;
}

interface PromptRunOptions {
    prompt: string;
    modelName: string;
    files?: AttachedFile[];
    internetEnabled?: boolean;
}

const DEFAULT_BACKGROUND_LABEL = 'BACKGROUND CONTEXT - DO NOT EXPLAIN THIS TO THE USER UNLESS ASKED';
export class ChatPipeline {
    private readonly _streamManager: StreamManager;

    constructor(private readonly host: ChatPipelineHost) {
        this._streamManager = createStreamManager({
            postWebviewMessage: (msg) => this.host.postWebviewMessage(msg),
            getTemperature: () => this.host.getTemperature(),
            getTopK: () => this.host.getTopK(),
            getTopP: () => this.host.getTopP(),
            getRapidMlxTextSampling: () => this.host.getRapidMlxTextSampling()
        });
    }

    public async handlePromptWithFile(
        prompt: string,
        modelName: string,
        files: AttachedFile[],
        internetEnabled?: boolean
    ): Promise<PromptExecutionResult> {
        return await this.runPrompt({ prompt, modelName, files, internetEnabled });
    }

    public async handlePrompt(prompt: string, modelName: string, internetEnabled?: boolean): Promise<PromptExecutionResult> {
        return await this.runPrompt({ prompt, modelName, internetEnabled });
    }

    private async runPrompt(options: PromptRunOptions): Promise<PromptExecutionResult> {
        const files = options.files ?? [];
        const hasFiles = files.length > 0;
        let abortController: AbortController | undefined;
        let repeatedStopReason: string | undefined;
        let repeatedKind: string | undefined;
        let repeatedToken: string | undefined;
        let retryable: boolean | undefined;
        const runStart = performance.now();

        try {
            const config = getConfig();
            const endpointStart = performance.now();
            const endpoint = await resolveAIEndpoint(config);
            const endpointMs = performance.now() - endpointStart;
            const selectedModel = this.selectedModel(options.modelName, config.defaultModel);
            const catalogStart = performance.now();
            const modelCatalog = await getInstalledModelCatalog(config.ollamaBase).catch(() => []);
            const catalogMs = performance.now() - catalogStart;
            const installedModel = findInstalledModelInfo(selectedModel, modelCatalog);
            const modelProfile = buildModelProfile({
                modelName: selectedModel,
                requestedPreset: config.performancePreset,
                parameterSize: installedModel?.parameterSize,
                family: installedModel?.family
            });
            const attachmentStart = performance.now();
            const attachments = prepareAttachments(files, modelProfile);
            const attachmentPrepMs = performance.now() - attachmentStart;
            const reusableFiles = compactFilesForReuse(files);
            const planningOnlyInitialTurn = shouldUseDesignPlanningMode(
                options.prompt,
                files.map(file => file.name)
            );
            this.host.warnLargeModelTimeout(modelProfile, config.timeout);
            PerfLogger.update({
                modelName: selectedModel,
                performancePreset: modelProfile.resolvedPreset,
                attachmentChars: attachments.includedChars,
                prunedAttachmentChars: attachments.prunedChars
            });

            this.host.getChatHistory().push({ role: 'user', content: options.prompt + attachments.fileContext });
            const displayMessage: DisplayMessage = { text: options.prompt, role: 'user' };
            if (hasFiles) {
                displayMessage.files = (reusableFiles || files).map(file => ({
                    name: file.name,
                    type: file.type,
                    data: file.data,
                    sourceUri: file.sourceUri,
                    truncated: file.truncated,
                    originalSize: file.originalSize
                }));
            }
            this.host.getDisplayMessages().push({ ...displayMessage, feedback: null });

            const requestBuildStart = performance.now();
            const reqMessages = this.host.buildRequestMessages({
                internetEnabled: options.internetEnabled,
                backgroundLabel: DEFAULT_BACKGROUND_LABEL,
                modelProfile,
                activeModelName: selectedModel,
                activeEngineName: getEngineDisplayName(config.ollamaBase),
                attachmentNames: attachments.textAttachmentNames,
                attachmentChars: attachments.includedChars,
                prunedAttachmentChars: attachments.prunedChars,
                executionPhase: 'initial',
                executionMode: this.host.getExecutionMode?.()
            });
            const requestBuildMs = performance.now() - requestBuildStart;

            const promptChars = reqMessages.reduce((sum, msg) => sum + (typeof msg.content === 'string' ? msg.content.length : JSON.stringify(msg.content).length), 0);
            PerfLogger.update({ promptSizeEstimateChars: promptChars, finalRequestChars: promptChars });
            PerfLogger.log(`[PREP] model=${selectedModel} endpoint=${endpointMs.toFixed(1)}ms catalog=${catalogMs.toFixed(1)}ms attachments=${attachmentPrepMs.toFixed(1)}ms request=${requestBuildMs.toFixed(1)}ms total_pre_stream=${(performance.now() - runStart).toFixed(1)}ms`);

            // B-3: Ollama API에서 vision capability를 확인하여 이미지 전달 여부 결정
            const visionCheck = await modelSupportsVision(selectedModel, endpoint, installedModel);
            const visionSupported = visionCheck.supportsVision;
            logInfo(`[PIPELINE] Vision check for '${selectedModel}': ${visionSupported ? 'supported' : 'not supported'} (${visionCheck.reason})`);
            const imagesToSend = attachments.imageFiles;
            if (!visionSupported && attachments.imageFiles.length > 0) {
                logInfo(`[PIPELINE] Sending ${attachments.imageFiles.length} image(s) anyway: vision support for '${selectedModel}' was not confirmed (${visionCheck.reason}).`);
            }

            // MLLM safe limit: rapid-mlx의 MLLM 스케줄러는 --mllm 플래그 사용 시
            // 이미지 유무와 관계없이 prefill_step_size(기본 2048 토큰) 한도가 항상 적용됨.
            // chars÷2 로 토큰을 추정하여 한도 내에 들어오도록 동적으로 히스토리를 트리밍한다.
            // 이미지가 있으면 이미지 토큰(~300)만큼 예산을 추가 감산한다.
            const MLLM_CHARS_PER_TOKEN = 2;   // 보수적 추정: 한국어 ~2.7 chars/token, 혼합 기준 2로 설정
            const MLLM_TOKEN_HARD_CAP = imagesToSend.length > 0 ? 1500 : 1800; // 이미지 있으면 토큰 예산 감산
            if (endpoint.engineKind === 'rapid-mlx') {
                const estimateTokens = (msg: ChatMessage): number => {
                    const text = typeof msg.content === 'string'
                        ? msg.content
                        : JSON.stringify(msg.content);
                    return Math.ceil(text.length / MLLM_CHARS_PER_TOKEN);
                };

                const systemMessages = reqMessages.filter(m => m.role === 'system');
                const nonSystemMessages = reqMessages.filter(m => m.role !== 'system');

                // 시스템 메시지 토큰 합산
                let systemTokens = systemMessages.reduce((s, m) => s + estimateTokens(m), 0);

                // 시스템 메시지 자체가 너무 크면 마지막 부분만 남김
                if (systemTokens > MLLM_TOKEN_HARD_CAP - 200) {
                    const maxSysChars = (MLLM_TOKEN_HARD_CAP - 200) * MLLM_CHARS_PER_TOKEN;
                    for (const sm of systemMessages) {
                        if (typeof sm.content === 'string' && sm.content.length > maxSysChars) {
                            sm.content = sm.content.slice(-maxSysChars);
                        }
                    }
                    systemTokens = systemMessages.reduce((s, m) => s + estimateTokens(m), 0);
                    logInfo(`[PIPELINE] MLLM system message truncated to fit token cap (est. ${systemTokens} tokens)`);
                }

                // 비시스템 메시지를 최신 것부터 역순으로 추가.
                // 최신 메시지(첨부파일 포함 가능)는 항상 포함되며, 예산 초과 시 잘라서라도 유지.
                const budgetLeft = MLLM_TOKEN_HARD_CAP - systemTokens;
                const keptMessages: ChatMessage[] = [];
                let usedTokens = 0;
                const lastIdx = nonSystemMessages.length - 1;
                for (let i = lastIdx; i >= 0; i--) {
                    const msg = nonSystemMessages[i];
                    const t = estimateTokens(msg);
                    if (usedTokens + t <= budgetLeft) {
                        keptMessages.unshift(msg);
                        usedTokens += t;
                    } else if (i === lastIdx && typeof msg.content === 'string') {
                        // 최신 메시지가 예산 초과: 잘라서라도 포함 (첨부파일 내용 보존)
                        const maxChars = Math.max(400, (budgetLeft - usedTokens) * MLLM_CHARS_PER_TOKEN);
                        const truncated = msg.content.slice(0, maxChars);
                        keptMessages.unshift({ ...msg, content: truncated });
                        usedTokens += estimateTokens({ ...msg, content: truncated });
                        break;
                    } else {
                        break;
                    }
                }

                const before = reqMessages.length;
                reqMessages.splice(0, reqMessages.length, ...systemMessages, ...keptMessages);
                logInfo(`[PIPELINE] MLLM token-aware trim: ${before} → ${reqMessages.length} msgs, est. ${systemTokens + usedTokens}/${MLLM_TOKEN_HARD_CAP} tokens (rapid-mlx vision safe limit)`);
            }

            attachImagesToRequest(endpoint, reqMessages, imagesToSend);
            if (imagesToSend.length > 0) {
                const totalImageChars = imagesToSend.reduce((sum, image) => sum + String(image.data || '').length, 0);
                logInfo(`[PIPELINE] Attached ${imagesToSend.length} image(s) to request for ${endpoint.engineKind || 'unknown'} (${totalImageChars} base64 chars).`);
            }

            this.host.postWebviewMessage({ type: 'streamStart' });

            for (const notice of attachments.notices) {
                this.host.postWebviewMessage({ type: 'streamChunk', value: notice });
            }

            this.host.setLastPrompt(options.prompt, options.modelName, compactFilesForReuse(files), options.internetEnabled);
            abortController = new AbortController();
            this.host.setAbortController(abortController);

            let fullAiMessage = '';
            let currentAiResponse = await this._streamManager.streamMessages(
                endpoint,
                reqMessages,
                selectedModel,
                config.timeout,
                abortController.signal,
                modelProfile,
                'initial'
            );
            if (currentAiResponse.repeated) {
                repeatedStopReason = currentAiResponse.stopReason;
                repeatedKind = currentAiResponse.repeatedKind;
                repeatedToken = currentAiResponse.repeatedToken;
                retryable = currentAiResponse.retryable;
                this.host.postWebviewMessage({ type: 'streamAbort', stopReason: 'repetition_detected' });
                // B-1: 반복 꼬리는 제거하고 깨끗한 부분 응답만 보존한다.
                logInfo('[PIPELINE] Initial response repeated — preserving clean partial response without repeated tail.');
                const cleanText = (currentAiResponse.cleanText || currentAiResponse.text || '').trim();
                if (cleanText) {
                    this.host.getChatHistory().push({
                        role: 'assistant',
                        content: cleanText
                    });
                    logInfo('[PIPELINE] Preserved clean partial response after repetition stop.');
                }
                const emptyFinalDisplay: DisplayMessage = { text: cleanText, role: 'ai', feedback: null };
                this.host.getDisplayMessages().push(emptyFinalDisplay);
                this.saveHistoryInBackground('initial_repeated');
                this.host.postWebviewMessage({
                    type: 'streamEnd',
                    stopReason: 'repetition_detected',
                    message: emptyFinalDisplay,
                    messageIndex: this.host.getDisplayMessages().length - 1
                });
                return {
                    repeated: true,
                    stopReason: repeatedStopReason,
                    repeatedKind: currentAiResponse.repeatedKind,
                    repeatedToken: currentAiResponse.repeatedToken,
                    retryable: currentAiResponse.retryable
                };
            }
            if (planningOnlyInitialTurn) {
                if (containsActionTags(currentAiResponse.text)) {
                    logInfo('[PIPELINE] Initial planning-only response contained action tags. Blocking execution.');
                    this.host.postWebviewMessage({
                        type: 'streamChunk',
                        value: '\n\n> ⚠️ 첫 계획 응답에서 액션 태그가 감지되어 실행을 차단했습니다. 계획만 남기고 구현은 다음 단계로 넘깁니다.\n\n'
                    });
                }
                fullAiMessage = currentAiResponse.text;
            }

            let turn = 0;
            const maxTurns = 10;

            while (turn < maxTurns && !currentAiResponse.repeated && !planningOnlyInitialTurn) {
                let turnExecuted = false;
                let combinedSystemFeedback = '';
                let combinedUiFeedback = '';
                let cleanedAiResponse = currentAiResponse.text;

                // 1. Resolve internal read requests (vault, url)
                const internalResult = await this.resolveInternalActions(currentAiResponse.text, endpoint, selectedModel, config.timeout, abortController.signal);
                if (internalResult.executed) {
                    turnExecuted = true;
                    cleanedAiResponse = internalResult.cleanedResponse;
                    combinedSystemFeedback += internalResult.systemFeedback + '\n';
                    combinedUiFeedback += internalResult.uiFeedback;
                }

                // 2. Resolve external actions (file, terminal)
                const externalReport = await this.host.executeActions(currentAiResponse.text);
                if (externalReport.length > 0) {
                    turnExecuted = true;
                    this.postActionReport(externalReport);
                    combinedUiFeedback += this.formatActionReport(externalReport);
                    
                    const visibleReport = externalReport.filter(r => !r.startsWith('@@LLEM_FILE_CHANGES '));
                    const successItems = visibleReport.filter(r => !r.includes('❌') && !r.includes('⚠️') && !r.includes('🛑'));
                    const issueItems = visibleReport.filter(r => r.includes('❌') || r.includes('⚠️') || r.includes('🛑'));

                    let friendlySummary = `[SYSTEM: Action Summary]\n`;
                    
                    if (successItems.length > 0) {
                        friendlySummary += `Completed:\n`;
                        friendlySummary += `- ${successItems.join('\n- ')}\n`;
                    }
                    
                    if (issueItems.length > 0) {
                        friendlySummary += `Issues & Safety Blocks:\n`;
                        for (const issue of issueItems) {
                            if (issue.includes('not found')) {
                                friendlySummary += `- **Mismatch**: The AI tried to edit a section that didn't match the file content. I've sent the current file to the AI for a retry.\n`;
                            } else if (issue.includes('replacement 0/')) {
                                friendlySummary += `- **Edit Failed**: The edit action was detected, but zero replacements were applied because the <find> text did not match the current file. Use the provided current file content to retry with exact text.\n`;
                            } else if (issue.includes('loop detected')) {
                                friendlySummary += `- **Safety Block**: Detected a repetitive edit loop. I've paused edits on this file to prevent infinite changes.\n`;
                            } else if (issue.includes('skipped') && issue.includes('repeated')) {
                                friendlySummary += `- **Redundancy Filter**: Blocked a repeated action that was already attempted.\n`;
                            } else if (issue.includes('Action Denied')) {
                                friendlySummary += `- **Permission Denied**: Access to a file outside the workspace was requested but not approved by the user.\n`;
                            } else if (issue.includes('blocked') && issue.includes('security restriction')) {
                                friendlySummary += `- **Security Block**: Access to this path is strictly prohibited for safety (e.g., system configuration files).\n`;
                            } else {
                                friendlySummary += `- ${issue}\n`;
                            }
                        }
                    }

                    combinedSystemFeedback += friendlySummary;
                }

                if (turnExecuted) {
                    const previousAiResponsePrefix = currentAiResponse.text.trim().slice(0, 200);

                    // Update full AI message with what we've processed so far
                    fullAiMessage += cleanedAiResponse + combinedUiFeedback;

                    // B-2: 마지막 메시지가 이미 assistant이면 중복 push 방지
                    const chatHistory = this.host.getChatHistory();
                    if (chatHistory.length === 0 || chatHistory[chatHistory.length - 1].role !== 'assistant') {
                        chatHistory.push({ role: 'assistant', content: currentAiResponse.text });
                    } else {
                        logInfo('[PIPELINE] Skipped duplicate assistant push — last message already has role=assistant.');
                    }
                    const continuationMessage = buildContinuationSystemMessage(combinedSystemFeedback, externalReport);
                    if (continuationMessage) {
                        // B-2: 마지막 메시지가 이미 user이면 continuation 중복 방지
                        const lastRole = chatHistory[chatHistory.length - 1]?.role;
                        if (lastRole !== 'user') {
                            chatHistory.push({ role: 'user', content: continuationMessage });
                        } else {
                            // 이미 user 메시지가 있으면 내용을 append
                            chatHistory[chatHistory.length - 1].content += '\n\n' + continuationMessage;
                            logInfo('[PIPELINE] Merged continuation into existing user message to prevent duplicate.');
                        }
                    }

                    // Re-prompt
                    const nextReqMessages = this.host.buildRequestMessages({
                        internetEnabled: options.internetEnabled,
                        backgroundLabel: DEFAULT_BACKGROUND_LABEL,
                        modelProfile,
                        activeModelName: selectedModel,
                        activeEngineName: getEngineDisplayName(config.ollamaBase),
                        attachmentNames: attachments.textAttachmentNames,
                        attachmentChars: attachments.includedChars,
                        prunedAttachmentChars: attachments.prunedChars,
                        executionPhase: 'followup',
                        executionMode: this.host.getExecutionMode?.()
                    });
                    currentAiResponse = await this._streamManager.streamMessages(endpoint, nextReqMessages, selectedModel, config.timeout, abortController.signal, modelProfile, 'followup');
                    if (currentAiResponse.repeated) {
                        repeatedStopReason = currentAiResponse.stopReason;
                        repeatedKind = currentAiResponse.repeatedKind;
                        repeatedToken = currentAiResponse.repeatedToken;
                        retryable = currentAiResponse.retryable;
                        this.host.postWebviewMessage({ type: 'streamAbort', stopReason: 'repetition_detected' });
                        fullAiMessage += (currentAiResponse.cleanText || currentAiResponse.text);
                        // B-1: followup 반복 감지 시 마지막 오염 assistant 메시지 제거
                        const hist = this.host.getChatHistory();
                        if (hist.length > 0 && hist[hist.length - 1].role === 'assistant') {
                            hist.pop();
                            logInfo('[PIPELINE] Removed repeated assistant message from history (followup turn).');
                        }
                        break;
                    }
                    
                    // Loop detection: if Turn N starts exactly like Turn N-1, it's stuck.
                    const responseStart = currentAiResponse.text.trim().slice(0, 500);
                    const prevStart = previousAiResponsePrefix.slice(0, 500);

                    // 액션 태그가 많으면 유사도 기준 완화
                    const hasActionTags = (responseStart.match(/<\/?(?:edit_file|create_file)/gi) || []).length > 2;
                    const isSimilar = hasActionTags 
                        ? responseStart.slice(0, 200) === prevStart.slice(0, 200)
                        : responseStart === prevStart;

                    if (isSimilar && currentAiResponse.text.length > 50) {
                        logInfo('[PIPELINE] Turn-to-turn loop detected. Breaking execution chain.');
                        repeatedStopReason = 'turn_to_turn_loop';
                        repeatedKind = 'turn-to-turn-loop';
                        retryable = false;
                        this.host.postWebviewMessage({ type: 'streamAbort', stopReason: 'repetition_detected' });
                        fullAiMessage += currentAiResponse.text;
                        break;
                    }

                    turn++;
                    continue;
                }

                // No more actions
                fullAiMessage += currentAiResponse.text;
                break;
            }

            if (!fullAiMessage && currentAiResponse.text) {
                fullAiMessage = currentAiResponse.text;
            }

            const finalAssistantText = this.stripActionTags(fullAiMessage);
            logStreamEvent(`${Date.now().toString(36)}-finalize`, 'finalize_message', {
                fullAiMessageLength: fullAiMessage.length,
                finalAssistantTextLength: finalAssistantText.length,
                finalAssistantPreview: finalAssistantText.slice(0, 1000),
                fullAiPreview: fullAiMessage.slice(0, 1000)
            });
            this.host.getChatHistory().push({
                role: 'assistant',
                content: finalAssistantText || fullAiMessage
            });

            const finalDisplayMessage: DisplayMessage = { text: finalAssistantText, role: 'ai', feedback: null };
            this.host.getDisplayMessages().push(finalDisplayMessage);
            this.trimHistory();
            this.saveHistoryInBackground('finalize');
            this.host.postWebviewMessage({
                type: 'streamEnd',
                message: finalDisplayMessage,
                messageIndex: this.host.getDisplayMessages().length - 1
            });
            return {
                repeated: Boolean(repeatedStopReason),
                stopReason: repeatedStopReason,
                repeatedKind,
                repeatedToken,
                retryable
            };
        } catch (error: any) {
            if (isAbortError(error)) {
                this.host.postWebviewMessage({ type: 'streamAbort' });
                return {
                    repeated: false,
                    stopReason: 'manual_abort'
                };
            }

            const { ollamaBase } = getConfig();
            this.host.postWebviewMessage({
                type: 'error',
                value: hasFiles ? formatPromptWithFileError(error, ollamaBase) : formatPromptError(error, ollamaBase)
            });
            if (hasFiles) {
                this._streamManager.postStreamErrorDetail(error, detail => `⚠️ API detail: ${detail}`);
            } else {
                this._streamManager.postStreamErrorDetail(error, detail => {
                    const refined = detail.includes('greater than the context length')
                        ? 'Your project context is bigger than the model can hold.\nTip: in LM Studio, raise the Context Length slider to 8192 and reload the model.'
                        : detail;
                    return `Tip: ${refined}`;
                });
            }
            return {
                repeated: false
            };
        } finally {
            if (abortController) {
                this.host.setAbortController(undefined);
            }
        }
    }

    private async resolveInternalActions(
        aiMessage: string,
        endpoint: AIEndpoint,
        selectedModel: string,
        timeout: number,
        signal?: AbortSignal
    ): Promise<{ cleanedResponse: string; uiFeedback: string; systemFeedback: string; executed: boolean }> {
        const brainReads = [...aiMessage.matchAll(/<read_(?:brain|vault)>([\s\S]*?)<\/read_(?:brain|vault)>/g)];
        const urlReads = [...aiMessage.matchAll(/<read_url>([\s\S]*?)<\/read_url>/gi)];
        const fileReads = [...aiMessage.matchAll(/<read_file>([\s\S]*?)<\/read_file>/gi)];

        if (brainReads.length === 0 && urlReads.length === 0 && fileReads.length === 0) {
            return { cleanedResponse: aiMessage, uiFeedback: '', systemFeedback: '', executed: false };
        }

        let fetchedContent = '';
        let uiFeedbackStr = '';

        for (const match of brainReads) {
            const requestedFile = match[1].trim();
            const fileContent = this.host.readBrainFile(requestedFile);
            fetchedContent += `\n\n[BRAIN DOCUMENT: ${requestedFile}]\n${fileContent}\n`;
        }

        for (const match of fileReads) {
            const requestedPath = match[1].trim();
            const fileContent = this.host.readWorkspaceFile(requestedPath);
            fetchedContent += `\n\n[WORKSPACE FILE: ${requestedPath}]\n${fileContent}\n`;
        }

        for (const match of urlReads) {
            const url = match[1].trim();
            try {
                const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
                const cleaned = cleanHtmlText(data.toString());
                fetchedContent += `\n\n[WEB CONTENT: ${url}]\n${cleaned.slice(0, 15000)}\n`;
                const msg = `\n\n> 🌐 **[Web fetch complete]** ${url} (${cleaned.length} chars)\n\n`;
                uiFeedbackStr += msg;
                this.host.postWebviewMessage({ type: 'streamChunk', value: msg });
            } catch (err: any) {
                fetchedContent += `\n\n[WEB CONTENT: ${url}] (FAILED: ${err.message})\n`;
                const msg = `\n\n> 🌐 **[Web fetch failed]** ${url} - ${err.message}\n\n`;
                uiFeedbackStr += msg;
                this.host.postWebviewMessage({ type: 'streamChunk', value: msg });
            }
        }

        const cleanedResponse = aiMessage.replace(/<read_(?:brain|vault)>[\s\S]*?<\/read_(?:brain|vault)>/g, '')
            .replace(/<read_url>[\s\S]*?<\/read_url>/gi, '')
            .replace(/<read_file>[\s\S]*?<\/read_file>/gi, '')
            .trim();

        if (brainReads.length > 0) {
            const msg = `\n\n> 📚 **[Vault lookup complete]** Pulling the answer together from the notes we just opened.\n\n`;
            uiFeedbackStr += msg;
            this.host.postWebviewMessage({ type: 'streamChunk', value: msg });
        }

        if (fileReads.length > 0) {
            const msg = `\n\n> 📄 **[File read complete]** Reading workspace file(s) to answer your question.\n\n`;
            uiFeedbackStr += msg;
            this.host.postWebviewMessage({ type: 'streamChunk', value: msg });
        }

        const hasMoreChunks = fetchedContent.includes('MORE CHUNKS AVAILABLE');
        const systemFeedback = hasMoreChunks
            ? `[SYSTEM: The following content was retrieved based on your actions.]\n${fetchedContent}\n\nThe file above has more chunks available. You can continue reading additional chunks with <read_file>filename:N</read_file> (e.g., <read_file>${extractChunkHint(fetchedContent)}</read_file>) if needed. Do NOT output <read_vault>, <read_brain>, or <read_url> again. Answer directly using what you have read so far, and request more chunks only if necessary.`
            : `[SYSTEM: The following vault notes, web contents, and workspace files were retrieved based on your actions. Use them to answer the user's original question accurately.]\n${fetchedContent}\n\nNow answer the user's question using the knowledge above. Do NOT output <read_vault>, <read_brain>, <read_url>, or <read_file> again. Answer directly.`;

        return {
            cleanedResponse,
            uiFeedback: uiFeedbackStr,
            systemFeedback,
            executed: true
        };
    }

    private postActionReport(report: string[]): void {
        this.host.postWebviewMessage({ type: 'streamChunk', value: this.formatActionReport(report) });
    }

    private formatActionReport(report: string[]): string {
        return `\n\n---\n**Action Report**\n${report.join('\n')}`;
    }

    private selectedModel(modelName: string, defaultModel: string): string {
        return modelName || defaultModel;
    }

    private saveHistoryInBackground(reason: string): void {
        const saveStart = performance.now();
        void this.host.saveHistory()
            .then(() => {
                const elapsed = performance.now() - saveStart;
                PerfLogger.log(`[SAVE] reason=${reason} completed in ${elapsed.toFixed(1)}ms`);
            })
            .catch((error: any) => {
                const elapsed = performance.now() - saveStart;
                logInfo(`[SAVE] reason=${reason} failed after ${elapsed.toFixed(1)}ms: ${error instanceof Error ? error.message : String(error)}`);
            });
    }

    private trimHistory(maxHistory = 50): void {
        const chatHistory = this.host.getChatHistory();
        const displayMessages = this.host.getDisplayMessages();

        if (chatHistory.length > maxHistory + 1) {
            chatHistory.splice(0, chatHistory.length, chatHistory[0], ...chatHistory.slice(-maxHistory));
        }
        if (displayMessages.length > maxHistory) {
            displayMessages.splice(0, displayMessages.length, ...displayMessages.slice(-maxHistory));
        }
    }

    private stripActionTags(text: string): string {
        return sanitizeAssistantOutput(text);
    }
}
