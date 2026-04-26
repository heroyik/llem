export interface PathAction {
    path: string;
    body: string;
}

export interface SimplePathAction {
    path: string;
}

export interface TextAction {
    text: string;
}

const PATH_ATTR = String.raw`(?:path|file|name)=['"]?([^'">]+)['"]?`;

export function stripWrappingFence(value: string): string {
    let content = value.trim();
    if (!content.startsWith('```')) {
        return content;
    }

    const lines = content.split('\n');
    if (lines[0].startsWith('```')) {
        lines.shift();
    }
    if (lines.length > 0 && lines[lines.length - 1].startsWith('```')) {
        lines.pop();
    }
    content = lines.join('\n').trim();
    return content;
}

export function parseCreateActions(message: string): PathAction[] {
    return parsePathBodyActions(message, new RegExp(String.raw`<(?:create_file|file)\s+${PATH_ATTR}[^>]*>([\s\S]*?)<\/(?:create_file|file)>`, 'gi'));
}

export function parseEditActions(message: string): PathAction[] {
    return parsePathBodyActions(message, new RegExp(String.raw`<(?:edit_file|edit)\s+${PATH_ATTR}[^>]*>([\s\S]*?)<\/(?:edit_file|edit)>`, 'gi'));
}

export function parseDeleteActions(message: string): SimplePathAction[] {
    return parseSimplePathActions(message, new RegExp(String.raw`<(?:delete_file|delete)\s+${PATH_ATTR}\s*\/?>(?:<\/(?:delete_file|delete)>)?`, 'gi'));
}

export function parseReadFileActions(message: string): SimplePathAction[] {
    return parseSimplePathActions(message, new RegExp(String.raw`<(?:read_file|read)\s+${PATH_ATTR}\s*\/?>(?:<\/(?:read_file|read)>)?`, 'gi'));
}

export function parseListActions(message: string): SimplePathAction[] {
    const regex = /<(?:list_files|list_dir|ls)\s+(?:path|dir|name)=['"]?([^'">]*)['"]?\s*\/?>(?:<\/(?:list_files|list_dir|ls)>)?/gi;
    return parseSimplePathActions(message, regex).map(action => ({
        path: action.path || '.'
    }));
}

export function parseCommandActions(message: string): TextAction[] {
    return parseTextActions(message, /<(?:run_command|command|bash|terminal)>([\s\S]*?)<\/(?:run_command|command|bash|terminal)>/gi)
        .map(action => ({ text: stripWrappingFence(action.text) }));
}

export function parseUrlActions(message: string): TextAction[] {
    return parseTextActions(message, /<(?:read_url|url|fetch_url)>([\s\S]*?)<\/(?:read_url|url|fetch_url)>/gi);
}

export function parseFallbackFileBlocks(message: string): PathAction[] {
    const regex = /```(?:[a-zA-Z]*)?\s*\n\/\/\s*(?:file|path):\s*([^\n]+)\n([\s\S]*?)```/gi;
    const actions: PathAction[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(message)) !== null) {
        actions.push({
            path: match[1].trim(),
            body: match[2].trim()
        });
    }

    return actions;
}

function parsePathBodyActions(message: string, regex: RegExp): PathAction[] {
    const actions: PathAction[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(message)) !== null) {
        actions.push({
            path: match[1].trim(),
            body: stripWrappingFence(match[2])
        });
    }

    return actions;
}

function parseSimplePathActions(message: string, regex: RegExp): SimplePathAction[] {
    const actions: SimplePathAction[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(message)) !== null) {
        actions.push({ path: match[1].trim() });
    }

    return actions;
}

function parseTextActions(message: string, regex: RegExp): TextAction[] {
    const actions: TextAction[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(message)) !== null) {
        actions.push({ text: match[1].trim() });
    }

    return actions;
}
