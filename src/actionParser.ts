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

export interface McpToolAction {
    server: string;
    tool: string;
    body: string;
}

export interface McpSlashCommandAction {
    command: string;
    body: string;
}

const PATH_ATTR = String.raw`(?:path|file|name)=['"“]?([^'">“”]+)['"”]?`;

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
    return parsePathBodyActions(message, new RegExp(String.raw`(?:<|call:)\s*(?:create_file|file)\s+${PATH_ATTR}[^>]*>([\s\S]*?)<\/(?:create_file|file)>`, 'gi'));
}

export function parseEditActions(message: string): PathAction[] {
    return parsePathBodyActions(message, new RegExp(String.raw`(?:<|call:)\s*(?:edit_file|edit)\s+${PATH_ATTR}[^>]*>([\s\S]*?)<\/(?:edit_file|edit)>`, 'gi'));
}

export function parseDeleteActions(message: string): SimplePathAction[] {
    return parseSimplePathActions(message, new RegExp(String.raw`(?:<|call:)\s*(?:delete_file|delete)\s+${PATH_ATTR}\s*\/?>(?:<\/(?:delete_file|delete)>)?`, 'gi'));
}

export function parseReadFileActions(message: string): SimplePathAction[] {
    return parseSimplePathActions(message, new RegExp(String.raw`(?:<|call:)\s*(?:read_file|read)\s+${PATH_ATTR}\s*\/?>(?:<\/(?:read_file|read)>)?`, 'gi'));
}

export function parseListActions(message: string): SimplePathAction[] {
    const regex = /(?:<|call:)\s*(?:list_files|list_dir|ls)\s+(?:path|dir|name)=['"“]?([^'">“”]*)['"”]?\s*\/?>(?:<\/(?:list_files|list_dir|ls)>)?/gi;
    return parseSimplePathActions(message, regex).map(action => ({
        path: action.path || '.'
    }));
}

export function parseCommandActions(message: string): TextAction[] {
    const bodyActions = parseTextActions(message, /(?:<|call:)\s*(?:run_command|command|bash|terminal)>([\s\S]*?)<\/(?:run_command|command|bash|terminal)>/gi)
        .map(action => ({ text: stripWrappingFence(action.text) }));

    const attrRegex = /(?:<|call:)\s*(?:run_command|command|bash|terminal)\s+(?:command|text|args)=['"“]?([^'">“”]+)['"”]?\s*\/?>(?:<\/(?:run_command|command|bash|terminal)>)?/gi;
    const attrActions: TextAction[] = [];
    let match: RegExpExecArray | null;
    while ((match = attrRegex.exec(message)) !== null) {
        attrActions.push({ text: match[1].trim() });
    }

    return [...bodyActions, ...attrActions];
}

export function parseUrlActions(message: string): TextAction[] {
    return parseTextActions(message, /(?:<|call:)\s*(?:read_url|url|fetch_url)>([\s\S]*?)<\/(?:read_url|url|fetch_url)>/gi);
}

export function parseListMcpToolsActions(message: string): TextAction[] {
    return [...String(message || '').matchAll(/(?:<|call:)\s*list_mcp_tools\s*\/?>(?:<\/list_mcp_tools>)?/gi)].map(() => ({ text: '' }));
}

export function parseCallMcpToolActions(message: string): McpToolAction[] {
    const regex = /(?:<|call:)\s*call_mcp_tool\s+[^>]*server=['"“]?([^'">“”\s]+)['"”]?[^>]*tool=['"“]?([^'">“”\s]+)['"”]?[^>]*>([\s\S]*?)<\/call_mcp_tool>/gi;
    const actions: McpToolAction[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(message)) !== null) {
        actions.push({ server: match[1].trim(), tool: match[2].trim(), body: stripWrappingFence(match[3]) });
    }
    return actions;
}

export function parseMcpSlashCommandActions(message: string): McpSlashCommandAction[] {
    const actions: McpSlashCommandAction[] = [];
    const regex = /(?:^|\n)[ \t]*\/([A-Za-z][A-Za-z0-9_-]*)(?:[ \t]+([^\n]*))?/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(String(message || ''))) !== null) {
        actions.push({
            command: match[1].trim(),
            body: String(match[2] || '').trim()
        });
    }

    return actions;
}

export function parseFallbackFileBlocks(message: string): PathAction[] {
    const actions: PathAction[] = [];
    const seen = new Set<string>();

    collectFallbackActions(message, /```(?:[a-zA-Z]*)?\s*\n\/\/\s*(?:file|path):\s*([^\n]+)\n([\s\S]*?)```/gi, actions, seen);
    collectFallbackActions(message, /```(?:[a-zA-Z0-9_-]+)?\s+(?:path|file)=["']?([^"'`\n]+)["']?\s*\n([\s\S]*?)```/gi, actions, seen);
    collectFallbackActions(message, /```((?:\.{0,2}\/)?[A-Za-z0-9_./-]+\.[A-Za-z0-9_-]+)\s*\n([\s\S]*?)```/gi, actions, seen);
    collectFallbackActions(message, /```(?:[a-zA-Z0-9_-]+)\s+((?:\.{0,2}\/)?[A-Za-z0-9_./-]+\.[A-Za-z0-9_-]+)\s*\n([\s\S]*?)```/gi, actions, seen);
    collectFallbackActions(message, /(?:^|\n)(?:#{1,6}\s*|(?:\*\*|`)?(?:file|path)\s*:\s*(?:\*\*|`)?)(`?((?:\.{0,2}\/)?[A-Za-z0-9_./-]+\.[A-Za-z0-9_-]+)`?)\s*\n```(?:[a-zA-Z0-9_-]*)?\s*\n([\s\S]*?)```/gi, actions, seen, { pathIndex: 2, bodyIndex: 3 });

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

function collectFallbackActions(
    message: string,
    regex: RegExp,
    actions: PathAction[],
    seen: Set<string>,
    options?: { pathIndex?: number; bodyIndex?: number }
): void {
    const pathIndex = options?.pathIndex ?? 1;
    const bodyIndex = options?.bodyIndex ?? 2;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(message)) !== null) {
        const path = String(match[pathIndex] || '').trim().replace(/^['"`]+|['"`]+$/g, '');
        const body = String(match[bodyIndex] || '').trim();
        if (!looksLikeWorkspaceFilePath(path) || !body) {
            continue;
        }

        const key = `${path}\n${body}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        actions.push({ path, body });
    }
}

function looksLikeWorkspaceFilePath(value: string): boolean {
    return /(?:^|\/)[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]+$/.test(value.trim());
}
