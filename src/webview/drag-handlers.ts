import { acceptDropEvent } from './drag-drop';

export interface DragFileAttachment {
  canAcceptDropEvent(event: DragEvent): boolean;
  hasFilePayload(event: DragEvent): boolean;
  describeDropEvent(event: DragEvent): string;
  dragCounter: number;
  dropSequence: number;
  setDropActive(active: boolean): void;
  resetDropActive(): void;
  appendPendingFiles(files: File[], source: string, requestId: string): Promise<void>;
  collectDroppedUris(dataTransfer: DataTransfer | null): string[];
}

export interface DragHandlersDeps {
  fileAttachment: DragFileAttachment;
  log: (message: any, level?: string) => void;
  postMessage: (msg: any) => void;
}

export function createDragHandlers(deps: DragHandlersDeps): void {
  const { fileAttachment, log, postMessage } = deps;

  window.addEventListener('dragenter', function(event: DragEvent) {
    if (!fileAttachment.canAcceptDropEvent(event)) {
      if (fileAttachment.hasFilePayload(event)) {
        log('[DROP] dragenter ignored: ' + fileAttachment.describeDropEvent(event));
      }
      return;
    }
    log('[DROP] dragenter accepted: ' + fileAttachment.describeDropEvent(event));
    acceptDropEvent(event);
    fileAttachment.dragCounter = fileAttachment.dragCounter + 1;
    fileAttachment.setDropActive(true);
  }, true);

  window.addEventListener('dragover', function(event: DragEvent) {
    if (!fileAttachment.canAcceptDropEvent(event)) {
      if (fileAttachment.dragCounter > 0 && fileAttachment.hasFilePayload(event)) {
        log('[DROP] dragover became unacceptable: ' + fileAttachment.describeDropEvent(event));
        fileAttachment.dragCounter = 0;
        fileAttachment.resetDropActive();
      }
      return;
    }
    acceptDropEvent(event);
    if (fileAttachment.dragCounter <= 0) {
      fileAttachment.dragCounter = 1;
      fileAttachment.setDropActive(true);
    }
  }, true);

  window.addEventListener('dragleave', function(event: DragEvent) {
    if (fileAttachment.dragCounter <= 0) {
      return;
    }
    event.stopPropagation();
    fileAttachment.dragCounter = fileAttachment.dragCounter - 1;
    if (fileAttachment.dragCounter <= 0) {
      fileAttachment.dragCounter = 0;
      fileAttachment.resetDropActive();
    }
  }, true);

  window.addEventListener('drop', function(event: DragEvent) {
    if (!fileAttachment.canAcceptDropEvent(event)) {
      if (fileAttachment.hasFilePayload(event)) {
        log('[DROP] drop ignored: ' + fileAttachment.describeDropEvent(event));
      }
      if (fileAttachment.dragCounter > 0) {
        fileAttachment.dragCounter = 0;
        fileAttachment.resetDropActive();
      }
      return;
    }
    acceptDropEvent(event);
    fileAttachment.dropSequence = fileAttachment.dropSequence + 1;
    const requestId = 'drop-' + fileAttachment.dropSequence;
    fileAttachment.dragCounter = 0;
    fileAttachment.resetDropActive();
    log('[DROP] drop accepted requestId=' + requestId + ': ' + fileAttachment.describeDropEvent(event));

    const droppedFiles = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
    if (droppedFiles.length > 0) {
      void fileAttachment.appendPendingFiles(droppedFiles, 'native-drop', requestId);
    }

    const droppedUris = fileAttachment.collectDroppedUris(event.dataTransfer);
    log('[DROP] collected requestId=' + requestId + ', nativeFiles=' + droppedFiles.length + ', uris=' + droppedUris.length + (droppedUris.length ? ', uriList=' + droppedUris.join('|') : ''));
    if (droppedUris.length > 0) {
      postMessage({ type: 'fetchUris', requestId: requestId, uris: droppedUris });
    }
  }, true);
}
