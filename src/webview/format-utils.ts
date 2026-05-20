export function formatApproxKb(chars: number): string {
    if (!Number.isFinite(chars) || chars <= 0) {
        return '0 KB';
    }
    const kb = chars / 1024;
    return kb >= 10 ? `${kb.toFixed(1)} KB` : `${kb.toFixed(2)} KB`;
}

export function formatMs(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) {
        return '0 ms';
    }
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms.toFixed(1)} ms`;
}

export function countRole(messages: Array<{ role?: string }>, role: string): number {
    return messages.filter(message => message.role === role).length;
}
