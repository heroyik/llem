import {
    cancelPendingRequest,
    clearPendingRequests,
    createRequestQueueState,
    enqueueRequest as enqueueQueueState,
    finishActiveRequest,
    movePendingRequest,
    pauseQueue,
    promoteNextRequest,
    resetQueueState,
    resumeQueue as resumeQueueState,
    type RequestQueueState
} from './queueState';
import type { RequestRetryGuard } from './requestRetryGuard';
import type {
    AttachedFile,
    QueuedRequest,
    QueueRequestKind,
    QueueRequestSummary,
    QueueStatePayload
} from './types';

export interface ExecutionResult {
    repeated: boolean;
    stopReason?: string;
    repeatedKind?: string;
    repeatedToken?: string;
    retryable?: boolean;
}

export interface QueueManagerDeps {
    postWebviewMessage(message: any): void;
    requestRetryGuard: RequestRetryGuard;
    removeLastAssistantResponse(): void;

    // Execution callbacks (pipeline operations implemented in SidebarChatProvider)
    executePrompt(prompt: string, modelName: string, internetEnabled?: boolean): Promise<ExecutionResult | undefined>;
    executePromptWithFiles(prompt: string, modelName: string, files: AttachedFile[], internetEnabled?: boolean): Promise<ExecutionResult | undefined>;
    executeEdit(messageIndex: number, prompt: string, modelName: string, files: AttachedFile[], internetEnabled?: boolean): Promise<ExecutionResult | undefined>;

    // Logging
    logInfo(message: string): void;
    logError(message: string): void;
}

export interface QueueManager {
    createQueuedRequest(input: {
        kind: QueueRequestKind;
        prompt: string;
        modelName: string;
        files?: AttachedFile[];
        internetEnabled?: boolean;
        messageIndex?: number;
    }): QueuedRequest;

    enqueueRequest(request: QueuedRequest): Promise<void>;
    cancelQueuedRequest(id: string): Promise<void>;
    clearQueuedRequests(): Promise<void>;
    moveQueuedRequest(id: string, direction: 'up' | 'down'): Promise<void>;
    editQueuedRequest(id: string): Promise<void>;
    resumeQueue(): Promise<void>;
    reset(options?: { abortActive?: boolean }): Promise<void>;
    stopGeneration(): void;
    setAbortController(controller: AbortController | undefined): void;
}

function summarizeQueuedRequest(request: QueuedRequest): QueueRequestSummary {
    return {
        id: request.id,
        kind: request.kind,
        prompt: request.prompt,
        modelName: request.modelName,
        internetEnabled: request.internetEnabled,
        messageIndex: request.messageIndex,
        createdAt: request.createdAt,
        attachmentCount: request.files?.length || 0
    };
}

function buildQueueStatePayload(queueState: RequestQueueState): QueueStatePayload {
    return {
        running: Boolean(queueState.activeRequest),
        paused: queueState.paused,
        activeRequest: queueState.activeRequest ? summarizeQueuedRequest(queueState.activeRequest) : undefined,
        pendingRequests: queueState.pendingRequests.map(request => summarizeQueuedRequest(request))
    };
}

function syncToWebview(postMessage: (message: any) => void, queueState: RequestQueueState): void {
    postMessage({ type: 'queueState', value: buildQueueStatePayload(queueState) });
}

