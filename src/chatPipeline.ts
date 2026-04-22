import axios from 'axios';
import { getConfig } from './config';
import { resolveAIEndpoint, streamCompletion } from './aiClient';
import type { AIEndpoint, AttachedFile, ChatMessage, DisplayMessage } from './types';

export interface ChatPipelineHost {
    buildRequestMessages(internetEnabled?: boolean, backgroundLabel?: string): ChatMessage[];
    executeActions(aiMessage: string): Promise<string[]>;
    getChatHistory(): ChatMessage[];
    getDisplayMessages(): DisplayMessage[];
    getTemperature(): number;
    getTopK(): number;
    getTopP(): number;
    postWebviewMessage(message: unknown): void;
    readBrainFile(filename: string): string;
    saveHistory(): void;
    setAbortController(controller?: AbortController): void;
    setLastPrompt(prompt: string, modelName: string, files?: AttachedFile[], internetEnabled?: boolean): void;
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
            const attachments = this.prepareAttachments(files);

            this.host.getChatHistory().push({ role: 'user', content: options.prompt + attachments.fileContext });
            const displayMessage: DisplayMessage = { text: options.prompt, role: 'user' };
            if (hasFiles) {
                displayMessage.files = attachments.displayFiles;
            }
            this.host.getDisplayMessages().push(displayMessage);

            const reqMessages = this.host.buildRequestMessages(
                options.internetEnabled,
                DEFAULT_BACKGROUND_LABEL
            );
            this.attachImagesToRequest(endpoint, reqMessages, attachments.imageFiles);

            this.host.postWebviewMessage({ type: 'streamStart' });

            for (const notice of attachments.notices) {
                this.host.postWebviewMessage({ type: 'streamChunk', value: notice });
            }

            this.host.setLastPrompt(options.prompt, options.modelName, this.compactFilesForReuse(files), options.internetEnabled);
            abortController = new AbortController();
            this.host.setAbortController(abortController);

            let aiMessage = await this.streamMessages(
                endpoint,
                reqMessages,
                selectedModel,
                config.timeout,
                abortController.signal
            );

            aiMessage = await this.resolveModelReadRequests(
                aiMessage,
                reqMessages,
                endpoint,
                selectedModel,
                config.timeout,
                abortController.signal
            );

            this.host.getChatHistory().push({ role: 'assistant', content: aiMessage });

