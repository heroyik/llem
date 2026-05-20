import { fileNameFromPath } from './format';

export const ACTION_HEADLINE_MAP: Record<string, { icon: string; label: string }> = {
  create_file:   { icon: '📁', label: 'Creating' },
  edit_file:     { icon: '✏️', label: 'Editing' },
  run_command:   { icon: '▶',  label: 'Running command' },
  read_file:     { icon: '📖', label: 'Reading' },
  delete_file:   { icon: '🗑️', label: 'Deleting' },
  list_files:    { icon: '📁', label: 'Listing directory' },
  call_mcp_tool: { icon: '🔌', label: 'Calling MCP tool' },
  list_mcp_tools:{ icon: '🔌', label: 'Listing MCP tools' },
};

export interface StreamAction {
  type: string;
  path?: string;
}

export function collectStreamActions(text: string): StreamAction[] {
  const raw = text || '';
  const actions: StreamAction[] = [];

  const createMatches = raw.matchAll(/<(create_file)\s+path="([^"]*)"/gi);
  for (const m of createMatches) actions.push({ type: m[1], path: m[2] });

  const editMatches = raw.matchAll(/<(edit_file)\s+path="([^"]*)"/gi);
  for (const m of editMatches) actions.push({ type: m[1], path: m[2] });

  const cmdMatches = raw.matchAll(/<(run_command)\s*>/gi);
  for (const m of cmdMatches) actions.push({ type: m[1] });

  const readMatches = raw.matchAll(/<(read_file)\s+path="([^"]*)"/gi);
  for (const m of readMatches) actions.push({ type: m[1], path: m[2] });

  const deleteMatches = raw.matchAll(/<(delete_file)\s+path="([^"]*)"/gi);
  for (const m of deleteMatches) actions.push({ type: m[1], path: m[2] });

  const listMatches = raw.matchAll(/<(list_files)\s+path="([^"]*)"/gi);
  for (const m of listMatches) actions.push({ type: m[1], path: m[2] });

  const callMatches = raw.matchAll(/<(call_mcp_tool)\b/gi);
  for (const m of callMatches) actions.push({ type: m[1] });

  const listMcpMatches = raw.matchAll(/<(list_mcp_tools)\s*\/?>/gi);
  for (const m of listMcpMatches) actions.push({ type: m[1] });

  return actions;
}

export function extractActionHeadline(text: string): string | null {
  const actions = collectStreamActions(text);
  if (actions.length === 0) return null;

  const latest = actions[actions.length - 1];
  const entry = ACTION_HEADLINE_MAP[latest.type];
  if (!entry) return null;

  const fullPath = latest.path || '';
  const fileName = fullPath ? fileNameFromPath(fullPath) : '';
  return fileName ? `${entry.icon} ${entry.label} ${fileName}` : `${entry.icon} ${entry.label}`;
}