export function createQueueManager(deps: QueueManagerDeps): QueueManager {
    let queueState: RequestQueueState = createRequestQueueState();
    let abortController: AbortController | undefined;
    let activeRequestPromise: Promise<void> | undefined;
    let isProcessingQueue: boolean = false;
    let queueCheckTimer: NodeJS.Timeout | undefined;

    function notify(): void {
        syncToWebview(deps.postWebviewMessage, queueState);
    }

    async function enqueueRequest(request: QueuedRequest): Promise<void> {
        const retryStatus = deps.requestRetryGuard.shouldBlock(request);
        if (retryStatus.blocked) {
            const reason = retryStatus.reason || 'recent repetition stop';
            deps.logInfo(`[QUEUE] Blocked immediate retry for ${request.kind} (${request.id}) due to ${reason}`);
            deps.postWebviewMessage({
                type: 'response',
                value: `> ⚠️ 방금 반복 중단된 요청과 같은 요청이라 잠시 다시 실행하지 않았습니다. 이유: ${reason}`
            });
            return;
        }
        queueState = enqueueQueueState(queueState, request);
        deps.logInfo(`[QUEUE] Enqueued ${request.kind} (${request.id}); pending=${queueState.pendingRequests.length}`);
        notify();
        void runNextRequestIfIdle();
    }

    async function runNextRequestIfIdle(): Promise<void> {
        if (isProcessingQueue) {
            return;
        }

        if (queueCheckTimer) {
            clearTimeout(queueCheckTimer);
            queueCheckTimer = undefined;
        }

        const promoted = promoteNextRequest(queueState);
        queueState = promoted.state;
        const nextRequest = promoted.nextRequest;
        if (!nextRequest) {
            notify();

            if (queueState.pendingRequests.length > 0) {
                const now = Date.now();
                const scheduledTimes = queueState.pendingRequests
                    .map(r => r.scheduledAt)
                    .filter((t): t is number => !!t);

                if (scheduledTimes.length > 0) {
                    const nextReadyTime = Math.min(...scheduledTimes);
                    const delay = Math.max(500, nextReadyTime - now);
                    deps.logInfo(`[QUEUE] Next request ready in ${delay}ms; setting check timer.`);
                    queueCheckTimer = setTimeout(() => runNextRequestIfIdle(), delay);
                }
            }
            return;
        }

        isProcessingQueue = true;
        notify();

        const execution = executeQueuedRequest(nextRequest)
            .catch((error) => {
                deps.logError('[QUEUE] Failed to execute queued request: ' + (error instanceof Error ? error.message : String(error)));
            })
            .finally(async () => {
                queueState = finishActiveRequest(queueState);
                activeRequestPromise = undefined;
                isProcessingQueue = false;
                notify();
                await runNextRequestIfIdle();
            });

        activeRequestPromise = execution;
        await execution;
    }

    async function executeQueuedRequest(request: QueuedRequest): Promise<void> {
        deps.logInfo(`[QUEUE] Starting ${request.kind} (${request.id})`);

        if (request.wasQueued && request.kind !== 'editMessage') {
            deps.postWebviewMessage({
                type: 'queuedRequestStarting',
                value: {
                    prompt: request.prompt,
                    files: request.files || []
                }
            });
        }

        switch (request.kind) {
            case 'promptWithFile':
                await handleExecutionResult(
                    request,
                    await deps.executePromptWithFiles(request.prompt, request.modelName, request.files || [], request.internetEnabled)
                );
                return;
            case 'editMessage':
                await handleExecutionResult(
                    request,
                    await deps.executeEdit(request.messageIndex ?? -1, request.prompt, request.modelName, request.files || [], request.internetEnabled)
                );
                return;
            case 'regenerate':
                deps.removeLastAssistantResponse();
                if ((request.files || []).length > 0) {
                    await handleExecutionResult(
                        request,
                        await deps.executePromptWithFiles(request.prompt, request.modelName, request.files || [], request.internetEnabled)
                    );
                    return;
                }
                await handleExecutionResult(
                    request,
                    await deps.executePrompt(request.prompt, request.modelName, request.internetEnabled)
                );
                return;
            case 'prompt':
                await handleExecutionResult(
                    request,
                    await deps.executePrompt(request.prompt, request.modelName, request.internetEnabled)
                );
                return;
        }
    }

    async function handleExecutionResult(
        request: QueuedRequest,
        result?: ExecutionResult
    ): Promise<void> {
        if (!result?.repeated) {
            deps.requestRetryGuard.clearRetryHistory(request);
            return;
        }

        const reason = result.stopReason || 'repetition detected';
        if (result.retryable === false) {
            deps.requestRetryGuard.markRepeated(request, reason, { retryable: false });
            const filtered = deps.requestRetryGuard.filterBlocked(queueState.pendingRequests);
            if (filtered.blocked.length > 0) {
                queueState = {
                    ...queueState,
                    pendingRequests: filtered.allowed
                };
                deps.logInfo(`[QUEUE] Removed ${filtered.blocked.length} queued retry request(s) after non-retryable repetition stop`);
            }
            deps.logInfo('[QUEUE] Repetition stop is non-retryable; not scheduling retry');
            deps.postWebviewMessage({
                type: 'streamChunk',
                value: `\n\n> ⚠️ 반복 출력이 감지되어 자동 재시도 없이 중단했습니다. 부분 결과는 반복 꼬리를 제거해 보존했습니다.\n\n`
            });
            notify();
            return;
        }

        const { retryAllowed, nextDelayMs } = deps.requestRetryGuard.markRepeated(request, reason);

        if (retryAllowed) {
            const retryCount = (request.retryCount ?? 0) + 1;
            const scheduledAt = Date.now() + nextDelayMs;

            const retryRequest: QueuedRequest = {
                ...request,
                retryCount,
                scheduledAt,
                wasQueued: true
            };

            queueState = enqueueQueueState(queueState, retryRequest);
            deps.logInfo(`[QUEUE] Scheduled retry ${retryCount} for ${request.id} in ${nextDelayMs}ms`);

            deps.postWebviewMessage({
                type: 'streamChunk',
                value: `\n\n> ⏳ **[Cooldown]** Repetition detected. Analyzing cause and retrying in ${Math.round(nextDelayMs / 1000)}s... (Attempt ${retryCount}/3)\n\n`
            });

            notify();
            void runNextRequestIfIdle();
        } else {
            const filtered = deps.requestRetryGuard.filterBlocked(queueState.pendingRequests);
            if (filtered.blocked.length > 0) {
                queueState = {
                    ...queueState,
                    pendingRequests: filtered.allowed
                };
                deps.logInfo(`[QUEUE] Removed ${filtered.blocked.length} queued retry request(s) after repetition limit reached`);
            }

            deps.postWebviewMessage({
                type: 'streamChunk',
                value: `\n\n> ⚠️ **[Limit Reached]** I've attempted to fix the repetition loop 3 times but was unsuccessful. It seems the task might be conflicting with current constraints or logic. **Could you please point out which part is incorrect or provide more specific instructions to help me break this loop?**\n\n`
            });

            notify();
        }
    }

    return {
        createQueuedRequest(input: {
            kind: QueueRequestKind;
            prompt: string;
            modelName: string;
            files?: AttachedFile[];
            internetEnabled?: boolean;
            messageIndex?: number;
        }): QueuedRequest {
            return {
                id: `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
                kind: input.kind,
                prompt: input.prompt,
                modelName: input.modelName,
                files: input.files?.map(file => ({ ...file })),
                internetEnabled: input.internetEnabled,
                messageIndex: input.messageIndex,
                createdAt: Date.now()
            };
        },

        async enqueueRequest(request: QueuedRequest): Promise<void> {
            await enqueueRequest(request);
        },

        async cancelQueuedRequest(id: string): Promise<void> {
            const before = queueState.pendingRequests.length;
            queueState = cancelPendingRequest(queueState, id);
            if (queueState.pendingRequests.length === before) {
                return;
            }
            deps.logInfo('[QUEUE] Cancelled queued request ' + id);
            notify();
        },

        async clearQueuedRequests(): Promise<void> {
            if (queueState.pendingRequests.length === 0) {
                return;
            }
            queueState = clearPendingRequests(queueState);
            deps.logInfo('[QUEUE] Cleared pending queue');
            notify();
        },

        async moveQueuedRequest(id: string, direction: 'up' | 'down'): Promise<void> {
            const moved = movePendingRequest(queueState, id, direction);
            if (moved === queueState) {
                return;
            }
            queueState = moved;
            deps.logInfo(`[QUEUE] Moved queued request ${id} ${direction}`);
            notify();
        },

        async editQueuedRequest(id: string): Promise<void> {
            const request = queueState.pendingRequests.find(item => item.id === id);
            if (!request) {
                return;
            }

            queueState = cancelPendingRequest(queueState, id);
            notify();
            deps.postWebviewMessage({
                type: 'editQueuedRequest',
                value: {
                    kind: request.kind,
                    prompt: request.prompt,
                    modelName: request.modelName,
                    files: request.files || [],
                    internetEnabled: request.internetEnabled,
                    messageIndex: request.messageIndex
                }
            });
        },

        async resumeQueue(): Promise<void> {
            if (!queueState.paused) {
                return;
            }

            queueState = resumeQueueState(queueState);
            deps.logInfo('[QUEUE] Resumed pending queue');
            notify();
            void runNextRequestIfIdle();
        },

        async reset(options: { abortActive?: boolean } = {}): Promise<void> {
            queueState = resetQueueState();
            notify();

            if (options.abortActive && abortController) {
                abortController.abort();
            }

            if (activeRequestPromise) {
                try {
                    await activeRequestPromise;
                } catch {
                    // Execution errors are already logged at the queue layer.
                }
            }

            activeRequestPromise = undefined;
            isProcessingQueue = false;
            queueState = resetQueueState();
            notify();
        },

        stopGeneration(): void {
            queueState = pauseQueue(queueState);
            notify();

            if (!abortController) {
                return;
            }

            abortController.abort();
            abortController = undefined;
        },

        setAbortController(controller: AbortController | undefined): void {
            abortController = controller;
        }
    };
}
