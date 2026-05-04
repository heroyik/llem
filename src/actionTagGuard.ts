const ACTION_TAG_PATTERN = /<(?:create_file|file|edit_file|edit|delete_file|delete|read_file|read|list_files|list_dir|ls|run_command|command|bash|terminal|read_url|url|fetch_url|read_brain|read_vault)\b|<call:/i;

export function containsActionTags(text: string): boolean {
    return ACTION_TAG_PATTERN.test(String(text || ''));
}
