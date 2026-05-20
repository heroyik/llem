import { type FileAttachment } from './types';
import { isVsCodeDragType, getTransferTypes, getLowerTransferTypes } from './strings';
import { formatAttachmentBytes } from './format';
import { trimDroppedUri, looksLikeDroppedUri, attachmentFingerprint, acceptDropEvent } from './drag-drop';

export interface FileAttachmentEls {
  dropOverlay: HTMLElement | null;
  inputBox: HTMLElement | null;
  chat: HTMLElement | null;
  attachPreview: HTMLElement | null;
  fileInput: HTMLInputElement | null;
}

export interface FileAttachmentDeps {
  els: FileAttachmentEls;
  log: (message: any, level?: string) => void;
  postMessage: (msg: any) => void;
  openImageLightbox: (src: string, alt: string) => void;
}

export function createFileAttachment(deps: FileAttachmentDeps) {
  const { els, log, postMessage, openImageLightbox } = deps;

  const MAX_TEXT_ATTACHMENT_BYTES = 512 * 1024;
  const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
  const ATTACHABLE_EXTENSIONS = new Set([
    '.txt', '.md', '.csv', '.json',
    '.js', '.ts', '.html', '.css',
    '.py', '.java', '.rs', '.go',
    '.yaml', '.yml', '.xml', '.toml',
    '.c', '.cpp', '.h', '.hpp', '.cxx', '.cc', '.hh',
    '.rb', '.php', '.sh', '.bash', '.zsh', '.fish',
    '.swift', '.kt', '.kts',
    '.svelte', '.vue',
    '.jsx', '.tsx', '.mjs', '.cjs',
    '.scss', '.less', '.styl',
    '.sql', '.proto',
    '.gradle', '.cmake', '.makefile',
    '.dockerfile',
    '.env', '.gitignore', '.editorconfig', '.prettierrc', '.eslintrc',
    '.ps1', '.bat', '.cmd'
  ]);

  // Mutable state
  const _pendingFiles: FileAttachment[] = [];
  let _dragCounter = 0;
  let _dropSequence = 0;

  // ── State accessors ──

  function getPendingFiles(): FileAttachment[] {
    return _pendingFiles;
  }

  function clearPendingFiles(): void {
    _pendingFiles.length = 0;
  }

  function replacePendingFiles(files: FileAttachment[]): void {
    _pendingFiles.length = 0;
    files.forEach(function(f) { _pendingFiles.push(f); });
  }

  function getDragCounter(): number {
    return _dragCounter;
  }

  function setDragCounter(value: number): void {
    _dragCounter = value;
  }

  function getDropSequence(): number {
    return _dropSequence;
  }

  function setDropSequence(value: number): void {
    _dropSequence = value;
  }

  // ── Drag event helpers ──

  function describeDropEvent(event: DragEvent): string {
    const transfer = event.dataTransfer;
    const files = Array.from((transfer && transfer.files) || []);
    const items = Array.from((transfer && transfer.items) || []);
    return [
      'shift=' + Boolean(event.shiftKey),
      'types=' + getTransferTypes(transfer).join('|'),
      'files=' + files.map(function(file) { return file.name + ':' + file.size + ':' + (file.type || 'unknown'); }).join('|'),
      'items=' + items.map(function(item) { return item.kind + ':' + (item.type || 'unknown'); }).join('|')
    ].join(', ');
  }

  function canAcceptDropEvent(event: DragEvent): boolean {
    return Boolean(event && hasFilePayload(event));
  }

  function hasFilePayload(event: DragEvent): boolean {
    const transfer = event.dataTransfer;
    if (!transfer) {
      return false;
    }
    const types = getLowerTransferTypes(transfer);
    const items = Array.from(transfer.items || []);
    return types.includes('files') ||
           types.includes('text/uri-list') ||
           types.some(isVsCodeDragType) ||
           items.some(function(item) { return item.kind === 'file'; });
  }

  // ── Drop UI ──

  function setDropActive(active: boolean): void {
    if (els.dropOverlay) els.dropOverlay.classList.toggle('visible', active);
    if (els.inputBox) els.inputBox.classList.toggle('drag-over', active);
    if (els.chat) els.chat.classList.toggle('drag-over', active);
  }

  function resetDropActive(): void {
    setDropActive(false);
  }

  // ── URI collection ──

  function addDroppedUri(uris: string[], value: string): void {
    const candidate = trimDroppedUri(value);
    if (!candidate || candidate.startsWith('#') || !looksLikeDroppedUri(candidate)) {
      return;
    }
    if (!uris.includes(candidate)) {
      uris.push(candidate);
    }
  }

  function collectDroppedUrisFromText(text: string, uris: string[]): void {
    String(text || '')
      .split(/\r?\n|\r/)
      .map(trimDroppedUri)
      .filter(function(line) { return line.length > 0 && !line.startsWith('#'); })
      .forEach(function(line) { addDroppedUri(uris, line); });
  }

  function collectDroppedUrisFromObject(value: any, uris: string[]): void {
    if (!value) {
      return;
    }

    if (typeof value === 'string') {
      collectDroppedUrisFromText(value, uris);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(function(item) { collectDroppedUrisFromObject(item, uris); });
      return;
    }

    if (typeof value !== 'object') {
      return;
    }

    const directUriKeys = ['external', 'fsPath', 'uri', 'resourceUri', 'path'];
    directUriKeys.forEach(function(key) {
      if (typeof value[key] === 'string') {
        addDroppedUri(uris, value[key]);
      } else if (value[key]) {
        collectDroppedUrisFromObject(value[key], uris);
      }
    });

    if (typeof value.scheme === 'string' && typeof value.path === 'string') {
      if (value.scheme === 'file') {
        addDroppedUri(uris, 'file://' + value.path);
      } else if (value.scheme === 'vscode-remote') {
        const authority = value.authority ? '//' + value.authority : '';
        addDroppedUri(uris, 'vscode-remote:' + authority + value.path);
      }
    }

    Object.keys(value).forEach(function(key) {
      if (!directUriKeys.includes(key) && key !== 'scheme' && key !== 'authority') {
        collectDroppedUrisFromObject(value[key], uris);
      }
    });
  }

  function collectDroppedUris(transfer: DataTransfer | null): string[] {
    const uris: string[] = [];
    if (!transfer) {
      return uris;
    }

    const types = getTransferTypes(transfer);
    types.forEach(function(type) {
      const lowerType = String(type).toLowerCase();
      if (lowerType !== 'text/uri-list' &&
          lowerType !== 'text/plain' &&
          !isVsCodeDragType(lowerType)) {
        return;
      }

      const raw = transfer.getData(type);
      if (!raw) {
        return;
      }

      if (lowerType === 'text/plain' || lowerType === 'text/uri-list') {
        collectDroppedUrisFromText(raw, uris);
        return;
      }

      try {
        collectDroppedUrisFromObject(JSON.parse(raw), uris);
      } catch (_error) {
        collectDroppedUrisFromText(raw, uris);
      }
    });

    return uris;
  }

  // ── Attachment support ──

  function isSupportedAttachment(file: any): boolean {
    if (!file) {
      return false;
    }
    const type = file.type || '';
    if (type.startsWith('image/') || type.startsWith('audio/')) {
      return true;
    }
    const lowerName = (file.name || '').toLowerCase();
    const dotIndex = lowerName.lastIndexOf('.');
    return dotIndex >= 0 && ATTACHABLE_EXTENSIONS.has(lowerName.slice(dotIndex));
  }

  function readBlobAsDataUrl(blob: Blob): Promise<string> {
    return new Promise(function(resolve, reject) {
      const reader = new FileReader();
      reader.onerror = function() {
        reject(reader.error || new Error('Failed to read file.'));
      };
      reader.onload = function() {
        resolve(reader.result as string || '');
      };
      reader.readAsDataURL(blob);
    });
  }

  async function buildAttachment(file: File): Promise<FileAttachment | null> {
    if (!isSupportedAttachment(file)) {
      log('[DROP] Rejected unsupported attachment name=' + file.name + ', type=' + (file.type || 'unknown') + ', size=' + file.size, 'error');
      alert(file.name + ' is not a supported attachment yet.');
      return null;
    }

    const type = file.type || 'text/plain';
    const isImage = type.startsWith('image/');
    const limit = isImage ? MAX_IMAGE_ATTACHMENT_BYTES : MAX_TEXT_ATTACHMENT_BYTES;

    if (isImage && file.size > limit) {
      alert(file.name + ' is too big. Images can be up to ' + formatAttachmentBytes(limit) + '.');
      return null;
    }

    const blobSource = file.size > limit ? file.slice(0, limit) : file;
    const dataUrl = await readBlobAsDataUrl(blobSource);
    const base64 = String(dataUrl).split(',')[1] || '';
    log('[DROP] Built attachment name=' + file.name + ', type=' + type + ', originalBytes=' + file.size + ', encodedChars=' + base64.length + ', truncated=' + (file.size > limit));

    const attachment: FileAttachment = {
      name: file.name,
      type: type,
      data: base64,
      truncated: file.size > limit,
      originalSize: file.size
    };

    return attachment;
  }

  async function appendPendingFiles(files: File[], source: string, requestId: string): Promise<void> {
    const incoming = Array.from(files || []);
    log('[DROP] appendPendingFiles source=' + source + ', requestId=' + requestId + ', count=' + incoming.length + ', files=' + incoming.map(function(file) {
      return file.name + ':' + file.size + ':' + (file.type || 'unknown');
    }).join('|'));
    if (incoming.length === 0) {
      return;
    }

    const appended: FileAttachment[] = [];
    for (const file of incoming) {
      try {
        const attachment = await buildAttachment(file);
        if (attachment) {
          appended.push(attachment);
        }
      } catch (error: any) {
        console.error('LLeM Drag & Drop: Failed to read native file attachment.', {
          source: source,
          requestId: requestId,
          fileName: file && file.name,
          error: error && (error.stack || error.message || String(error))
        });
        alert('Could not read ' + file.name + '.');
      }
    }

    appendAttachmentRecords(appended);
    log('[DROP] appendPendingFiles complete requestId=' + requestId + ', appended=' + appended.length + ', pending=' + _pendingFiles.length);
  }

  function appendAttachmentRecords(files: FileAttachment[]): void {
    const incoming = Array.from(files || []);
    if (incoming.length === 0) {
      return;
    }

    const seen = new Set(_pendingFiles.map(attachmentFingerprint));
    const accepted: FileAttachment[] = [];

    incoming.forEach(function(file) {
      const key = attachmentFingerprint(file);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      _pendingFiles.push(file);
      accepted.push(file);
    });

    if (accepted.length > 0) {
      renderPreview();
    }
  }

  // ── Preview rendering ──

  function renderPreview(): void {
    const previewEl = els.attachPreview;
    if (!previewEl) return;
    previewEl.innerHTML = '';
    if (_pendingFiles.length === 0) {
      previewEl.classList.remove('visible');
      return;
    }
    previewEl.classList.add('visible');
    _pendingFiles.forEach(function(file, index) {
      const chip = document.createElement('div');
      chip.className = 'attach-chip';
      const isImage = file.type.startsWith('image/');
      if (isImage) {
        const thumb = document.createElement('img');
        thumb.className = 'attach-thumb';
        thumb.src = 'data:' + file.type + ';base64,' + file.data;
        thumb.alt = file.name || 'attached image';
        thumb.title = 'Click to enlarge';
        thumb.addEventListener('click', function(event) {
          event.preventDefault();
          event.stopPropagation();
          openImageLightbox(thumb.src, file.name || 'attached image');
        });
        chip.appendChild(thumb);
      } else {
        const icon = document.createElement('span');
        icon.textContent = file.type.startsWith('audio/') ? '🎧' : '📄';
        chip.appendChild(icon);
      }
      const name = document.createElement('span');
      name.className = 'chip-name';
      name.textContent = file.name + (file.truncated ? ' (partial)' : '');
      const remove = document.createElement('span');
      remove.className = 'chip-remove';
      remove.textContent = '✕';
      remove.addEventListener('click', function() {
        _pendingFiles.splice(index, 1);
        renderPreview();
      });
      chip.appendChild(name);
      chip.appendChild(remove);
      previewEl.appendChild(chip);
    });
  }

  // ── Public API ──

  return {
    // State accessors
    get pendingFiles() { return _pendingFiles; },
    clearPendingFiles,
    replacePendingFiles,
    get dragCounter() { return _dragCounter; },
    set dragCounter(value: number) { _dragCounter = value; },
    get dropSequence() { return _dropSequence; },
    set dropSequence(value: number) { _dropSequence = value; },
    // Drag event helpers
    describeDropEvent,
    canAcceptDropEvent,
    hasFilePayload,
    // Drop UI
    setDropActive,
    resetDropActive,
    // URI collection
    collectDroppedUris,
    // Attachment management
    isSupportedAttachment,
    appendAttachmentRecords,
    appendPendingFiles,
    // Preview
    renderPreview
  };
}
