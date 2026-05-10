export function buildContinuationSystemMessage(internalSystemFeedback: string, externalReport: string[]): string {
    const parts: string[] = [];

    if (internalSystemFeedback.trim()) {
        parts.push(internalSystemFeedback.trim());
    }

    if (externalReport.length > 0) {
        parts.push(
            `[Observation: Action Results]\n${externalReport.join('\n')}`
        );
    }

    if (parts.length > 0) {
        parts.push(
            "IMPORTANT: Use the observation above to continue and answer the user's request. DO NOT repeat your previous reasoning or re-emit the same action. If an action failed (Mismatch or Safety Block), DO NOT explain the failure to the user. Instead, perform a recovery action (e.g., <read_file>) or fix the match. Be concise and prioritize task completion."
        );
    }

    return parts.join('\n\n').trim();
}
