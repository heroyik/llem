import { copyCode, copyMessageText } from './clipboard';

export interface EventDelegatesDeps {
  postMessage: (msg: any) => void;
  openTerminal: () => void;
  closeImageLightbox: () => void;
  openEditableFile: (fileName: string, sourceUri: string, line?: number) => void;
}

export function createEventDelegates(deps: EventDelegatesDeps): void {
  const { postMessage, openTerminal, closeImageLightbox, openEditableFile } = deps;

  document.addEventListener('click', function(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const copyButton = target.closest('[data-action="copy-code"]');
    if (copyButton instanceof HTMLElement) {
      copyCode(copyButton);
      return;
    }

    const cancelQueuedButton = target.closest('[data-action="cancel-queued-request"]');
    if (cancelQueuedButton instanceof HTMLElement) {
      const queueId = cancelQueuedButton.getAttribute('data-queue-id') || '';
      if (queueId) {
        postMessage({ type: 'cancelQueuedRequest', id: queueId });
      }
      return;
    }

    const editQueuedButton = target.closest('[data-action="edit-queued-request"]');
    if (editQueuedButton instanceof HTMLElement) {
      const queueId = editQueuedButton.getAttribute('data-queue-id') || '';
      if (queueId) {
        postMessage({ type: 'editQueuedRequest', id: queueId });
      }
      return;
    }

    if (target.closest('[data-action="clear-queued-requests"]')) {
      postMessage({ type: 'clearQueuedRequests' });
      return;
    }

    const moveQueuedButton = target.closest('[data-action="move-queued-request"]');
    if (moveQueuedButton instanceof HTMLElement) {
      const queueId = moveQueuedButton.getAttribute('data-queue-id') || '';
      const direction = moveQueuedButton.getAttribute('data-direction');
      if (queueId && (direction === 'up' || direction === 'down')) {
        postMessage({ type: 'moveQueuedRequest', id: queueId, direction: direction });
      }
      return;
    }

    if (target.closest('[data-action="resume-queue"]')) {
      postMessage({ type: 'resumeQueue' });
      return;
    }

    const messageActionBar = target.closest('.msg-actions');
    if (messageActionBar) {
      if (target.closest('[data-action="copy-message"]')) {
        const messageEl = target.closest('.msg') as HTMLElement;
        copyMessageText(messageEl);
        return;
      }
    }

    if (target.closest('[data-action="open-terminal"]')) {
      openTerminal();
      return;
    }

    if (target.closest('[data-action="review-changes"]')) {
      postMessage({ type: 'reviewChanges' });
      return;
    }

    const externalLink = target.closest('a[href]');
    if (externalLink instanceof HTMLAnchorElement && !externalLink.closest('[data-action="open-file"]')) {
      const href = externalLink.getAttribute('href') || '';
      if (href && href !== '#' && (/^https?:\/\//i.test(href) || /^mailto:/i.test(href))) {
        event.preventDefault();
        postMessage({ type: 'openExternalUrl', url: href });
        return;
      }
    }

    const openFileTrigger = target.closest('[data-action="open-file"]');
    if (openFileTrigger) {
      event.preventDefault();
      const line = Number(openFileTrigger.getAttribute('data-line') || '');
      openEditableFile(openFileTrigger.getAttribute('data-file-path') || '', '', Number.isFinite(line) ? line : undefined);
      return;
    }

    const inlineCode = target.closest('.msg-body :not(pre) > code.is-file');
    if (inlineCode) {
      const fileName = inlineCode.textContent?.trim() || '';
      openEditableFile(fileName, '');
    }
  });

  document.addEventListener('keydown', function(event: KeyboardEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;

    const openFileTrigger = target.closest('[data-action="open-file"]');
    if (openFileTrigger) {
      event.preventDefault();
      const line = Number(openFileTrigger.getAttribute('data-line') || '');
      openEditableFile(openFileTrigger.getAttribute('data-file-path') || '', '', Number.isFinite(line) ? line : undefined);
      return;
    }

    const externalLink = target.closest('a[href]');
    if (externalLink instanceof HTMLAnchorElement) {
      const href = externalLink.getAttribute('href') || '';
      if (href && href !== '#' && (/^https?:\/\//i.test(href) || /^mailto:/i.test(href))) {
        event.preventDefault();
        postMessage({ type: 'openExternalUrl', url: href });
      }
    }

    const closeImageTrigger = target.closest('[data-action="close-image-lightbox"]');
    if (closeImageTrigger) {
      event.preventDefault();
      closeImageLightbox();
      return;
    }
  });
}
