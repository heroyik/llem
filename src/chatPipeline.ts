import axios from 'axios';
import { containsActionTags } from './actionTagGuard';
import { sanitizeAssistantOutput } from './assistantOutputSanitizer';
import { getConfig } from './config';
import { findInstalledModelInfo, buildModelProfile } from './performanceProfiles';
import { PerfLogger } from './perfLogger';
import { getEngineDisplayName, resolveAIEndpoint, streamCompletion } from './aiClient';
import { buildContinuationSystemMessage } from './chatPipelineHelpers';
import { attachImagesToChatMessages } from './imageRequestPayload';
import { getInstalledModelCatalog, getModelCapabilities } from './modelDiscovery';
import { allocateAttachmentPreview, getAttachmentBudgetLimits } from './promptBudgeting';
import { logInfo, logStreamEvent } from './logger';
import { RepetitionWatchdog } from './repetitionWatchdog';
import type { AIEndpoint, AttachedFile, ChatMessage, DisplayMessage, ModelProfile } from './types';
import { shouldUseDesignPlanningMode } from './designPlanningMode';
import { isLoopStopReason, type StreamOutcome } from './streamOutcome';
import type { RequestExecutionPhase } from './designPlanningMode';
import type { ExecutionMode } from './executionMode';

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
    getChatHistory(): ChatMessage[];
    getDisplayMessages(): DisplayMessage[];
    getExecutionMode?(): ExecutionMode;
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
}

interface PromptRunOptions {
    prompt: string;
    modelName: string;
    files?: AttachedFile[];
    internetEnabled?: boolean;
}

interface PreparedAttachments {
    fileContext: string;
    imageFiles: AttachedFile[];
    displayFiles: Pick<AttachedFile, 'name' | 'type' | 'data'>[];
    notices: string[];
    textAttachmentNames: string[];
    includedChars: number;
    prunedChars: number;
}

function normalizeImageData(data: unknown): string {
    const raw = String(data || '').trim();
    const dataUrlMatch = raw.match(/^data:[^;]+;base64,(.*)$/i);
    return dataUrlMatch ? dataUrlMatch[1].trim() : raw;
}

