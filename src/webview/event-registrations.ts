// ---------------------------------------------------------------------------
// Event listener registrations — extracted from main.ts
// ---------------------------------------------------------------------------

import { shouldSubmitOnEnter } from '../inputComposition';
import { normalizeExecutionMode, type ExecutionMode } from '../executionMode';
import type { HistoryItem, MessageHandlerState } from './message-handler';
import type { StateStore } from './state-store';
import type { FileAttachment } from './types';

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

export interface EventRegistrationDeps {
  // DOM elements
  els: {
    input: HTMLTextAreaElement | null;
    inputSuggestEl: HTMLElement | null;
    sendBtn: HTMLElement | null;
    stopBtn: HTMLElement | null;
    modelSel: HTMLSelectElement | null;
    newChatHistoryBtn: HTMLElement | null;
    confirmDeleteBtn: HTMLElement | null;
    cancelDeleteBtn: HTMLElement | null;
    settingsBtn: HTMLElement | null;
    closeSettingsBtn: HTMLElement | null;
    settingsModal: HTMLElement | null;
    settingsAdvancedToggle: HTMLElement | null;
    settingsAdvancedArrow: HTMLElement | null;
    settingsAdvancedBody: HTMLElement | null;
    settingsResetSamplingBtn: HTMLElement | null;
    settingsSystemPrompt: HTMLTextAreaElement | null;
    settingsResetPromptBtn: HTMLElement | null;
    settingsEngineSel: HTMLSelectElement | null;
    settingsModelSel: HTMLSelectElement | null;
    settingsPerfSel: HTMLSelectElement | null;
    settingsRefreshMcpBtn: HTMLElement | null;
    settingsSyncMcpBtn: HTMLElement | null;
    settingsImportMcpBtn: HTMLElement | null;
    settingsMcpGlobalToggle: HTMLInputElement | null;
    modeSel: HTMLSelectElement | null;
    brainBtn: HTMLElement | null;
    internetBtn: HTMLElement | null;
    historyBtn: HTMLElement | null;
    historyView: HTMLElement | null;
    closeHistoryBtn: HTMLElement | null;
    clearAllHistoryBtn: HTMLElement | null;
    injectLocalBtn: HTMLElement | null;
    attachBtn: HTMLElement | null;
    fileInput: HTMLInputElement | null;
    cancelEditBtn: HTMLElement | null;
    historySearch: HTMLInputElement | null;
  };

  // Communication
  postMessage: (msg: any) => void;
  log: (message: any, level?: string) => void;

  // Reactive store
  store: StateStore<MessageHandlerState>;

  // Modules
  settings: {
    showSettingsModal(): void;
    hideSettingsModal(): void;
    setSettingsMcpStatus(s: string): void;
  };
  history: {
    isBulkDelete: boolean;
    currentDeletingId: string | null;
    renderHistory(items: HistoryItem[]): void;
    hideDeleteModal(): void;
  };
  fileAttachment: {
    pendingFiles: FileAttachment[];
    appendPendingFiles(files: File[] | FileList, source: string, requestId: string): Promise<void>;
    appendAttachmentRecords(records: { name: string; type: string; data: string; originalSize: number }[]): void;
    clearPendingFiles(): void;
    renderPreview(): void;
  };
  streamHandler: {
    sending: boolean;
    hideLoader(): void;
    finalizeStream(status: string): void;
  };
  msgRenderer: {
    exitEditMode(reset: boolean): void;
  };
  inputSuggest: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    suggestItems: any[];
    suggestSelectedIndex: number;
    renderInputSuggest(): void;
    acceptInputSuggest(): void;
    hideInputSuggest(): void;
  };

  // Local functions
  send: () => void;
  navigateHistory: (direction: number) => void;
  appendInfoMessage: (text: string) => void;
  setExecutionModeUi: (mode: ExecutionMode) => void;
}

// ---------------------------------------------------------------------------
// Safe listener helper
// ---------------------------------------------------------------------------

