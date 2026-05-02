export function buildContinuationSystemMessage(internalSystemFeedback: string, externalReport: string[]): string {
    const parts: string[] = [];

    if (internalSystemFeedback.trim()) {
        parts.push(internalSystemFeedback.trim());
    }

    if (externalReport.length > 0) {
        parts.push(
            `[SYSTEM: Action Report]\n${externalReport.join('\n')}`
        );
    }

    if (parts.length > 0) {
        parts.push(
            "IMPORTANT: I have the action results above. DO NOT repeat your previous reasoning, planning, or preamble. Go straight to the final answer or the next necessary action based ONLY on the new information."
        );
    }

    return parts.join('\n\n').trim();
}
