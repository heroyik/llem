import { normalizeExecutionMode, type ExecutionMode } from '../executionMode';
import type { FileAttachment, Message, McpServerListUiState } from './types';
import type { QueueStatePayload } from './queue-manager';
import type { StateStore } from './state-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HistoryItem {
  id: string;
  title: string;
  lastModified?: number;
}

interface QueueDraftPayload {
  kind: 'prompt' | 'promptWithFile' | 'editMessage' | 'regenerate';
  prompt: string;
  modelName: string;
  files: FileAttachment[];
  internetEnabled?: boolean;
  messageIndex?: number;
}

// ---------------------------------------------------------------------------
// Mutable state shared with the parent
// ---------------------------------------------------------------------------

export interface MessageHandlerState {
  displayMessages: Message[];
  editingMessageIndex: number;
  userMessageHistory: string[];
  historyIndex: number;
  draftBuffer: string;
  internetEnabled: boolean;
  historyItems: HistoryItem[];
  workspaceFiles: Set<string>;
  settingsData: any;
  mcpServersState: McpServerListUiState;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface MessageHandlerDeps {
  // Reactive state store
  store: StateStore<MessageHandlerState>;

  // DOM elements
  els: {
    modelSel: HTMLSelectElement | null;
    input: HTMLTextAreaElement | null;
    chat: HTMLElement | null;
    editBanner: HTMLElement | null;
    editBannerLabel: HTMLElement | null;
    internetBtn: HTMLElement | null;
  };

  // Modules
  streamHandler: {
    hideLoader(): void;
    setSending(v: boolean): void;
    startStream(): void;
    handleStreamChunk(chunk: string): void;
    setMcpToolStatus(msg: any): void;
    finalizeStream(status: string, message?: any, messageIndex?: number): void;
    resetStreamRefs(): void;
    showLoader(): void;
  };
  msgRenderer: {
    addMsg(messageOrText: string | Message, role?: 'user' | 'ai' | 'error', files?: FileAttachment[], messageIndex?: number): HTMLElement;
    exitEditMode(reset: boolean): void;
    rerenderDisplayedMessages(): void;
  };
  fileAttachment: {
    clearPendingFiles(): void;
    renderPreview(): void;
    replacePendingFiles(files: FileAttachment[]): void;
    appendAttachmentRecords(records: { name: string; type: string; data: string; originalSize: number }[]): void;
  };
  queueManager: {
    queueState: QueueStatePayload;
    renderQueuePanel(): void;
    lastQueuePaused: boolean;
  };
  settings: {
    renderSettingsMcpServers(state: McpServerListUiState): void;
    setSettingsMcpStatus(status: string): void;
    populateSettingsPanel(data: any): void;
  };
  history: {
    renderHistory(items: HistoryItem[]): void;
    showDeleteModal(id: string, title: string): void;
    showClearAllModal(): void;
  };

  // Local functions
  log: (message: any, level?: string) => void;
  send: () => void;
  welcomeMarkup: () => string;
  appendInfoMessage: (text: string) => void;
  setExecutionModeUi: (mode: ExecutionMode) => void;
  updateHistoryCounter: () => void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMessageHandler(deps: MessageHandlerDeps): (event: MessageEvent) => void {
  const { store, els, streamHandler, msgRenderer, fileAttachment, queueManager, settings, history, log, send, welcomeMarkup, appendInfoMessage, setExecutionModeUi, updateHistoryCounter } = deps;

  return function handleMessage(event: MessageEvent) {
    const msg = event.data;
    if (msg.type !== 'streamChunk') {
      log('[MSG←] ' + msg.type + (msg.id ? ' id=' + msg.id : '') + (msg.value && typeof msg.value === 'string' ? ' len=' + msg.value.length : ''));
    }
    switch (msg.type) {
      case 'response':
        streamHandler.hideLoader();
        streamHandler.setSending(false);
        log('[STREAM] Response received (len=' + (msg.value || '').length + ')');
        msgRenderer.addMsg(msg.message || { text: msg.value, role: 'ai', feedback: null }, 'ai', undefined, typeof msg.messageIndex === 'number' ? msg.messageIndex : -1);
        break;
      case 'error':
        log('[ERROR] Extension error: ' + msg.value, 'error');
        streamHandler.finalizeStream('stopped', undefined, -1);
        msgRenderer.addMsg({ text: msg.value, role: 'error', feedback: null }, 'error', undefined, -1);
        break;
      case 'streamStart':
        log('[STREAM] Stream started');
        streamHandler.startStream();
        break;

      case 'streamChunk':
        streamHandler.handleStreamChunk(msg.value || '');
        break;
      case 'mcpToolStatus':
        streamHandler.setMcpToolStatus(msg);
        break;
      case 'streamEnd':
        log('[STREAM] Stream ended');
        streamHandler.finalizeStream('done', msg.message || undefined, typeof msg.messageIndex === 'number' ? msg.messageIndex : -1);
        break;
      case 'stop':
        log('[MSG←] Stop signal received');
        streamHandler.finalizeStream('stopped', undefined, -1);
        break;
      case 'streamAbort':
        log('[STREAM] Stream aborted');
        streamHandler.finalizeStream('stopped', undefined, -1);
        break;
      case 'modelsList':
        if (els.modelSel) {
          els.modelSel.innerHTML = '';
          (msg.value as string[]).forEach(function(model: string) {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            els.modelSel!.appendChild(option);
          });
          if (msg.selectedModel) {
            if (!Array.from(els.modelSel.options).some(function(option: HTMLOptionElement) { return option.value === msg.selectedModel; })) {
              const option = document.createElement('option');
              option.value = msg.selectedModel;
              option.textContent = msg.selectedModel;
              els.modelSel!.appendChild(option);
            }
            els.modelSel.value = msg.selectedModel;
          }
        }
        log('[MODELS] Loaded ' + msg.value.length + ' model(s): ' + msg.value.join(', '));
        break;
      case 'executionMode':
        setExecutionModeUi(normalizeExecutionMode(msg.value));
        break;
      case 'clearChat':
        log('[RESET] clearChat received — resetting all UI state');
        streamHandler.resetStreamRefs();
        streamHandler.hideLoader();
        streamHandler.setSending(false);
        document.body.classList.add('init');
        if (els.chat) els.chat.innerHTML = welcomeMarkup();
        store.set('displayMessages', []);
        fileAttachment.clearPendingFiles();
        store.set('userMessageHistory', []);
        store.set('historyIndex', -1);
        store.set('draftBuffer', '');
        updateHistoryCounter();
        msgRenderer.exitEditMode(true);
        fileAttachment.renderPreview();
        queueManager.renderQueuePanel();
        if (els.input) {
          els.input.value = '';
          els.input.style.height = 'auto';
        }
        store.set('internetEnabled', false);
        if (els.internetBtn) {
          els.internetBtn.classList.remove('active');
          els.internetBtn.title = 'Live web: OFF';
        }
        log('[RESET] Chat UI fully reset — new thread ready');
        setTimeout(function() { if (els.input) els.input.focus(); }, 50);
        break;
      case 'restoreMessages':
        if (els.chat) els.chat.innerHTML = '';
        msgRenderer.exitEditMode(true);
        store.set('userMessageHistory', []);
        store.set('historyIndex', -1);
        store.set('draftBuffer', '');
        updateHistoryCounter();
        store.set('displayMessages', msg.value || []);
        if (msg.value && msg.value.length > 0) {
          log('[RESTORE] Restoring ' + msg.value.length + ' display message(s)');
          document.body.classList.remove('init');
          (msg.value as Message[]).forEach(function(item: Message, index: number) {
            msgRenderer.addMsg(item, item.role, item.files, index);
          });
        } else {
          log('[RESTORE] No messages to restore — showing welcome screen');
          document.body.classList.add('init');
          if (els.chat) els.chat.innerHTML = welcomeMarkup();
        }
        queueManager.renderQueuePanel();
        break;
      case 'focusInput':
        log('[UI] focusInput received');
        if (els.input) els.input.focus();
        break;
      case 'injectPrompt':
        log('[UI] injectPrompt received (len=' + (msg.value || '').length + ')');
        if (els.input) {
          els.input.value = msg.value;
          els.input.style.height = 'auto';
          els.input.style.height = Math.min(els.input.scrollHeight, 150) + 'px';
        }
        send();
        break;
      case 'editQueuedRequest': {
        const draft = (msg.value || {}) as QueueDraftPayload;
        if (els.input) {
          els.input.value = draft.prompt || '';
          els.input.style.height = 'auto';
          els.input.style.height = Math.min(els.input.scrollHeight, 150) + 'px';
        }
        fileAttachment.replacePendingFiles((draft.files || []).map(function(file: FileAttachment) { return { ...file }; }));
        fileAttachment.renderPreview();
        store.set('internetEnabled', Boolean(draft.internetEnabled));
        if (els.internetBtn) {
          els.internetBtn.classList.toggle('active', store.get('internetEnabled'));
          els.internetBtn.title = 'Live web: ' + (store.get('internetEnabled') ? 'ON' : 'OFF');
        }
        if (els.modelSel && draft.modelName) {
          if (!Array.from(els.modelSel.options).some(function(option: HTMLOptionElement) { return option.value === draft.modelName; })) {
            const option = document.createElement('option');
            option.value = draft.modelName;
            option.textContent = draft.modelName;
            els.modelSel!.appendChild(option);
          }
          els.modelSel.value = draft.modelName;
        }
        if (draft.kind === 'editMessage' && typeof draft.messageIndex === 'number' && draft.messageIndex >= 0) {
          store.set('editingMessageIndex', draft.messageIndex);
          if (els.editBanner) els.editBanner.hidden = false;
          if (els.editBannerLabel) els.editBannerLabel.textContent = 'Editing queued request from an earlier message';
        } else {
          msgRenderer.exitEditMode(false);
        }
        appendInfoMessage('✏️ Queued request moved back into the composer for editing.');
        setTimeout(function() { if (els.input) els.input.focus(); }, 50);
        break;
      }
      case 'queuedRequestStarting':
        document.body.classList.remove('init');
        if (els.chat && els.chat.querySelector('.welcome')) {
          els.chat.innerHTML = '';
        }
        msgRenderer.addMsg({
          text: msg.value?.prompt || '',
          role: 'user',
          files: msg.value?.files || [],
          feedback: null
        }, 'user', msg.value?.files || [],          store.get('displayMessages').length);
        streamHandler.showLoader();
        break;
      case 'historyList':
        store.set('historyItems', msg.value || []);
        log('[HISTORY] Received ' + store.get('historyItems').length + ' history item(s)');
        history.renderHistory(store.get('historyItems'));
        break;
      case 'requestDeleteHistory':
        log('[UI] requestDeleteHistory received for: ' + msg.id);
        history.showDeleteModal(msg.id, msg.title);
        break;
      case 'requestClearAllHistory':
        log('[UI] requestClearAllHistory received');
        history.showClearAllModal();
        break;
      case 'historyLoaded':
        log('[HISTORY] Session loaded: ' + msg.id);
        break;
      case 'queueState':
        queueManager.queueState = (msg.value || { running: false, paused: false, pendingRequests: [] }) as QueueStatePayload;
        streamHandler.setSending(Boolean(queueManager.queueState.running));
        queueManager.renderQueuePanel();
        if (queueManager.queueState.paused && !queueManager.lastQueuePaused) {
          const waiting = queueManager.queueState.pendingRequests.length;
          appendInfoMessage(waiting > 0
            ? '⏸ Generation stopped. The queue is paused with ' + waiting + ' waiting request' + (waiting === 1 ? '' : 's') + '.'
            : '⏸ Generation stopped. The queue is paused until you resume it.');
        } else if (!queueManager.queueState.paused && queueManager.lastQueuePaused) {
          appendInfoMessage(queueManager.queueState.running
            ? '▶ Queue resumed. Running the next request now.'
            : '▶ Queue resumed.');
        }
        queueManager.lastQueuePaused = queueManager.queueState.paused;
        break;
      case 'fetchedUris':
        log('[DROP] Fetched ' + (msg.files || []).length + ' URI attachment(s)');
        fileAttachment.appendAttachmentRecords(msg.files || []);
        break;
      case 'injectAttachment':
        fileAttachment.appendAttachmentRecords([msg.value]);
        break;
      case 'workspaceFilesList':
        const wf = store.get('workspaceFiles');
        wf.clear();
        if (msg.value) msg.value.forEach(function(f: string) { wf.add(f); });
        store.set('workspaceFiles', wf);
        log('[FILES] Synchronized ' + wf.size + ' workspace file path(s)');
        break;
      case 'mcpServersList':
        settings.renderSettingsMcpServers((msg.value || { mcpEnabled: true, servers: [] }) as McpServerListUiState);
        break;
      case 'mcpServersError':
        settings.setSettingsMcpStatus('Error: ' + (msg.value || 'Could not load MCP servers.'));
        break;
      case 'settingsData':
        store.set('settingsData', msg.value);
        settings.populateSettingsPanel(msg.value);
        break;
      default:
        log('[MSG←] Unhandled message type: ' + msg.type, 'error');
    }
  };
}
