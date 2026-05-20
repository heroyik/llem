export function trimDroppedUri(value: any): string {
  return String(value || '').trim().replace(/^["']|["']$/g, '');
}

export function looksLikeDroppedUri(value: string): boolean {
  const candidate = trimDroppedUri(value);
  return /^file:\/\//i.test(candidate) ||
         /^vscode-remote:\/\//i.test(candidate) ||
         /^[a-zA-Z]:[\\/]/.test(candidate) ||
         /^\\\\/.test(candidate) ||
         /^\//.test(candidate);
}

export function getAttachmentSize(file: any): number {
  if (!file) {
    return 0;
  }
  if (typeof file.originalSize === 'number') {
    return file.originalSize;
  }
  if (typeof file.size === 'number') {
    return file.size;
  }
  return 0;
}

export function attachmentFingerprint(file: any): string {
  const data = String((file && file.data) || '');
  return [
    String((file && file.name) || '').toLowerCase(),
    String((file && file.type) || '').toLowerCase(),
    String(getAttachmentSize(file)),
    file && file.truncated ? 'partial' : 'full',
    String(data.length),
    data.slice(0, 64),
    data.slice(-64)
  ].join('|');
}

export function acceptDropEvent(event: DragEvent): void {
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy';
  }
}
