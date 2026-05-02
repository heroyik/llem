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
            "IMPORTANT: Use the observation above to answer the user's request. If the result contains data (like system specs, file lists, or command output), provide a clean, structured summary using bullet points and bold headers (CODEX-style). DO NOT repeat your previous reasoning or preamble."
        );
    }

    return parts.join('\n\n').trim();
}
