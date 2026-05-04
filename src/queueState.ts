import type { QueuedRequest } from './types';

export interface RequestQueueState {
    activeRequest?: QueuedRequest;
    pendingRequests: QueuedRequest[];
    paused: boolean;
}

export function createRequestQueueState(): RequestQueueState {
    return {
        activeRequest: undefined,
        pendingRequests: [],
        paused: false
    };
}

export function enqueueRequest(
    state: RequestQueueState,
    request: QueuedRequest
): RequestQueueState {
    const wasQueued = Boolean(state.activeRequest || state.pendingRequests.length > 0);
    return {
        ...state,
        pendingRequests: [...state.pendingRequests, { ...request, wasQueued }]
    };
}

export function promoteNextRequest(
    state: RequestQueueState
): { state: RequestQueueState; nextRequest?: QueuedRequest } {
    if (state.paused || state.activeRequest || state.pendingRequests.length === 0) {
        return { state };
    }

    const now = Date.now();
    // Find the first request that is either not scheduled or whose schedule has passed.
    const readyIndex = state.pendingRequests.findIndex(r => !r.scheduledAt || r.scheduledAt <= now);
    if (readyIndex < 0) {
        return { state };
    }

    const nextRequest = state.pendingRequests[readyIndex];
    const rest = [
        ...state.pendingRequests.slice(0, readyIndex),
        ...state.pendingRequests.slice(readyIndex + 1)
    ];

    return {
        nextRequest,
        state: {
            ...state,
            activeRequest: nextRequest,
            pendingRequests: rest
        }
    };
}

export function finishActiveRequest(state: RequestQueueState): RequestQueueState {
    return {
        ...state,
        activeRequest: undefined
    };
}

export function cancelPendingRequest(state: RequestQueueState, id: string): RequestQueueState {
    return {
        ...state,
        pendingRequests: state.pendingRequests.filter(request => request.id !== id)
    };
}

export function clearPendingRequests(state: RequestQueueState): RequestQueueState {
    return {
        ...state,
        pendingRequests: []
    };
}

export function movePendingRequest(
    state: RequestQueueState,
    id: string,
    direction: 'up' | 'down'
): RequestQueueState {
    const index = state.pendingRequests.findIndex(request => request.id === id);
    if (index < 0) {
        return state;
    }

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= state.pendingRequests.length) {
        return state;
    }

    const nextPending = [...state.pendingRequests];
    const [request] = nextPending.splice(index, 1);
    nextPending.splice(targetIndex, 0, request);

    return {
        ...state,
        pendingRequests: nextPending
    };
}

export function pauseQueue(state: RequestQueueState): RequestQueueState {
    return {
        ...state,
        paused: true
    };
}

export function resumeQueue(state: RequestQueueState): RequestQueueState {
    return {
        ...state,
        paused: false
    };
}

export function resetQueueState(): RequestQueueState {
    return createRequestQueueState();
}
