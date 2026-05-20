import { type FileAttachment, type Message } from './types';
import { getTime, iconMarkup } from './strings';
import { splitFileReference } from './file-refs';
import { isEditableFilePath, resolveEditableWorkspacePath } from '../editableFiles';

export interface MessageRendererEls {
  chat: HTMLElement | null;
  input: HTMLTextAreaElement | null;
  editBanner: HTMLElement | null;
  editBannerLabel: HTMLElement | null;
}

export interface MessageRendererState {
  displayMessages: Message[];
  editingMessageIndex: number;
  workspaceFiles: Set<string>;
}

export interface MessageRendererDeps {
  els: MessageRendererEls;
  state: MessageRendererState;
  postMessage: (msg: any) => void;
  openImageLightbox: (src: string, alt: string) => void;
  replacePendingFiles: (files: FileAttachment[]) => void;
  renderPreview: () => void;
  fmt: (text: string) => string;
}

export function createMessageRenderer(deps: MessageRendererDeps) {
  const { els, state, postMessage, fmt } = deps;

  function setFeedbackState(actionBar: HTMLElement, feedback: 'like' | 'dislike' | null): void {
    const btns = actionBar.querySelectorAll('.feedback-btn');
    btns.forEach(function(btn) {
      if (!(btn instanceof HTMLElement)) return;
      const isUp = btn.title === 'Helpful';
      btn.classList.toggle('active', (isUp && feedback === 'like') || (!isUp && feedback === 'dislike'));
    });
  }

  function syncFeedbackAcrossCopies(messageIndex: number, feedback: 'like' | 'dislike' | null): void {
    const bars = document.querySelectorAll('.msg-actions[data-index="' + messageIndex + '"]');
    bars.forEach(function(bar) {
      setFeedbackState(bar as HTMLElement, feedback);
    });
    if (state.displayMessages[messageIndex]) {
      state.displayMessages[messageIndex].feedback = feedback;
    }
  }

  function renderMessageActions(message: Message, messageIndex: number, timestamp?: string): HTMLElement {
    const actionBar = document.createElement('div');
    actionBar.className = 'msg-actions';
    actionBar.dataset.index = String(messageIndex);

    const isUser = message.role === 'user';
    const timeLabel = document.createElement('span');
    timeLabel.className = 'msg-action-time';
    timeLabel.textContent = timestamp || getTime();

    if (isUser) {
      actionBar.appendChild(timeLabel);
    }

    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action-btn icon-only';
    copyBtn.title = isUser ? 'Copy message' : 'Copy markdown';
    copyBtn.setAttribute('aria-label', isUser ? 'Copy message' : 'Copy markdown');
    copyBtn.innerHTML = iconMarkup('copy');
    copyBtn.addEventListener('click', function() {
      navigator.clipboard.writeText(message.text || '').then(function() {
        copyBtn.classList.add('active');
        setTimeout(function() { copyBtn.classList.remove('active'); }, 1000);
      }).catch(function() {
        copyBtn.classList.remove('active');
      });
    });
    actionBar.appendChild(copyBtn);

    if (isUser) {
      const editBtn = document.createElement('button');
      editBtn.className = 'msg-action-btn icon-only';
      editBtn.title = 'Edit message';
      editBtn.setAttribute('aria-label', 'Edit message');
      editBtn.innerHTML = iconMarkup('edit');
      editBtn.addEventListener('click', function() {
        enterEditMode(messageIndex, message);
      });
      actionBar.appendChild(editBtn);
      return actionBar;
    }

    if (!isUser) {
      const upBtn = document.createElement('button');
      upBtn.className = 'msg-action-btn icon-only feedback-btn' + (message.feedback === 'like' ? ' active' : '');
      upBtn.title = 'Helpful';
      upBtn.setAttribute('aria-label', 'Helpful');
      upBtn.innerHTML = iconMarkup('up');
      upBtn.addEventListener('click', function() {
        const newVal = message.feedback === 'like' ? null : 'like';
        postMessage({ type: 'setMessageFeedback', messageIndex: messageIndex, feedback: newVal });
        setFeedbackState(actionBar, newVal);
        syncFeedbackAcrossCopies(messageIndex, newVal);
      });
      actionBar.appendChild(upBtn);

      const downBtn = document.createElement('button');
      downBtn.className = 'msg-action-btn icon-only feedback-btn' + (message.feedback === 'dislike' ? ' active' : '');
      downBtn.title = 'Not helpful';
      downBtn.setAttribute('aria-label', 'Not helpful');
      downBtn.innerHTML = iconMarkup('down');
      downBtn.addEventListener('click', function() {
        const newVal = message.feedback === 'dislike' ? null : 'dislike';
        postMessage({ type: 'setMessageFeedback', messageIndex: messageIndex, feedback: newVal });
        setFeedbackState(actionBar, newVal);
        syncFeedbackAcrossCopies(messageIndex, newVal);
      });
      actionBar.appendChild(downBtn);

      const branchBtn = document.createElement('button');
      branchBtn.className = 'msg-action-btn icon-only';
      branchBtn.title = 'Branch chat';
      branchBtn.setAttribute('aria-label', 'Branch chat');
      branchBtn.innerHTML = iconMarkup('branch');
      branchBtn.addEventListener('click', function() {
        postMessage({ type: 'branchChat', messageIndex: messageIndex });
        branchBtn.classList.add('active');
        setTimeout(function() { branchBtn.classList.remove('active'); }, 1000);
      });
      actionBar.appendChild(branchBtn);
      actionBar.appendChild(timeLabel);
    }

    return actionBar;
  }

  function enterEditMode(messageIndex: number, message: Message): void {
    if (!els.input || !message) return;
    state.editingMessageIndex = messageIndex;
    els.input.value = message.text || '';
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight, 150) + 'px';
    deps.replacePendingFiles(Array.from(message.files || []).map(function(file) {
      return {
        name: file.name,
        type: file.type,
        data: file.data,
        sourceUri: file.sourceUri,
        truncated: file.truncated,
        originalSize: file.originalSize
      };
    }));
    deps.renderPreview();
    if (els.editBanner) els.editBanner.hidden = false;
    if (els.editBannerLabel) els.editBannerLabel.textContent = 'Editing this message in a new branch';
    els.input.focus();
  }

  function exitEditMode(clearInput: boolean): void {
    state.editingMessageIndex = -1;
    if (els.editBanner) els.editBanner.hidden = true;
    if (clearInput && els.input) {
      els.input.value = '';
      els.input.style.height = 'auto';
    }
  }

  function openEditableFile(fileName: string, sourceUri: string, line?: number): void {
    const reference = splitFileReference(fileName);
    const safeName = String(reference.path || '').trim();
    const resolvedWorkspacePath = resolveEditableWorkspacePath(safeName, state.workspaceFiles);
    const isAbsoluteEditablePath = isEditableFilePath(safeName) && (safeName.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(safeName));
    if (!safeName || (!resolvedWorkspacePath && !isAbsoluteEditablePath && !sourceUri)) {
      return;
    }
    postMessage({
      type: 'openAttachment',
      file: {
        name: resolvedWorkspacePath || safeName,
        sourceUri: sourceUri || '',
        line: typeof line === 'number' ? line : reference.line
      }
    });
  }

  function rerenderDisplayedMessages(): void {
    if (!els.chat || state.displayMessages.length === 0) {
      return;
    }
    els.chat.innerHTML = '';
    state.displayMessages.forEach(function(message, index) {
      addMsg(message, message.role as 'user' | 'ai' | 'error', message.files, index);
    });
  }

  function renderAttachments(files: FileAttachment[]): HTMLElement | null {
    if (!files || files.length === 0) {
      return null;
    }
    const wrap = document.createElement('div');
    wrap.className = 'msg-attachments';
    files.forEach(function(file) {
      const item = document.createElement('div');
      item.className = 'msg-attachment';
      const editable = isEditableFilePath(file.name || '');
      if (editable) {
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        item.title = file.sourceUri ? 'Open ' + (file.name || 'attachment') : 'Find and open ' + (file.name || 'attachment');
        item.addEventListener('click', function() {
          openEditableFile(file.name || '', file.sourceUri || '');
        });
        item.addEventListener('keydown', function(event: KeyboardEvent) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openEditableFile(file.name || '', file.sourceUri || '');
          }
        });
      } else {
        item.title = file.name || 'attachment';
      }
      const isImage = file.type && file.type.startsWith('image/') && file.data;
      if (isImage) {
        const img = document.createElement('img');
        img.className = 'msg-attachment-img';
        img.src = 'data:' + file.type + ';base64,' + file.data;
        img.alt = file.name || 'attached image';
        img.title = 'Click to enlarge';
        img.addEventListener('click', function(event) {
          event.preventDefault();
          event.stopPropagation();
          deps.openImageLightbox(img.src, file.name || 'attached image');
        });
        item.appendChild(img);
      } else {
        const box = document.createElement('div');
        box.className = 'msg-attachment-file';
        const icon = document.createElement('span');
        icon.textContent = file.type && file.type.startsWith('audio/') ? '🎧' : '📄';
        const name = document.createElement('span');
        name.className = 'msg-attachment-name';
        name.textContent = file.name || 'attached file';
        box.appendChild(icon);
        box.appendChild(name);
        item.appendChild(box);
      }
      wrap.appendChild(item);
    });
    return wrap;
  }

  function addMsg(messageOrText: string | Message, role?: 'user' | 'ai' | 'error', files?: FileAttachment[], messageIndex?: number): HTMLElement {
    const message: Message = typeof messageOrText === 'object' && messageOrText !== null
      ? messageOrText as Message
      : { text: messageOrText as string, role: role || 'user', files: files, feedback: null };
    const resolvedRole = message.role || role;
    const resolvedFiles = message.files || files;
    const isUser = resolvedRole === 'user';
    const isErr = resolvedRole === 'error';
    const el = document.createElement('div');
    el.className = 'msg' + (isUser ? ' msg-user' : '') + (!isUser && !isErr ? ' msg-ai' : '') + (isErr ? ' msg-error' : '');
    const head = document.createElement('div');
    head.className = 'msg-head';
    if (isUser) {
      head.innerHTML = '<div class="av av-user">You</div><span>You</span>';
    } else {
      head.innerHTML = '<div class="av av-ai">LL</div><span>LLeM</span><span class="msg-time">' + getTime() + '</span>';
    }
    const body = document.createElement('div');
    body.className = 'msg-body';

    // Handle System Action Summaries
    if (!isUser && message.text && message.text.startsWith('[SYSTEM:')) {
      el.classList.add('msg-system');
      head.innerHTML = '<div class="av av-system" style="background: var(--panel-3); color: var(--accent-2);">⟡</div><span>System Action Summary</span>';

      const lines = message.text.split('\n');
      const contentWrap = document.createElement('div');
      contentWrap.className = 'summary-content-wrap';

      let currentSection: HTMLElement | null = null;

      lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed === '[SYSTEM: Action Results]') return;

        if (trimmed.endsWith(':')) {
          currentSection = document.createElement('div');
          currentSection.className = 'summary-section';
          const title = document.createElement('div');
          title.className = 'summary-title';
          title.textContent = trimmed;
          currentSection.appendChild(title);
          contentWrap.appendChild(currentSection);
        } else if (currentSection && (trimmed.startsWith('-') || trimmed.startsWith('*'))) {
          const item = document.createElement('div');
          item.className = 'summary-item';

          const icon = document.createElement('span');
          icon.className = 'summary-icon';
          const text = trimmed.replace(/^[-*]\s*/, '');
          const isIssue = /failed|error|issue|block|mismatch|filter/i.test(text);
          icon.textContent = isIssue ? '⚠️' : '✅';

          const content = document.createElement('span');
          content.className = 'summary-text' + (isIssue ? ' summary-issue' : ' summary-success');
          content.innerHTML = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

          item.appendChild(icon);
          item.appendChild(content);
          currentSection.appendChild(item);
        } else if (trimmed) {
          const p = document.createElement('p');
          p.style.fontSize = '11px';
          p.style.color = 'var(--text-faint)';
          p.style.marginTop = '4px';
          p.textContent = trimmed;
          if (currentSection) {
            currentSection.appendChild(p);
          } else {
            contentWrap.appendChild(p);
          }
        }
      });
      body.appendChild(contentWrap);
    } else {
      if (isUser) {
        body.innerText = message.text || '';
      } else {
        body.innerHTML = fmt(message.text || '');
      }
    }

    const attachments = renderAttachments(resolvedFiles || []);
    if (attachments) {
      body.appendChild(attachments);
    }
    el.appendChild(head);
    el.appendChild(body);
    if (typeof messageIndex === 'number' && messageIndex >= 0) {
      state.displayMessages[messageIndex] = message;
      const actions = renderMessageActions(message, messageIndex, getTime());
      el.appendChild(actions);
    }
    if (els.chat) {
      els.chat.appendChild(el);
      els.chat.scrollTop = els.chat.scrollHeight;
    }
    return el;
  }

  return {
    state,
    renderMessageActions,
    setFeedbackState,
    syncFeedbackAcrossCopies,
    enterEditMode,
    exitEditMode,
    openEditableFile,
    rerenderDisplayedMessages,
    renderAttachments,
    addMsg
  };
}
