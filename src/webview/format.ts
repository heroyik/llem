export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, '0');
  return mins > 0 ? mins + ':' + secs : secs + 's';
}

export function formatAttachmentBytes(bytes: number): string {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / 1024 / 1024).toFixed(1) + 'MB';
}

export function fileNameFromPath(filePath: string): string {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || normalized || 'file';
}

export function langLabel(info: string): string {
  const raw = (info || '').trim().split(/\s+/)[0] || 'code';
  return raw.replace(/[{}()\[\]"'<>]/g, '') || 'code';
}


export function generateCompletionSummary(rawText: string): string {
  const createCount = (rawText.match(/<create_file/g) || []).length;
  const editCount = (rawText.match(/<edit_file/g) || []).length;
  const cmdCount = (rawText.match(/<run_command/g) || []).length;

  const parts: string[] = [];
  if (createCount > 0) parts.push(createCount + ' file' + (createCount > 1 ? 's' : '') + ' created');
  if (editCount > 0) parts.push(editCount + ' file' + (editCount > 1 ? 's' : '') + ' edited');
  if (cmdCount > 0) parts.push(cmdCount + ' command' + (cmdCount > 1 ? 's' : '') + ' run');

  return parts.length > 0 ? '✅ Completed (' + parts.join(', ') + ')' : '✅ Done';
}

export function formatMcpToolLabel(server: string, tool: string): string {
  return [server, tool].filter(Boolean).join(' · ') || 'MCP tool';
}

export function mcpServerCommand(server: { command?: string; args?: string[]; url?: string; transport?: string }): string {
  if (server.command) {
    return [server.command].concat(server.args || []).join(' ');
  }
  return server.url || server.transport || '';
}
