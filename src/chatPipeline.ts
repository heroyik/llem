import axios from 'axios';
import { getConfig } from './config';
import { findInstalledModelInfo, buildModelProfile } from './performanceProfiles';
import { PerfLogger } from './perfLogger';
import { resolveAIEndpoint, streamCompletion } from './aiClient';
import { buildContinuationSystemMessage } from './chatPipelineHelpers';
import { getInstalledModelCatalog } from './modelDiscovery';
import { allocateAttachmentPreview, getAttachmentBudgetLimits } from './promptBudgeting';
import { logStreamEvent } from './logger';
import type { AIEndpoint, AttachedFile, ChatMessage, DisplayMessage, ModelProfile } from './types';

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
    }): ChatMessage[];
    executeActions(aiMessage: string): Promise<string[]>;
    getChatHistory(): ChatMessage[];
    getDisplayMessages(): DisplayMessage[];
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
    ): Promise<void> {
        await this.runPrompt({ prompt, modelName, files, internetEnabled });
    }

    public async handlePrompt(prompt: string, modelName: string, internetEnabled?: boolean): Promise<void> {
        await this.runPrompt({ prompt, modelName, internetEnabled });
    }

    private async runPrompt(options: PromptRunOptions): Promise<void> {
        const files = options.files ?? [];
        const hasFiles = files.length > 0;
        let abortController: AbortController | undefined;

        try {
            const config = getConfig();
            const endpoint = await resolveAIEndpoint(config);
            const selectedModel = this.selectedModel(options.modelName, config.defaultModel);
            const modelCatalog = await getInstalledModelCatalog(config.ollamaBase).catch(() => []);
            const installedModel = findInstalledModelInfo(selectedModel, modelCatalog);
            const modelProfile = buildModelProfile({
                modelName: selectedModel,
                requestedPreset: config.performancePreset,
                parameterSize: installedModel?.parameterSize,
                family: installedModel?.family
            });
            const attachments = this.prepareAttachments(files, modelProfile);
            const reusableFiles = this.compactFilesForReuse(files);
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

            const reqMessages = this.host.buildRequestMessages({
                internetEnabled: options.internetEnabled,
                backgroundLabel: DEFAULT_BACKGROUND_LABEL,
                modelProfile,
                activeModelName: selectedModel,
                activeEngineName: endpoint.isLMStudio ? 'LM Studio' : 'Ollama',
                attachmentNames: attachments.textAttachmentNames,
                attachmentChars: attachments.includedChars,
                prunedAttachmentChars: attachments.prunedChars
            });

            const promptChars = reqMessages.reduce((sum, msg) => sum + (typeof msg.content === 'string' ? msg.content.length : JSON.stringify(msg.content).length), 0);
            PerfLogger.update({ promptSizeEstimateChars: promptChars, finalRequestChars: promptChars });

            this.attachImagesToRequest(endpoint, reqMessages, attachments.imageFiles);

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

            let turn = 0;
            const maxTurns = 10;

            while (turn < maxTurns) {
                let turnExecuted = false;
                let combinedSystemFeedback = '';
                let combinedUiFeedback = '';
                let cleanedAiResponse = currentAiResponse;

                // 1. Resolve internal read requests (vault, url)
                const internalResult = await this.resolveInternalActions(currentAiResponse, endpoint, selectedModel, config.timeout, abortController.signal);
                if (internalResult.executed) {
                    turnExecuted = true;
                    cleanedAiResponse = internalResult.cleanedResponse;
                    combinedSystemFeedback += internalResult.systemFeedback + '\n';
                    combinedUiFeedback += internalResult.uiFeedback;
                }

                // 2. Resolve external actions (file, terminal)
                // Note: executeActions already handles history and UI chunking for external tools
                const externalReport = await this.host.executeActions(currentAiResponse);
                if (externalReport.length > 0) {
                    turnExecuted = true;
                    const reportMsg = `\n\n---\n**Action Report**\n${externalReport.join('\n')}`;
                    combinedUiFeedback += reportMsg;
                }

                if (turnExecuted) {
                    // Update full AI message with what we've processed so far
                    // We strip action tags from the display version later, but we need the feedback here
                    fullAiMessage += cleanedAiResponse + combinedUiFeedback;

                    this.host.getChatHistory().push({ role: 'assistant', content: currentAiResponse });
                    const continuationMessage = buildContinuationSystemMessage(combinedSystemFeedback, externalReport);
                    if (continuationMessage) {
                        this.host.getChatHistory().push({ role: 'user', content: continuationMessage });
                    }

                    // Re-prompt
                    const nextReqMessages = this.host.buildRequestMessages({
                        internetEnabled: options.internetEnabled,
                        backgroundLabel: DEFAULT_BACKGROUND_LABEL,
                        modelProfile,
                        activeModelName: selectedModel,
                        activeEngineName: endpoint.isLMStudio ? 'LM Studio' : 'Ollama',
                        attachmentNames: attachments.textAttachmentNames,
                        attachmentChars: attachments.includedChars,
                        prunedAttachmentChars: attachments.prunedChars
                    });
                    currentAiResponse = await this.streamMessages(endpoint, nextReqMessages, selectedModel, config.timeout, abortController.signal, modelProfile, 'followup');
                    turn++;
                    continue;
                }

                // No more actions
                fullAiMessage += currentAiResponse;
                break;
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
            await this.host.saveHistory();
            this.host.postWebviewMessage({
                type: 'streamEnd',
                message: finalDisplayMessage,
                messageIndex: this.host.getDisplayMessages().length - 1
            });
        } catch (error: any) {
            if (isAbortError(error)) {
                this.host.postWebviewMessage({ type: 'streamAbort' });
                return;
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
                if (size > MAX_IMAGE_ATTACHMENT_BYTES) {
                    prepared.displayFiles.push({ name: file.name, type, data: '' });
                    prepared.notices.push(`\n\n> 📎 **[Image skipped]** ${file.name}: ${formatBytes(size)} is too large for the model request. Max supported size is ${formatBytes(MAX_IMAGE_ATTACHMENT_BYTES)}.\n\n`);
                    continue;
                }

                prepared.imageFiles.push({ ...file, type });
                prepared.displayFiles.push({ name: file.name, type, data: file.data });
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
        if (imageFiles.length === 0) {
            return;
        }

        if (endpoint.isLMStudio) {
            const lastUserMsg = reqMessages[reqMessages.length - 1];
            const contentParts: any[] = [{ type: 'text', text: lastUserMsg.content }];
            for (const img of imageFiles) {
                contentParts.push({ type: 'image_url', image_url: { url: `data:${img.type || 'image/png'};base64,${img.data}` } });
            }
            reqMessages[reqMessages.length - 1] = { role: 'user', content: contentParts };
        } else {
            const ollamaImages = imageFiles.map(img => img.data);
            reqMessages[reqMessages.length - 1] = {
                ...reqMessages[reqMessages.length - 1],
                images: ollamaImages
            } as any;
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
    ): Promise<string> {
        const streamStart = performance.now();
        let firstTokenTime = 0;
        let tokenCount = 0;

        let buffer = '';
        const flushBuffer = () => {
            if (buffer) {
                this.host.postWebviewMessage({ type: 'streamChunk', value: buffer });
                buffer = '';
            }
        };

        const flushInterval = setInterval(flushBuffer, 50);

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
            signal
        }, token => {
            if (firstTokenTime === 0) {
                firstTokenTime = performance.now();
                PerfLogger.update({ streamFirstTokenMs: firstTokenTime - streamStart });
            }
            tokenCount++;
            buffer += token;
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

        return result;
    }

    private appendAgentReport(aiMessage: string, report: string[]): string {
        if (report.length === 0) {
            return aiMessage;
        }

        const reportMsg = `\n\n---\n**Action Report**\n${report.join('\n')}`;
        this.host.postWebviewMessage({ type: 'streamChunk', value: reportMsg });
        return aiMessage + reportMsg;
    }

    private selectedModel(modelName: string, defaultModel: string): string {
        return modelName || defaultModel;
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
        if (!text) { return ''; }
        // We use a more aggressive approach to strip all potential tool tags
        // including those with 'call:' prefix and various self-closing forms.
        return text
            .replace(/<(?:create_file|file|call:create_file|call:file)\s+[^>]*>[\s\S]*?<\/(?:create_file|file|call:create_file|call:file)>/gi, '')
            .replace(/<(?:edit_file|edit|call:edit_file|call:edit)\s+[^>]*>[\s\S]*?<\/(?:edit_file|edit|call:edit_file|call:edit)>/gi, '')
            .replace(/<(?:delete_file|delete|call:delete_file|call:delete)\s+[^>]*\s*\/?>(?:<\/(?:delete_file|delete|call:delete_file|call:delete)>)?/gi, '')
            .replace(/<(?:read_file|read|call:read_file|call:read)\s+[^>]*\s*\/?>(?:<\/(?:read_file|read|call:read_file|call:read)>)?/gi, '')
            .replace(/<(?:list_files|list_dir|ls|call:list_files|call:list_dir|call:ls)\s+[^>]*\s*\/?>(?:<\/(?:list_files|list_dir|ls|call:list_files|call:list_dir|call:ls)>)?/gi, '')
            .replace(/<(?:run_command|command|bash|terminal|call:run_command|call:command|call:bash|call:terminal)>[\s\S]*?<\/(?:run_command|command|bash|terminal|call:run_command|call:command|call:bash|call:terminal)>/gi, '')
            .replace(/<(?:read_url|url|fetch_url|call:read_url|call:url|call:fetch_url)>[\s\S]*?<\/(?:read_url|url|fetch_url|call:read_url|call:url|call:fetch_url)>/gi, '')
            .replace(/<(?:read_brain|read_vault|call:read_brain|call:read_vault)>[\s\S]*?<\/(?:read_brain|read_vault|call:read_brain|call:read_vault)>/gi, '')
            .replace(/<call:[^>]+>[\s\S]*?<\/call:[^>]+>/gi, '')
            .replace(/<call:[^>]*\/>/gi, '')
            .trim();
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
    const isLM = ollamaBase.includes('1234') || ollamaBase.includes('v1');
    const targetName = isLM ? 'LM Studio' : 'Ollama';

    if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
        return `⚠️ Could not reach ${targetName}.\n\n**Try this:**\n1. Open ${targetName} and make sure the local server is running.\n2. Check the engine URL in Settings. Default is http://127.0.0.1:${isLM ? '1234' : '11434'}.`;
    }
    if (error.response?.status === 400) {
        return `⚠️ Model request failed (400).\n\n**Usually this means:** the model name is off, or the prompt blew past the context window.\n**Try this:** pick the right model from the dropdown.\n${isLM ? '• In LM Studio, make sure the model is actually loaded first.' : '• In Ollama, run `ollama list` and make sure the model exists.'}`;
    }
    if (error.response?.status === 404) {
        return `⚠️ Model not found (404).\n\nThe selected model is not available in ${targetName} right now.\n${isLM ? 'Load it in LM Studio first, then try again.' : 'Pull it first with `ollama pull <model-name>`.'}`;
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
    const isLM = ollamaBase.includes('1234') || ollamaBase.includes('v1');
    const targetName = isLM ? 'LM Studio' : 'Ollama';

    if (error.code === 'ECONNREFUSED') {
        return `⚠️ Could not reach ${targetName}.\nMake sure the local server is up.`;
    }
    if (error.response?.status === 400 || error.response?.status === 413) {
        return '⚠️ Context limit hit. The prompt is too large. Start a fresh thread or trim the request.';
    }
    return `⚠️ Error: ${error.message}`;
}
