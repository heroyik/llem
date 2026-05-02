export function buildContinuationSystemMessage(internalSystemFeedback: string, externalReport: string[]): string {
    const parts: string[] = [];

    if (internalSystemFeedback.trim()) {
        parts.push(internalSystemFeedback.trim());
    }

    if (externalReport.length > 0) {
        parts.push(
            `[SYSTEM: External action results]\n${externalReport.join('\n')}\n\nContinue from the updated workspace state and answer the user's original request.`
        );
    }

    return parts.join('\n\n').trim();
}
