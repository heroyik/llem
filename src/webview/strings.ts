export function esc(value: string): string {
  const div = document.createElement('div');
  div.innerText = value;
  return div.innerHTML;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}

export function applyLiteralMarkdownFallback(html: string): string {
  const protectedBlocks: string[] = [];
  const protect = function(match: string): string {
    const token = '@@LLEM_HTML_' + protectedBlocks.length + '@@';
    protectedBlocks.push(match);
    return token;
  };

  let value = html.replace(/<pre\b[\s\S]*?<\/pre>/gi, protect)
    .replace(/<code\b[\s\S]*?<\/code>/gi, protect);

  value = value.split(/(<[^>]+>)/g).map(function(part) {
    if (!part || part.charAt(0) === '<') {
      return part;
    }

    return part
      .replace(/\*\*([^*\n](?:[\s\S]*?[^*\n])?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^\*])\*([^*\n](?:[\s\S]*?[^*\n])?)\*(?!\*)/g, '$1<em>$2</em>');
  }).join('');

  protectedBlocks.forEach(function(block, index) {
    value = value.split('@@LLEM_HTML_' + index + '@@').join(block);
  });
  return value;
}

export function iconMarkup(kind: string): string {
  if (kind === 'copy') return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
  if (kind === 'branch') return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 3a3 3 0 1 0 2.83 4H10a4 4 0 0 1 4 4v1.17A3 3 0 1 0 16 12V11a6 6 0 0 0-6-6H8.83A3 3 0 0 0 6 3zm0 14a3 3 0 1 0 2.83 4H10a6 6 0 0 0 6-6v-1.17A3 3 0 1 0 14 14v1a4 4 0 0 1-4 4H8.83A3 3 0 0 0 6 17zm10-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>';
  if (kind === 'edit') return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
  if (kind === 'up') return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>';
  if (kind === 'down') return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.37-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/></svg>';
  return '';
}

export function isVsCodeDragType(type: string): boolean {
  return String(type || '').toLowerCase().startsWith('application/vnd.code.');
}

export function getTransferTypes(transfer: DataTransfer | null): string[] {
  return Array.from((transfer && transfer.types) || []);
}

export function getLowerTransferTypes(transfer: DataTransfer | null): string[] {
  return getTransferTypes(transfer).map(function(type) {
    return String(type).toLowerCase();
  });
}

export function getTime(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