            const report = await this.host.executeActions(aiMessage);
            const finalMessage = this.appendAgentReport(aiMessage, report);
            this.host.postWebviewMessage({ type: 'streamEnd' });
            this.host.getDisplayMessages().push({ text: this.stripActionTags(finalMessage), role: 'ai' });
            this.trimHistory();
            this.host.saveHistory();
        } catch (error: any) {
            const { ollamaBase } = getConfig();
            this.host.postWebviewMessage({
                type: 'error',
                value: hasFiles ? formatPromptWithFileError(error, ollamaBase) : formatPromptError(error, ollamaBase)
            });
            if (hasFiles) {
                this.postStreamErrorDetail(error, detail => `⚠️ API 자세한 오류: ${detail}`);
            } else {
                this.postStreamErrorDetail(error, detail => {
                    const refined = detail.includes('greater than the context length')
                        ? '프로젝트 정보가 모델의 Context Length(기억력 한계)를 초과합니다.\n💡 해결책: LM Studio에서 모델을 불러올 때 오른쪽 설정 패널에서 [Context Length] 슬라이더를 8192 수정 후 리로드하세요.'
                        : detail;
                    return `💡 가이드: ${refined}`;
                });
            }
        } finally {
            if (abortController) {
                this.host.setAbortController(undefined);
            }
        }
    }

    private prepareAttachments(files: AttachedFile[]): PreparedAttachments {
        const prepared: PreparedAttachments = {
            fileContext: '',
            imageFiles: [],
            displayFiles: [],
            notices: []
        };

        for (const file of files) {
            const type = file.type || 'application/octet-stream';
            const size = file.originalSize ?? estimateBase64Bytes(file.data);

            if (type.startsWith('image/')) {
                if (size > MAX_IMAGE_ATTACHMENT_BYTES) {
                    prepared.displayFiles.push({ name: file.name, type, data: '' });
                    prepared.notices.push(`\n\n> 📎 **[첨부 이미지 제외]** ${file.name}: ${formatBytes(size)} 이미지가 너무 커서 모델 요청에서 제외했습니다. 최대 ${formatBytes(MAX_IMAGE_ATTACHMENT_BYTES)}까지 지원합니다.\n\n`);
                    continue;
                }

                prepared.imageFiles.push({ ...file, type });
                prepared.displayFiles.push({ name: file.name, type, data: file.data });
                continue;
            }

            const decoded = decodeBase64TextPrefix(file.data, MAX_TEXT_ATTACHMENT_DECODE_BYTES);
            const preview = decoded.slice(0, MAX_TEXT_ATTACHMENT_CHARS);
            const wasTruncated = Boolean(file.truncated)
                || size > MAX_TEXT_ATTACHMENT_DECODE_BYTES
                || decoded.length > MAX_TEXT_ATTACHMENT_CHARS;
            const note = wasTruncated
                ? ` (큰 파일이라 일부만 포함: 최대 ${formatBytes(MAX_TEXT_ATTACHMENT_DECODE_BYTES)} / 전체 ${formatBytes(size)})`
                : '';

            prepared.fileContext += `\n\n[첨부 파일: ${file.name}${note}]\n\`\`\`\n${preview}\n\`\`\``;
            prepared.displayFiles.push({ name: file.name, type, data: '' });

            if (wasTruncated) {
                prepared.notices.push(`\n\n> 📎 **[첨부 파일 일부만 사용]** ${file.name}: 큰 파일이라 처음 ${formatBytes(MAX_TEXT_ATTACHMENT_DECODE_BYTES)} 정도만 모델 컨텍스트에 넣었습니다. 전체 크기: ${formatBytes(size)}.\n\n`);
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

    private async resolveModelReadRequests(
        aiMessage: string,
        reqMessages: ChatMessage[],
        endpoint: AIEndpoint,
        selectedModel: string,
        timeout: number,
        signal?: AbortSignal
    ): Promise<string> {
        const brainReads = [...aiMessage.matchAll(/<read_brain>([\s\S]*?)<\/read_brain>/g)];
        const urlReads = [...aiMessage.matchAll(/<read_url>([\s\S]*?)<\/read_url>/gi)];

        if (brainReads.length === 0 && urlReads.length === 0) {
            return aiMessage;
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
                const msg = `\n\n> 🌐 **[웹 검색 완료]** ${url} (${cleaned.length}자)\n\n`;
                uiFeedbackStr += msg;
                this.host.postWebviewMessage({ type: 'streamChunk', value: msg });
            } catch (err: any) {
                fetchedContent += `\n\n[WEB CONTENT: ${url}] (FAILED: ${err.message})\n`;
                const msg = `\n\n> 🌐 **[웹 검색 실패]** ${url} - ${err.message}\n\n`;
                uiFeedbackStr += msg;
                this.host.postWebviewMessage({ type: 'streamChunk', value: msg });
            }
        }

        const cleanedResponse = aiMessage.replace(/<read_brain>[\s\S]*?<\/read_brain>/g, '')
            .replace(/<read_url>[\s\S]*?<\/read_url>/gi, '')
            .trim();

        if (brainReads.length > 0) {
            const msg = `\n\n> 🧠 **[Second Brain 열람 완료]** 스캔한 핵심 지식을 바탕으로 답변을 구성합니다...\n\n`;
            uiFeedbackStr += msg;
            this.host.postWebviewMessage({ type: 'streamChunk', value: msg });
        }

        reqMessages.push({ role: 'assistant', content: cleanedResponse || '탐색을 진행 중입니다...' });
        reqMessages.push({
            role: 'user',
            content: `[SYSTEM: The following documents and web contents were retrieved based on your actions. Use this information to provide a complete and accurate answer to the user's original question.]\n${fetchedContent}\n\nNow answer the user's question using the above knowledge. Do NOT output <read_brain> or <read_url> again. Answer directly and comprehensively.`
        });

        return cleanedResponse + uiFeedbackStr + await this.streamMessages(
            endpoint,
            reqMessages,
            selectedModel,
            timeout,
            signal
        );
    }

    private async streamMessages(
        endpoint: AIEndpoint,
        messages: ChatMessage[],
        modelName: string,
        timeout: number,
        signal?: AbortSignal
    ): Promise<string> {
        return streamCompletion({
            endpoint,
            messages,
            modelName,
            timeout,
            temperature: this.host.getTemperature(),
            topP: this.host.getTopP(),
            topK: this.host.getTopK(),
            signal
        }, token => {
            this.host.postWebviewMessage({ type: 'streamChunk', value: token });
        });
    }

    private appendAgentReport(aiMessage: string, report: string[]): string {
        if (report.length === 0) {
            return aiMessage;
        }

        const reportMsg = `\n\n---\n**에이전트 작업 결과**\n${report.join('\n')}`;
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
        return text
            .replace(/<(?:create_file|file)\s+[^>]*>[\s\S]*?<\/(?:create_file|file)>/gi, '')
            .replace(/<(?:edit_file|edit)\s+[^>]*>[\s\S]*?<\/(?:edit_file|edit)>/gi, '')
            .replace(/<(?:delete_file|delete)\s+[^>]*\s*\/?>(?:<\/(?:delete_file|delete)>)?/gi, '')
            .replace(/<(?:read_file|read)\s+[^>]*\s*\/?>(?:<\/(?:read_file|read)>)?/gi, '')
            .replace(/<(?:list_files|list_dir|ls)\s+[^>]*\s*\/?>(?:<\/(?:list_files|list_dir|ls)>)?/gi, '')
            .replace(/<(?:run_command|command|bash|terminal)>[\s\S]*?<\/(?:run_command|command|bash|terminal)>/gi, '')
            .replace(/<(?:read_brain)>[\s\S]*?<\/(?:read_brain)>/gi, '')
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

function formatPromptWithFileError(error: any, ollamaBase: string): string {
    const isLM = ollamaBase.includes('1234') || ollamaBase.includes('v1');
    const targetName = isLM ? 'LM Studio' : 'Ollama';

    if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
        return `⚠️ ${targetName} 서버에 연결할 수 없습니다.\n\n**해결 방법:**\n1. ${targetName} 앱을 열고 서버가 켜져 있는지(Start Server) 확인\n2. Settings > 모델 기본 URL이 올바른지 확인 (기본: http://127.0.0.1:${isLM ? '1234' : '11434'})`;
    }
    if (error.response?.status === 400) {
        return `⚠️ 모델 요청 오류 (400)\n\n**원인:** 모델 이름이 올바르지 않거나, 컨텍스트 길이 초과\n**해결:** 좌측 모델 선택 드롭다운에서 정확한 모델을 선택하세요.\n${isLM ? '• LM Studio의 경우 모델을 먼저 로드(Load)한 후 시도하세요.' : '• Ollama: ollama list 로 설치된 모델 확인'}`;
    }
    if (error.response?.status === 404) {
        return `⚠️ 모델을 찾을 수 없습니다 (404)\n\n**원인:** 선택한 모델이 ${targetName}에 로드되지 않았습니다.\n**해결:** ${isLM ? 'LM Studio에서 해당 모델을 먼저 다운로드 후 Load 해주세요.' : 'ollama pull 모델이름 으로 먼저 다운로드하세요.'}`;
    }
    if (error.response?.status === 413) {
        return '⚠️ 컨텍스트 용량 초과 (413)\n\n**해결:** 🧠 지식 모드를 일시적으로 OFF 하거나, + 버튼으로 새 대화를 시작하세요.';
    }
    if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
        return '⚠️ AI 응답 시간 초과\n\n모델이 문제를 처리하는 데 시간이 너무 오래 걸렸습니다.\n**해결:** 더 작은 모델을 선택하거나, 질문을 짧게 줄여보세요.';
    }
    return `⚠️ 오류: ${error.message}`;
}

function formatPromptError(error: any, ollamaBase: string): string {
    const isLM = ollamaBase.includes('1234') || ollamaBase.includes('v1');
    const targetName = isLM ? 'LM Studio' : 'Ollama';

    if (error.code === 'ECONNREFUSED') {
        return `⚠️ ${targetName} 서버에 연결할 수 없습니다.\n앱에서 로컬 서버가 켜져 있는지(Start Server) 확인해주세요.`;
    }
    if (error.response?.status === 400 || error.response?.status === 413) {
        return '⚠️ 컨텍스트 용량 초과: 입력이 너무 깁니다. 새 대화(+)를 시작하거나 질문을 줄여주세요.';
    }
    return `⚠️ 오류: ${error.message}`;
}