const DEFAULT_BACKGROUND_LABEL = 'BACKGROUND CONTEXT - DO NOT EXPLAIN THIS TO THE USER UNLESS ASKED';
const MAX_TEXT_ATTACHMENT_CHARS = 20000;
const MAX_TEXT_ATTACHMENT_DECODE_BYTES = 96 * 1024;
const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export class ChatPipeline {
    constructor(private readonly host: ChatPipelineHost) {}

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
            const attachments = this.prepareAttachments(files, modelProfile);
            const attachmentPrepMs = performance.now() - attachmentStart;
            const reusableFiles = this.compactFilesForReuse(files);
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
            const visionCheck = await this.modelSupportsVision(selectedModel, endpoint, installedModel);
            const modelSupportsVision = visionCheck.supportsVision;
            logInfo(`[PIPELINE] Vision check for '${selectedModel}': ${modelSupportsVision ? 'supported' : 'not supported'} (${visionCheck.reason})`);
            const imagesToSend = attachments.imageFiles;
            if (!modelSupportsVision && attachments.imageFiles.length > 0) {
                logInfo(`[PIPELINE] Sending ${attachments.imageFiles.length} image(s) anyway: vision support for '${selectedModel}' was not confirmed (${visionCheck.reason}).`);
            }

            // MLLM safe limit: rapid-mlx의 MLLM 스케줄러는 prefill_step_size(기본 2048 토큰) 한도가 있음.
            // 이미지 토큰(~256~1024)을 포함하면 텍스트 컨텍스트 예산이 크게 줄어드므로
            // chars÷4 로 토큰을 추정하여 한도 내에 들어오도록 동적으로 히스토리를 트리밍한다.
            const MLLM_TOKEN_HARD_CAP = 1500; // 2048 - 이미지(~300) - 안전 여유(~250)
            const MLLM_CHARS_PER_TOKEN = 2;   // 보수적 추정: 한국어 ~2.7 chars/token, 혼합 기준 2로 설정
            if (imagesToSend.length > 0 && endpoint.engineKind === 'rapid-mlx') {
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

                // 비시스템 메시지를 최신 것부터 역순으로 추가하되 예산 초과 시 중단
                const budgetLeft = MLLM_TOKEN_HARD_CAP - systemTokens;
                const keptMessages: ChatMessage[] = [];
                let usedTokens = 0;
                for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
                    const t = estimateTokens(nonSystemMessages[i]);
                    if (usedTokens + t > budgetLeft) { break; }
                    keptMessages.unshift(nonSystemMessages[i]);
                    usedTokens += t;
                }

                const before = reqMessages.length;
                reqMessages.splice(0, reqMessages.length, ...systemMessages, ...keptMessages);
                logInfo(`[PIPELINE] MLLM token-aware trim: ${before} → ${reqMessages.length} msgs, est. ${systemTokens + usedTokens}/${MLLM_TOKEN_HARD_CAP} tokens (rapid-mlx vision safe limit)`);
            }

            this.attachImagesToRequest(endpoint, reqMessages, imagesToSend);
            if (imagesToSend.length > 0) {
                const totalImageChars = imagesToSend.reduce((sum, image) => sum + String(image.data || '').length, 0);
                logInfo(`[PIPELINE] Attached ${imagesToSend.length} image(s) to request for ${endpoint.engineKind || 'unknown'} (${totalImageChars} base64 chars).`);
            }


            this.host.postWebviewMessage({ type: 'streamStart' });

            for (const notice of attachments.notices) {
                this.host.postWebviewMessage({ type: 'streamChunk', value: notice });
            }

            this.host.setLastPrompt(options.prompt, options.modelName, this.compactFilesForReuse(files), options.internetEnabled);
            abortController = new AbortController();
            this.host.setAbortController(abortController);

            let fullAiMessage = '';
            let currentAiResponse = await this.streamMessages(
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
                this.postSingleLoopStopNotice(currentAiResponse.stopReason);
                // B-1: 반복 감지된 응답은 히스토리에 추가하지 않고 즉시 종료
                // (이미 L119에서 user 메시지만 push된 상태이므로 오염 없이 반환)
                logInfo('[PIPELINE] Initial response repeated — skipping history push to prevent context contamination.');
                const emptyFinalDisplay: DisplayMessage = { text: currentAiResponse.text, role: 'ai', feedback: null };
                this.host.getDisplayMessages().push(emptyFinalDisplay);
                this.saveHistoryInBackground('initial_repeated');
                this.host.postWebviewMessage({
                    type: 'streamEnd',
                    message: emptyFinalDisplay,
                    messageIndex: this.host.getDisplayMessages().length - 1
                });
                return { repeated: true, stopReason: repeatedStopReason };
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
                    currentAiResponse = await this.streamMessages(endpoint, nextReqMessages, selectedModel, config.timeout, abortController.signal, modelProfile, 'followup');
                    if (currentAiResponse.repeated) {
                        repeatedStopReason = currentAiResponse.stopReason;
                        this.postSingleLoopStopNotice(currentAiResponse.stopReason);
                        fullAiMessage += currentAiResponse.text;
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
                        this.postSingleLoopStopNotice('repetition_detected');
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
                stopReason: repeatedStopReason
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
                this.postStreamErrorDetail(error, detail => `⚠️ API detail: ${detail}`);
            } else {
                this.postStreamErrorDetail(error, detail => {
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

    private prepareAttachments(files: AttachedFile[], modelProfile: ModelProfile): PreparedAttachments {
        const prepared: PreparedAttachments = {
            fileContext: '',
            imageFiles: [],
            displayFiles: [],
            notices: [],
            textAttachmentNames: [],
            includedChars: 0,
            prunedChars: 0
        };
        const attachmentBudget = getAttachmentBudgetLimits(modelProfile.contextBudget);
        let remainingAttachmentChars = attachmentBudget.totalChars;

        for (const file of files) {
            const type = file.type || 'application/octet-stream';
            const size = file.originalSize ?? estimateBase64Bytes(file.data);

            if (type.startsWith('image/')) {
                const imageData = normalizeImageData(file.data);
                if (!imageData) {
                    prepared.displayFiles.push({ name: file.name, type, data: '' });
                    prepared.notices.push(`\n\n> 📎 **[Image skipped]** ${file.name}: the pasted image data was empty before the model request.\n\n`);
                    logInfo(`[PIPELINE] Skipped image attachment '${file.name}' because data was empty.`);
                    continue;
                }
                if (size > MAX_IMAGE_ATTACHMENT_BYTES) {
                    prepared.displayFiles.push({ name: file.name, type, data: '' });
                    prepared.notices.push(`\n\n> 📎 **[Image skipped]** ${file.name}: ${formatBytes(size)} is too large for the model request. Max supported size is ${formatBytes(MAX_IMAGE_ATTACHMENT_BYTES)}.\n\n`);
                    logInfo(`[PIPELINE] Skipped image attachment '${file.name}' because ${formatBytes(size)} exceeds ${formatBytes(MAX_IMAGE_ATTACHMENT_BYTES)}.`);
                    continue;
                }

                prepared.imageFiles.push({ ...file, type, data: imageData });
                prepared.displayFiles.push({ name: file.name, type, data: imageData });
                continue;
            }

            const decoded = decodeBase64TextPrefix(file.data, MAX_TEXT_ATTACHMENT_DECODE_BYTES);
            const preview = decoded.slice(0, MAX_TEXT_ATTACHMENT_CHARS);
            const budgetedPreview = allocateAttachmentPreview(preview, remainingAttachmentChars, attachmentBudget.perFileChars);
            const wasTruncated = Boolean(file.truncated)
                || size > MAX_TEXT_ATTACHMENT_DECODE_BYTES
                || decoded.length > MAX_TEXT_ATTACHMENT_CHARS
                || budgetedPreview.prunedChars > 0;
            const note = wasTruncated
                ? ` (partial preview only: up to ${formatBytes(MAX_TEXT_ATTACHMENT_DECODE_BYTES)} of ${formatBytes(size)})`
                : '';

            if (budgetedPreview.included.length === 0) {
                prepared.displayFiles.push({ name: file.name, type, data: '' });
                prepared.notices.push(`\n\n> 📎 **[Attachment budget reached]** ${file.name}: skipped to keep the 26B prompt lean.\n\n`);
                prepared.prunedChars += preview.length;
                continue;
            }

            remainingAttachmentChars = budgetedPreview.remainingChars;
            prepared.textAttachmentNames.push(file.name);
            prepared.includedChars += budgetedPreview.included.length;
            prepared.prunedChars += budgetedPreview.prunedChars;
            prepared.fileContext += `\n\n[ATTACHED FILE: ${file.name}${note}]\n\`\`\`\n${budgetedPreview.included}\n\`\`\``;
            prepared.displayFiles.push({ name: file.name, type, data: '' });

            if (wasTruncated) {
                prepared.notices.push(`\n\n> 📎 **[Partial file preview]** ${file.name}: only the first ${formatBytes(MAX_TEXT_ATTACHMENT_DECODE_BYTES)} made it into model context. Full size: ${formatBytes(size)}.\n\n`);
            }
        }

        return prepared;
    }

    private compactFilesForReuse(files: AttachedFile[]): AttachedFile[] | undefined {
        if (files.length === 0) {
            return undefined;
        }

        const reusableFiles: AttachedFile[] = [];

        for (const file of files) {
            const type = file.type || 'application/octet-stream';
            const size = file.originalSize ?? estimateBase64Bytes(file.data);

            if (type.startsWith('image/')) {
                if (size <= MAX_IMAGE_ATTACHMENT_BYTES) {
                    reusableFiles.push({ ...file, type });
                }
                continue;
            }

            reusableFiles.push({
                ...file,
                type,
                data: size > MAX_TEXT_ATTACHMENT_DECODE_BYTES
                    ? sliceBase64Prefix(file.data, MAX_TEXT_ATTACHMENT_DECODE_BYTES)
                    : file.data,
                truncated: file.truncated || size > MAX_TEXT_ATTACHMENT_DECODE_BYTES,
                originalSize: size
            });
        }

        return reusableFiles.length > 0 ? reusableFiles : undefined;
    }

    private attachImagesToRequest(endpoint: AIEndpoint, reqMessages: ChatMessage[], imageFiles: AttachedFile[]): void {
        attachImagesToChatMessages(endpoint, reqMessages, imageFiles);
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

        if (brainReads.length === 0 && urlReads.length === 0) {
            return { cleanedResponse: aiMessage, uiFeedback: '', systemFeedback: '', executed: false };
        }

        let fetchedContent = '';
        let uiFeedbackStr = '';

        for (const match of brainReads) {
            const requestedFile = match[1].trim();
            const fileContent = this.host.readBrainFile(requestedFile);
            fetchedContent += `\n\n[BRAIN DOCUMENT: ${requestedFile}]\n${fileContent}\n`;
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
            .trim();

        if (brainReads.length > 0) {
            const msg = `\n\n> 📚 **[Vault lookup complete]** Pulling the answer together from the notes we just opened.\n\n`;
            uiFeedbackStr += msg;
            this.host.postWebviewMessage({ type: 'streamChunk', value: msg });
        }

        return {
            cleanedResponse,
            uiFeedback: uiFeedbackStr,
            systemFeedback: `[SYSTEM: The following vault notes and web contents were retrieved based on your actions. Use them to answer the user's original question accurately.]\n${fetchedContent}\n\nNow answer the user's question using the knowledge above. Do NOT output <read_vault>, <read_brain>, or <read_url> again. Answer directly.`,
            executed: true
        };
    }

    private async streamMessages(
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

        // Repetition Watchdog
        const watchdog = new RepetitionWatchdog();
        let loopDetected = false;
        let streamedText = '';

        const abortController = new AbortController();
        const combinedSignal = signal 
            ? this.createCombinedSignal(signal, abortController.signal)
            : abortController.signal;

        let buffer = '';
        const flushBuffer = () => {
            if (buffer) {
                this.host.postWebviewMessage({
                    type: 'streamChunk',
                    value: buffer,
                    preview: this.buildLivePreview(streamedText)
                });
                buffer = '';
            }
        };

        const flushInterval = setInterval(flushBuffer, 50);

        try {
            const result = await streamCompletion({
                endpoint,
                messages,
                modelName,
                timeout,
                temperature: this.host.getTemperature(),
                topP: this.host.getTopP(),
                topK: this.host.getTopK(),
                contextWindow: !endpoint.isLMStudio ? modelProfile?.requestTuning.numCtx : undefined,
                predictTokens: !endpoint.isLMStudio
                    ? (phase === 'followup'
                        ? modelProfile?.requestTuning.followupPredict
                        : modelProfile?.requestTuning.initialPredict)
                    : undefined,
                repeatPenalty: !endpoint.isLMStudio ? modelProfile?.requestTuning.repeatPenalty : undefined,
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
                        const reason = watchdog.getAbortedReason();
                        const recentPreview = streamedText.slice(-240).replace(/\s+/g, ' ').trim();
                        logInfo(`[WATCHDOG] Loop detected (${reason}). Aborting stream. Recent output: ${recentPreview}`);
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
                let text = streamedText || result.text;
                // 태그 보정
                if (text.includes('<edit_file') && !text.includes('</edit_file>')) text += '\n</edit_file>';
                if (text.includes('<create_file') && !text.includes('</create_file>')) text += '\n</create_file>';
                if (text.includes('<run_command') && !text.includes('</run_command>')) text += '\n</run_command>';

                return {
                    text,
                    stopReason: 'watchdog_loop',
                    repeated: true,
                    aborted: true
                };
            }
            return result;
        } catch (err: any) {
            clearInterval(flushInterval);
            flushBuffer();
            if (loopDetected || err?.name === 'AbortError' || axios.isCancel(err)) {
                let text = streamedText;
                // 태그 보정
                if (text.includes('<edit_file') && !text.includes('</edit_file>')) text += '\n</edit_file>';
                if (text.includes('<create_file') && !text.includes('</create_file>')) text += '\n</create_file>';
                if (text.includes('<run_command') && !text.includes('</run_command>')) text += '\n</run_command>';

                return {
                    text,
                    stopReason: loopDetected ? 'watchdog_loop' : 'manual_abort',
                    repeated: loopDetected,
                    aborted: true
                };
            }
            throw err;
        }
    }

    private postSingleLoopStopNotice(stopReason?: string): void {
        const label = isLoopStopReason(stopReason as any)
            ? 'Repeating output detected. Stopping this run before it loops again.'
            : 'This run was stopped before continuing.';
        this.host.postWebviewMessage({
            type: 'streamChunk',
            value: `\n\n> ⚠️ **${label}**\n\n`
        });
    }

    private createCombinedSignal(s1: AbortSignal, s2: AbortSignal): AbortSignal {
        const controller = new AbortController();
        const onAbort = () => controller.abort();
        s1.addEventListener('abort', onAbort);
        s2.addEventListener('abort', onAbort);
        return controller.signal;
    }

    private appendAgentReport(aiMessage: string, report: string[]): string {
        if (report.length === 0) {
            return aiMessage;
        }

        this.postActionReport(report);
        const reportMsg = this.formatActionReport(report);
        return aiMessage + reportMsg;
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

    private buildLivePreview(text: string): string {
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

    /**
     * 모델이 이미지 입력을 지원하는지 판단.
     * Ollama의 newer Gemma 계열은 capability가 비어 있어도 any-to-any/멀티모달로
     * 동작할 수 있으므로 이름, family, 로컬 manifest, /api/show를 모두 OR로 본다.
     */
    private async modelSupportsVision(
        modelName: string,
        endpoint: AIEndpoint,
        installedModel?: { capabilities?: string[]; family?: string }
    ): Promise<{ supportsVision: boolean; reason: string }> {
        if (!modelName) {
            return { supportsVision: false, reason: 'empty model name' };
        }

        // 이름 기반 휴리스틱: Modelfile에 capability 미선언된 모델도 커버
        const lower = modelName.toLowerCase();
        const nameMatch = (
            /gemma\s*3/.test(lower) ||
            /gemma\s*4/.test(lower) ||
            lower.includes('e4b') ||
            lower.includes('26b') ||
            lower.includes('gemma4') ||
            lower.includes('gemma3') ||
            lower.includes('supergemma4') ||
            lower.includes('multimodal') ||
            lower.includes('multi-modal') ||
            lower.includes('any-to-any') ||
            lower.includes('any2any') ||
            lower.includes('mmproj') ||
            lower.includes('llava') ||
            lower.includes('vision') ||
            lower.includes(':vl') ||
            lower.includes('-vl') ||
            lower.includes('_vl') ||
            lower.includes('bakllava') ||
            lower.includes('moondream') ||
            lower.includes('minicpm-v') ||
            lower.includes('cogvlm') ||
            lower.includes('qwen-vl') ||
            lower.includes('internvl')
        );

        if (nameMatch) {
            return { supportsVision: true, reason: 'matched model name heuristic' };
        }

        if (installedModel?.capabilities?.includes('vision')) {
            return { supportsVision: true, reason: 'installed model metadata includes vision capability' };
        }

        if (typeof installedModel?.family === 'string') {
            const family = installedModel.family.toLowerCase();
            if (
                family.includes('vision') ||
                family.includes('gemma4') ||
                family.includes('gemma3') ||
                /gemma\s*4/.test(family) ||
                /gemma\s*3/.test(family) ||
                family.includes('multimodal') ||
                family.includes('multi-modal') ||
                family.includes('any-to-any') ||
                family.includes('any2any') ||
                family.includes('mmproj') ||
                family.includes('llava') ||
                family.includes('moondream')
            ) {
                return { supportsVision: true, reason: `installed model family matched '${installedModel.family}'` };
            }
        }

        // API 확인: 이름으로 못 잡은 모델도 Ollama capabilities로 판단
        if (!endpoint.isLMStudio) {
            const endpointBaseUrl = endpoint.apiUrl.replace(/\/api\/chat$/, '');
            const caps = await getModelCapabilities(modelName, endpointBaseUrl);
            if (caps.includes('vision')) {
                return { supportsVision: true, reason: 'ollama show/api capabilities include vision' };
            }
            return { supportsVision: false, reason: `no vision signal from name, metadata, or ollama capabilities (${caps.join(', ') || 'empty'})` };
        }

        return { supportsVision: false, reason: 'no vision signal from name or installed metadata under LM Studio mode' };
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

    private postStreamErrorDetail(error: any, formatDetail: (detail: string) => string): void {
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
                    this.host.postWebviewMessage({ type: 'error', value: formatDetail(detail) });
                }
            } catch {
                // ignore parsing errors
            }
        });
    }
}

function decodeBase64TextPrefix(base64: string, maxBytes: number): string {
    const prefix = sliceBase64Prefix(base64, maxBytes);

    if (!prefix) {
        return '';
    }

    return Buffer.from(prefix, 'base64')
        .toString('utf-8')
        .replace(/\uFFFD$/, '');
}

function sliceBase64Prefix(base64: string, maxBytes: number): string {
    const encodedLimit = Math.max(4, Math.floor(maxBytes / 3) * 4);
    const end = Math.min(base64.length, encodedLimit);
    const alignedEnd = end - (end % 4);

    if (alignedEnd <= 0) {
        return '';
    }

    return base64.slice(0, alignedEnd);
}

function estimateBase64Bytes(base64: string): number {
    if (!base64) {
        return 0;
    }

    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes}B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)}KB`;
    }

    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function cleanHtmlText(html: string): string {
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isAbortError(error: any): boolean {
    return error?.name === 'AbortError'
        || error?.code === 'ERR_CANCELED'
        || error?.message === 'canceled'
        || error?.message === 'AbortError: This operation was aborted';
}

function formatPromptWithFileError(error: any, ollamaBase: string): string {
    const targetName = getEngineDisplayName(ollamaBase);
    const isOpenAICompatible = targetName !== 'Ollama';
    const defaultPort = targetName === 'Rapid-MLX' ? '8000' : isOpenAICompatible ? '1234' : '11434';

    if (error?.name === 'ReasoningOnlyStreamError') {
        return `⚠️ ${error.message}\n\n**Try this:** switch to a non-thinking model, or make sure ${targetName} is asked to return only final answer content.`;
    }
    if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
        return `⚠️ Could not reach ${targetName}.\n\n**Try this:**\n1. Open ${targetName} and make sure the local server is running.\n2. Check the engine URL in Settings. Default is http://127.0.0.1:${defaultPort}.`;
    }
    if (error.response?.status === 400) {
        return `⚠️ Model request failed (400).\n\n**Usually this means:** the model name is off, or the prompt blew past the context window.\n**Try this:** pick the right model from the dropdown.\n${isOpenAICompatible ? `• In ${targetName}, make sure the model is loaded and the /v1 server is running.` : '• In Ollama, run `ollama list` and make sure the model exists.'}`;
    }
    if (error.response?.status === 404) {
        return `⚠️ Model not found (404).\n\nThe selected model is not available in ${targetName} right now.\n${isOpenAICompatible ? `Load it in ${targetName} first, then try again.` : 'Pull it first with `ollama pull <model-name>`.'}`;
    }
    if (error.response?.status === 413) {
        return '⚠️ Context limit hit (413).\n\nTry turning vault mode off for a moment, or spin up a fresh thread with `+`.';
    }
    if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
        return '⚠️ The model timed out.\n\nTry a smaller model, a shorter prompt, or a longer request timeout.';
    }
    return `⚠️ Error: ${error.message}`;
}

function formatPromptError(error: any, ollamaBase: string): string {
    const targetName = getEngineDisplayName(ollamaBase);

    if (error?.name === 'ReasoningOnlyStreamError') {
        return `⚠️ ${error.message}\n\nSwitch to a non-thinking model, or make sure ${targetName} returns final answer content instead of reasoning trace only.`;
    }
    if (error.code === 'ECONNREFUSED') {
        return `⚠️ Could not reach ${targetName}.\nMake sure the local server is up.`;
    }
    if (error.response?.status === 400 || error.response?.status === 413) {
        return '⚠️ Context limit hit. The prompt is too large. Start a fresh thread or trim the request.';
    }
    return `⚠️ Error: ${error.message}`;
}
