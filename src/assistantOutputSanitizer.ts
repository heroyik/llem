const ACTION_BLOCK_PATTERN = /<(?:create_file|file|edit_file|edit|run_command|command|bash|terminal|read_url|url|fetch_url|read_brain|read_vault|call:[a-z_]+)\b[\s\S]*?<\/(?:create_file|file|edit_file|edit|run_command|command|bash|terminal|read_url|url|fetch_url|read_brain|read_vault|call:[a-z_]+)>/gi;
const SELF_CLOSING_ACTION_PATTERN = /<(?:delete_file|delete|read_file|read|list_files|list_dir|ls|call:delete_file|call:delete|call:read_file|call:read|call:list_files|call:list_dir|call:ls)\b[^>]*\/?>/gi;
const ACTION_TAG_FRAGMENT_PATTERN = /<\/?(?:create_file|file|edit_file|edit|delete_file|delete|read_file|read|list_files|list_dir|ls|run_command|command|bash|terminal|read_url|url|fetch_url|read_brain|read_vault|call:[a-z_]+)\b[^>]*>/gi;
const ACTION_HELPER_TAG_PATTERN = /<\/?(?:find|replace)\b[^>]*>/gi;
const DANGLING_OPEN_ACTION_PATTERN = /<(?:create_file|file|edit_file|edit|run_command|command|bash|terminal|read_url|url|fetch_url|read_brain|read_vault|call:[a-z_]+)\b[^>]*>[\s\S]*$/gi;
const SCRATCHPAD_LINE_PATTERN = /^\s*\(?\s*(?:wait(?:[,!]|)|let(?:'|’)?s)\s+.*(?:\brefine\b|\breplace block\b|\bclean pass\b|\bworks perfectly\b|\bdynamic mapping\b|\buser(?:'|’)?s environment\b|provided\s+\w+\s+structure|[a-z0-9_/.-]+\.(?:ts|tsx|js|jsx|py|java|go|rs|rb|php|cs|json|md))[\s\S]*\)?\s*$/i;

export function sanitizeAssistantOutput(text: string): string {
    if (!text) {
        return '';
    }

    let cleaned = String(text)
        .replace(ACTION_BLOCK_PATTERN, '')
        .replace(SELF_CLOSING_ACTION_PATTERN, '')
        .replace(ACTION_TAG_FRAGMENT_PATTERN, '')
        .replace(ACTION_HELPER_TAG_PATTERN, '')
        .replace(DANGLING_OPEN_ACTION_PATTERN, '');

    const lines = cleaned.split('\n');
    const filtered = lines.filter(line => !SCRATCHPAD_LINE_PATTERN.test(line.trim()));

    cleaned = filtered.join('\n');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    return cleaned.trim();
}
