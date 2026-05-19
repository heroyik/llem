export type StreamStopReason =
    | 'completed'
    | 'repetition_detected'
    | 'watchdog_loop'
    | 'manual_abort';

export interface StreamOutcome {
    text: string;
    stopReason: StreamStopReason;
    repeated: boolean;
    aborted: boolean;
    repeatedKind?: string;
    repeatedToken?: string;
    retryable?: boolean;
    cleanText?: string;
}

export function completedStreamOutcome(text: string): StreamOutcome {
    return {
        text,
        stopReason: 'completed',
        repeated: false,
        aborted: false
    };
}

export function interruptedStreamOutcome(
    text: string,
    stopReason: Exclude<StreamStopReason, 'completed'>,
    options: Pick<StreamOutcome, 'repeatedKind' | 'repeatedToken' | 'retryable' | 'cleanText'> = {}
): StreamOutcome {
    return {
        text,
        stopReason,
        repeated: stopReason === 'repetition_detected' || stopReason === 'watchdog_loop',
        aborted: true,
        ...options
    };
}

export function isLoopStopReason(stopReason: StreamStopReason): boolean {
    return stopReason === 'repetition_detected' || stopReason === 'watchdog_loop';
}