function safeListen(idOrEl: string | HTMLElement | null, event: string, handler: (ev: any) => any): void {
  const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
  if (el) el.addEventListener(event, handler);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function registerEventHandlers(deps: EventRegistrationDeps): void {
  const {
    els, postMessage, log, store,
    settings, history, fileAttachment, streamHandler, msgRenderer, inputSuggest,
    send, navigateHistory, appendInfoMessage, setExecutionModeUi
  } = deps;

  let inputCompositionActive = false;

  // Input auto-height
  els.input?.addEventListener('input', function() {
    const el = els.input!;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
  });

  els.input?.addEventListener('compositionstart', function() {
    inputCompositionActive = true;
  });

  els.input?.addEventListener('compositionend', function() {
    inputCompositionActive = false;
  });

  els.input?.addEventListener('paste', function(event: ClipboardEvent) {
    const items = event.clipboardData && event.clipboardData.items;
    if (!items) return;
    const itemsArray = Array.from(items);
    for (const item of itemsArray) {
      if (!item.type.startsWith('image/')) continue;
      event.preventDefault();
      const file = item.getAsFile();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function() {
        const base64 = (reader.result as string).split(',')[1];
        fileAttachment.appendAttachmentRecords([{ name: 'clipboard-image.png', type: file.type, data: base64, originalSize: file.size }]);
      };
      reader.readAsDataURL(file);
      return;
    }
  });

  els.input?.addEventListener('input', function() {
    inputSuggest.renderInputSuggest();
  });

  els.input?.addEventListener('click', function() {
    inputSuggest.renderInputSuggest();
  });

  els.input?.addEventListener('blur', function() {
    window.setTimeout(inputSuggest.hideInputSuggest, 120);
  });

  // --- Button click / change handlers via safeListen ---

  safeListen(els.sendBtn, 'click', function() {
    log('[UI] Send button clicked (pendingFiles=' + fileAttachment.pendingFiles.length + ', sending=' + streamHandler.sending + ')');
    send();
  });

  safeListen(els.modelSel, 'change', function() {
    const nextModel = els.modelSel?.value || '';
    log('[MODELS] User selected model: ' + nextModel);
    postMessage({ type: 'setDefaultModel', model: nextModel });
  });

  safeListen(els.input, 'keydown', function(event) {
    const keyboardEvent = event as KeyboardEvent;
    const suggestEl = els.inputSuggestEl;
    if (suggestEl && !suggestEl.hidden && inputSuggest.suggestItems.length > 0) {
      if (keyboardEvent.key === 'ArrowDown') {
        event.preventDefault();
        inputSuggest.suggestSelectedIndex = (inputSuggest.suggestSelectedIndex + 1) % inputSuggest.suggestItems.length;
        inputSuggest.renderInputSuggest();
        return;
      }
      if (keyboardEvent.key === 'ArrowUp') {
        event.preventDefault();
        inputSuggest.suggestSelectedIndex = (inputSuggest.suggestSelectedIndex - 1 + inputSuggest.suggestItems.length) % inputSuggest.suggestItems.length;
        inputSuggest.renderInputSuggest();
        return;
      }
      if (keyboardEvent.key === 'Enter' || keyboardEvent.key === 'Tab') {
        event.preventDefault();
        inputSuggest.acceptInputSuggest();
        return;
      }
      if (keyboardEvent.key === 'Escape') {
        event.preventDefault();
        inputSuggest.hideInputSuggest();
        return;
      }
    }
    // Arrow Up: history navigation (only when cursor is at start or already in history)
    if (keyboardEvent.key === 'ArrowUp' && !inputCompositionActive && store.get('userMessageHistory').length > 0) {
      const isAtStart = (els.input?.selectionStart ?? 0) === 0;
      if (isAtStart || store.get('historyIndex') >= 0) {
        event.preventDefault();
        navigateHistory(-1);
        return;
      }
    }
    // Arrow Down: history navigation (only when already in history mode)
    if (keyboardEvent.key === 'ArrowDown' && !inputCompositionActive && store.get('historyIndex') >= 0) {
      event.preventDefault();
      navigateHistory(1);
      return;
    }
    // Prevent ArrowUp/ArrowDown from scrolling the page when nothing else handles them
    if ((keyboardEvent.key === 'ArrowUp' || keyboardEvent.key === 'ArrowDown') && !inputCompositionActive) {
      event.preventDefault();
      return;
    }
    if (!shouldSubmitOnEnter({
      key: keyboardEvent.key,
      shiftKey: keyboardEvent.shiftKey,
      isComposing: keyboardEvent.isComposing || inputCompositionActive,
      keyCode: keyboardEvent.keyCode
    })) return;
    event.preventDefault();
    log('[UI] Enter key pressed to send');
    send();
  });

  // --- History & UI handlers ---

  safeListen(els.newChatHistoryBtn, 'click', function() {
    log('[UI] New chat (from history) button clicked → posting newChat');
    postMessage({ type: 'newChat' });
    if (els.historyView) els.historyView.classList.remove('visible');
    if (els.input) els.input.focus();
  });

  safeListen(els.confirmDeleteBtn, 'click', function() {
    if (history.isBulkDelete) {
      log('[UI] Confirm clear all history clicked');
      postMessage({ type: 'deleteAllHistory' });
      store.set('historyItems', []);
      history.renderHistory(store.get('historyItems'));
      history.hideDeleteModal();
    } else if (history.currentDeletingId) {
      log('[UI] Confirm delete clicked for: ' + history.currentDeletingId);
      postMessage({ type: 'deleteHistory', id: history.currentDeletingId });
      store.set('historyItems', store.get('historyItems').filter(function(item: HistoryItem) { return item.id !== history.currentDeletingId; }));
      history.renderHistory(store.get('historyItems'));
      history.hideDeleteModal();
    }
  });

  safeListen(els.cancelDeleteBtn, 'click', function() {
    log('[UI] Cancel delete clicked');
    history.hideDeleteModal();
  });

  safeListen(els.settingsBtn, 'click', function() {
    log('[UI] Settings button clicked');
    settings.showSettingsModal();
  });

  safeListen(els.closeSettingsBtn, 'click', settings.hideSettingsModal);

  els.settingsModal?.addEventListener('click', function(event: MouseEvent) {
    if (event.target === els.settingsModal) {
      settings.hideSettingsModal();
    }
  });

  // Advanced collapse toggle
  safeListen(els.settingsAdvancedToggle, 'click', function() {
    if (!els.settingsAdvancedBody || !els.settingsAdvancedArrow) return;
    const isOpen = !els.settingsAdvancedBody.hidden;
    els.settingsAdvancedBody.hidden = isOpen;
    els.settingsAdvancedArrow.classList.toggle('open', !isOpen);
  });

  // Reset sampling params
  safeListen(els.settingsResetSamplingBtn, 'click', function() {
    postMessage({ type: 'resetRapidMlxParams' });
    log('[UI] Reset sampling parameters to defaults');
  });

  // System prompt change → post value to extension
  safeListen(els.settingsSystemPrompt, 'change', function() {
    const value = els.settingsSystemPrompt?.value || '';
    postMessage({ type: 'setSystemPrompt', value: value });
    log('[UI] System prompt updated, length=' + value.length);
  });

  // Reset system prompt
  safeListen(els.settingsResetPromptBtn, 'click', function() {
    postMessage({ type: 'resetSystemPrompt' });
    log('[UI] Reset system prompt to default');
  });

  // Engine select change
  safeListen(els.settingsEngineSel, 'change', function() {
    const nextEngine = els.settingsEngineSel?.value || '';
    log('[UI] Settings engine changed: ' + nextEngine);
    postMessage({ type: 'setEngine', engine: nextEngine });
  });

  // Model select change (settings)
  safeListen(els.settingsModelSel, 'change', function() {
    const nextModel = els.settingsModelSel?.value || '';
    log('[UI] Settings model changed: ' + nextModel);
    postMessage({ type: 'setDefaultModel', model: nextModel });
  });

  // Performance profile change
  safeListen(els.settingsPerfSel, 'change', function() {
    const nextProfile = els.settingsPerfSel?.value || '';
    log('[UI] Settings performance profile changed: ' + nextProfile);
    postMessage({ type: 'setPerformanceProfile', profile: nextProfile });
  });

  // MCP actions within settings
  safeListen(els.settingsRefreshMcpBtn, 'click', function() {
    settings.setSettingsMcpStatus('Refreshing MCP servers...');
    postMessage({ type: 'getMcpServers' });
  });
  safeListen(els.settingsSyncMcpBtn, 'click', function() {
    settings.setSettingsMcpStatus('Syncing Codex MCP servers...');
    postMessage({ type: 'syncCodexMcpServers' });
  });
  safeListen(els.settingsImportMcpBtn, 'click', function() {
    settings.setSettingsMcpStatus('Opening MCP import flow...');
    postMessage({ type: 'importMcpFromGitHub' });
  });
  safeListen(els.settingsMcpGlobalToggle, 'change', function() {
    const enabled = Boolean(els.settingsMcpGlobalToggle?.checked);
    settings.setSettingsMcpStatus((enabled ? 'Enabling' : 'Disabling') + ' MCP runtime...');
    postMessage({ type: 'setGlobalMcpEnabled', enabled: enabled });
  });

  safeListen(els.modeSel, 'change', function() {
    const nextMode = normalizeExecutionMode(els.modeSel?.value);
    log('[UI] Execution mode selected: ' + nextMode);
    setExecutionModeUi(nextMode);
    postMessage({ type: 'setExecutionMode', mode: nextMode });
  });

  safeListen(els.brainBtn, 'click', function() {
    log('[UI] Brain sync button clicked');
    postMessage({ type: 'syncBrain' });
  });

  safeListen(els.stopBtn, 'click', function() {
    log('[UI] Stop button clicked → posting stopGeneration');
    postMessage({ type: 'stopGeneration' });
    streamHandler.hideLoader();
    streamHandler.finalizeStream('stopped');
  });

  safeListen(els.internetBtn, 'click', function() {
    const nextEnabled = !store.get('internetEnabled');
    store.set('internetEnabled', nextEnabled);
    log('[UI] Live web mode toggled: ' + (nextEnabled ? 'ON' : 'OFF'));
    if (els.internetBtn) {
      els.internetBtn.classList.toggle('active', nextEnabled);
      els.internetBtn.title = 'Live web: ' + (nextEnabled ? 'ON' : 'OFF');
    }
    appendInfoMessage('🌐 Live web mode is now ' + (nextEnabled ? 'ON' : 'OFF') + '.');
  });

  safeListen(els.historyBtn, 'click', function() {
    const opening = els.historyView && !els.historyView.classList.contains('visible');
    log('[UI] History button clicked (opening=' + opening + ')');
    if (els.historyView) els.historyView.classList.toggle('visible');
    if (els.historyView && els.historyView.classList.contains('visible')) {
      postMessage({ type: 'getHistory' });
      if (els.historySearch) els.historySearch.focus();
    }
  });

  safeListen(els.closeHistoryBtn, 'click', function() {
    log('[UI] Close history button clicked');
    if (els.historyView) els.historyView.classList.remove('visible');
  });

  safeListen(els.clearAllHistoryBtn, 'click', function() {
    log('[UI] Clear all history button clicked');
    postMessage({ type: 'requestClearAllHistory' });
  });

  safeListen(els.injectLocalBtn, 'click', function() {
    if (fileAttachment.pendingFiles.length === 0) {
      alert('Attach files first, then drop them into the vault.');
      return;
    }
    log('[UI] Inject local brain clicked (files=' + fileAttachment.pendingFiles.length + ')');
    postMessage({ type: 'injectLocalBrain', files: fileAttachment.pendingFiles });
    fileAttachment.clearPendingFiles();
    fileAttachment.renderPreview();
  });

  safeListen(els.attachBtn, 'click', function() {
    log('[UI] Attach button clicked');
    if (els.fileInput) els.fileInput.click();
  });

  safeListen(els.fileInput, 'change', function() {
    if (!els.fileInput) return;
    const count = (els.fileInput.files || []).length;
    log('[DROP] ' + count + ' file(s) selected via native picker');
    void fileAttachment.appendPendingFiles(Array.from(els.fileInput.files || []), 'file-input', 'file-input-' + Date.now());
    els.fileInput.value = '';
  });

  safeListen(els.cancelEditBtn, 'click', function() {
    msgRenderer.exitEditMode(true);
    fileAttachment.clearPendingFiles();
    fileAttachment.renderPreview();
    if (els.input) els.input.focus();
  });

  safeListen(els.historySearch, 'input', function() {
    history.renderHistory(store.get('historyItems'));
  });
}
