import { resolveEditableWorkspacePath } from '../editableFiles';
import { smoothCollapseElement, smoothExpandElement } from './animations';
import { esc, iconMarkup, isVsCodeDragType, getTransferTypes, getLowerTransferTypes, getTime } from './strings';
import { formatElapsed, formatAttachmentBytes, langLabel, generateCompletionSummary, formatMcpToolLabel, mcpServerCommand } from './format';
import { normalizeExecutionMode, executionModeLabel, type ExecutionMode } from '../executionMode';

import { ACTION_HEADLINE_MAP, collectStreamActions, extractActionHeadline } from './stream-actions';
import { createSettings } from './settings';
import { createHistory } from './history';
import { createMessageRenderer } from './message-renderer';
import { createFileAttachment } from './file-attachment';
import { createStreamHandler } from './stream-handler';
import { createInputSuggest } from './input-suggest';
import { createQueueManager } from './queue-manager';
import { createImageLightbox } from './image-lightbox';
import { createMarkdownRenderer } from './markdown-renderer';
import { createTerminal } from './terminal';
import { createEventDelegates } from './event-delegates';
import { createDragHandlers } from './drag-handlers';
import type { Message, McpServerListUiState } from './types';
import { createMessageHandler } from './message-handler';
import type { MessageHandlerState, HistoryItem } from './message-handler';
import { createStateStore } from './state-store';
import { getDomElements } from './dom-elements';
import { registerEventHandlers } from './event-registrations';
import { setupErrorOverlays } from './error-overlay';
import { setupSliderDisplays } from './slider-setup';
import { renderFileChangesSummary } from './render-file-changes';

declare function acquireVsCodeApi(): {
  postMessage: (message: any) => void;
  getState: () => any;
  setState: (state: any) => void;
};



setupErrorOverlays();

try {
  const vscode = acquireVsCodeApi();
  function log(message: any, level: string = 'info') {
    vscode.postMessage({ type: 'log', value: message, level: level });
  }

  const {
    mainView, chat, input, inputSuggestEl, sendBtn, stopBtn, modelSel,
    newChatHistoryBtn, deleteModal, deleteThreadTitle, confirmDeleteBtn, cancelDeleteBtn,
    clearAllHistoryBtn, brainBtn, internetBtn, historyBtn, historyView, closeHistoryBtn,
    historySearch, historyList, attachBtn, injectLocalBtn, inputBox, fileInput,
    attachPreview, queuePanel, editBanner, editBannerLabel, cancelEditBtn, dropOverlay,
    thinkingBar, settingsBtn, modeSel,
    settingsModal, closeSettingsBtn,
    settingsEngineSel, settingsModelSel, settingsPerfSel, settingsPerfDesc,
    settingsAdvancedToggle, settingsAdvancedArrow, settingsAdvancedBody,
    settingsTemp, settingsTempVal, settingsTopP, settingsTopPVal,
    settingsTopK, settingsTopKVal, settingsRepeatPenalty, settingsRepeatPenaltyVal,
    settingsMaxTokens, settingsMaxTokensVal,
    settingsResetSamplingBtn, settingsSystemPrompt, settingsResetPromptBtn,
    settingsMcpGlobalToggle, settingsRefreshMcpBtn, settingsSyncMcpBtn,
    settingsImportMcpBtn, settingsMcpStatus, settingsMcpServerList
  } = getDomElements();
  const { openImageLightbox, closeImageLightbox } = createImageLightbox();

  let historyCounterEl: HTMLElement | null = null;
  let executionMode: ExecutionMode = 'default';

  const store = createStateStore<MessageHandlerState>({
    displayMessages: [] as Message[],
    editingMessageIndex: -1,
    userMessageHistory: [] as string[],
    historyIndex: -1,
    draftBuffer: '',
    internetEnabled: false,
    historyItems: [] as HistoryItem[],
    workspaceFiles: new Set<string>(),
    settingsData: null,
    mcpServersState: { mcpEnabled: true, servers: [] } as McpServerListUiState,
  });

  if (internetBtn) {
    log('[INIT] Syncing Live web mode icon (enabled=' + store.get('internetEnabled') + ')');
    internetBtn.classList.toggle('active', store.get('internetEnabled'));
    internetBtn.title = 'Live web: ' + (store.get('internetEnabled') ? 'ON' : 'OFF');
  }


  function setExecutionModeUi(mode: ExecutionMode) {
    executionMode = normalizeExecutionMode(mode);
    if (modeSel) {
      modeSel.value = executionMode;
      modeSel.title = executionModeLabel(executionMode);
      modeSel.dataset.mode = executionMode;
    }
  }

  setExecutionModeUi(executionMode);

  const { fmt } = createMarkdownRenderer({
    state: { workspaceFiles: store.get('workspaceFiles') },
    renderFileChangesSummary: function(payloadText: string) {
      return renderFileChangesSummary(payloadText, log);
    },
    log
  });

  const { openTerminal } = createTerminal(vscode.postMessage.bind(vscode));

  const settings = createSettings({
    els: {
      settingsModal, settingsEngineSel, settingsModelSel, settingsPerfSel, settingsPerfDesc,
      settingsTemp, settingsTempVal, settingsTopP, settingsTopPVal, settingsTopK, settingsTopKVal,
      settingsRepeatPenalty, settingsRepeatPenaltyVal, settingsMaxTokens, settingsMaxTokensVal,
      settingsSystemPrompt, settingsMcpGlobalToggle, settingsMcpServerList, settingsMcpStatus
    },
    postMessage: vscode.postMessage.bind(vscode),
    log,
    mcpServerCommand
  });

  const history = createHistory({
    els: { historyView, historyList, historySearch, deleteModal },
    postMessage: vscode.postMessage.bind(vscode),
    log
  });

  const fileAttachment = createFileAttachment({
    els: { dropOverlay, inputBox, chat, attachPreview, fileInput },
    log,
    postMessage: vscode.postMessage.bind(vscode),
    openImageLightbox
  });

  const msgRenderer = createMessageRenderer({
    els: { chat, input, editBanner, editBannerLabel },
    state: { displayMessages: store.get('displayMessages'), editingMessageIndex: store.get('editingMessageIndex'), workspaceFiles: store.get('workspaceFiles') },
    postMessage: vscode.postMessage.bind(vscode),
    openImageLightbox,
    replacePendingFiles: fileAttachment.replacePendingFiles,
    renderPreview: fileAttachment.renderPreview,
    fmt
  });

  // Subscribe modules to displayMessages changes to stay in sync
  store.subscribe('displayMessages', function(messages) {
    msgRenderer.state.displayMessages = messages;
    streamHandler.state.displayMessages = messages;
  });

  const streamHandler = createStreamHandler({
    els: { chat, thinkingBar, sendBtn, stopBtn, input },
    state: { displayMessages: store.get('displayMessages') },
    postMessage: vscode.postMessage.bind(vscode),
    log,
    getTime,
    fmt,
    openTerminal,
    renderMessageActions: msgRenderer.renderMessageActions
  });

  const inputSuggest = createInputSuggest({
    els: { inputSuggest: inputSuggestEl, input },
    state: { workspaceFiles: store.get('workspaceFiles') },
    postMessage: vscode.postMessage.bind(vscode)
  });

  // Subscribe to workspaceFiles changes to trigger re-renders
  store.subscribe('workspaceFiles', function() {
    inputSuggest.renderInputSuggest();
    msgRenderer.rerenderDisplayedMessages();
  });

  const queueManager = createQueueManager({
    els: { queuePanel },
    postMessage: vscode.postMessage.bind(vscode),
    log
  });

  createEventDelegates({
    postMessage: vscode.postMessage.bind(vscode),
    openTerminal,
    closeImageLightbox,
    openEditableFile: msgRenderer.openEditableFile
  });

  createDragHandlers({
    fileAttachment,
    log,
    postMessage: vscode.postMessage.bind(vscode)
  });

  const handleMessage = createMessageHandler({
    store,
    els: { modelSel, input, chat, editBanner, editBannerLabel, internetBtn },
    streamHandler,
    msgRenderer,
    fileAttachment,
    queueManager,
    settings,
    history,
    log,
    send,
    welcomeMarkup,
    appendInfoMessage,
    setExecutionModeUi,
    updateHistoryCounter
  });

  function appendInfoMessage(text: string): void {
    const info = document.createElement('div');
    info.className = 'msg';
    info.innerHTML = '<div class="msg-body msg-body-info">' + esc(text) + '</div>';
    if (chat) {
      chat.appendChild(info);
      chat.scrollTop = chat.scrollHeight;
    }
  }

      const extensionVersion = document.body.dataset.version || 'dev';
      function welcomeMarkup() {
        return '<div class="welcome"><div class="welcome-logo">LL</div><div class="welcome-title">LLeM<span class="welcome-version">v' + esc(extensionVersion) + '</span></div><div class="welcome-sub">Local models. Repo context. Real edits. Real terminal moves. No cloud weirdness.</div></div>';
      }






























  // History, internet, and other listeners are now handled below via safeListen.

  function send(): void {
    const text = input ? input.value.trim() : '';
    if (!text && fileAttachment.pendingFiles.length === 0) return;
    const attachedFiles = fileAttachment.pendingFiles.slice();
    const isQueued = streamHandler.sending;
    document.body.classList.remove('init');
    const welcome = document.querySelector('.welcome');
    if (welcome) welcome.remove();
    // Track sent message in history (skip edit-mode sends)
    if (store.get('editingMessageIndex') < 0 && text) {
      store.get('userMessageHistory').push(text);
      store.set('historyIndex', -1);
      store.set('draftBuffer', '');
      updateHistoryCounter();
    }
    if (store.get('editingMessageIndex') >= 0) {
      if (input) {
        input.value = '';
        input.style.height = 'auto';
      }
      if (!isQueued) {
        streamHandler.setSending(true);
        streamHandler.showLoader();
      }
      queueManager.postQueuedRequest({
        kind: 'editMessage',
        messageIndex: store.get('editingMessageIndex'),
        prompt: text || 'Update this message.',
        modelName: modelSel?.value || '',      files: attachedFiles,
      internetEnabled: store.get('internetEnabled')
      });
      fileAttachment.clearPendingFiles();
      fileAttachment.renderPreview();
      msgRenderer.exitEditMode(false);
      return;
    }
    if (!isQueued) {
      const localMessageIndex = store.get('displayMessages').length;
      msgRenderer.addMsg({ text: text, role: 'user', files: attachedFiles, feedback: null }, 'user', attachedFiles, localMessageIndex);
    }
    if (input) {
      input.value = '';
      input.style.height = 'auto';
    }
    if (!isQueued) {
      streamHandler.setSending(true);
      streamHandler.showLoader();
    }
    queueManager.postQueuedRequest({
      kind: attachedFiles.length > 0 ? 'promptWithFile' : 'prompt',
      prompt: attachedFiles.length > 0 ? (text || 'Take a look at these files.') : text,
      modelName: modelSel?.value || '',
      files: attachedFiles,
      internetEnabled: store.get('internetEnabled')
    });
    fileAttachment.clearPendingFiles();
    fileAttachment.renderPreview();
  }

  function navigateHistory(direction: number): void {
    if (!input) return;
    const userMessageHistory = store.get('userMessageHistory');
    if (userMessageHistory.length === 0) return;

    if (direction === -1) {
      // Arrow Up: go back in history
      if (store.get('historyIndex') === -1) {
        // Save current draft
        store.set('draftBuffer', input.value);
        store.set('historyIndex', userMessageHistory.length - 1);
      } else if (store.get('historyIndex') > 0) {
        store.set('historyIndex', store.get('historyIndex') - 1);
      } else {
        // Already at oldest message
        return;
      }
    } else {
      // Arrow Down: go forward in history
      if (store.get('historyIndex') === -1) return; // Already at draft
      if (store.get('historyIndex') >= userMessageHistory.length - 1) {
        // Restore draft buffer
        store.set('historyIndex', -1);
        input.value = store.get('draftBuffer');
        input.selectionStart = input.selectionEnd = input.value.length;
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 150) + 'px';
        updateHistoryCounter();
        return;
      }
      store.set('historyIndex', store.get('historyIndex') + 1);
    }

    if (store.get('historyIndex') >= 0 && store.get('historyIndex') < userMessageHistory.length) {
      input.value = userMessageHistory[store.get('historyIndex')];
      input.selectionStart = input.selectionEnd = input.value.length;
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 150) + 'px';
    }
    updateHistoryCounter();
  }

  function updateHistoryCounter(): void {
    if (!historyCounterEl) return;
    const hi = store.get('historyIndex');
    const hist = store.get('userMessageHistory');
    if (hi >= 0 && hi < hist.length) {
      historyCounterEl.textContent = '(' + (hi + 1) + '/' + hist.length + ')';
      historyCounterEl.style.display = '';
    } else {
      historyCounterEl.style.display = 'none';
    }
  }

  // Register all event listeners
  registerEventHandlers({
    els: {
      input, inputSuggestEl, sendBtn, stopBtn, modelSel,
      newChatHistoryBtn, confirmDeleteBtn, cancelDeleteBtn,
      settingsBtn, closeSettingsBtn, settingsModal,
      settingsAdvancedToggle, settingsAdvancedArrow, settingsAdvancedBody,
      settingsResetSamplingBtn, settingsSystemPrompt, settingsResetPromptBtn,
      settingsEngineSel, settingsModelSel, settingsPerfSel,
      settingsRefreshMcpBtn, settingsSyncMcpBtn, settingsImportMcpBtn,
      settingsMcpGlobalToggle,
      modeSel, brainBtn, internetBtn, historyBtn, historyView,
      closeHistoryBtn, clearAllHistoryBtn, injectLocalBtn, attachBtn,
      fileInput, cancelEditBtn, historySearch
    },
    postMessage: vscode.postMessage.bind(vscode),
    log,
    store,
    settings,
    history,
    fileAttachment,
    streamHandler,
    msgRenderer,
    inputSuggest,
    send,
    navigateHistory,
    appendInfoMessage,
    setExecutionModeUi
  });

  // Create history counter element
  if (input) {
    historyCounterEl = document.createElement('span');
    historyCounterEl.className = 'history-counter';
    historyCounterEl.style.display = 'none';
    const inputBtns = document.querySelector('.input-btns');
    if (inputBtns) {
      inputBtns.prepend(historyCounterEl);
    }
  }

  // Slider value display update
  setupSliderDisplays({
    settingsTemp, settingsTempVal, settingsTopP, settingsTopPVal,
    settingsTopK, settingsTopKVal, settingsRepeatPenalty, settingsRepeatPenaltyVal,
    settingsMaxTokens, settingsMaxTokensVal
  }, settings);


  window.addEventListener('message', handleMessage);

  log('[INIT] Webview loaded — requesting models, files and ready signal');
  vscode.postMessage({ type: 'getModels' });
  vscode.postMessage({ type: 'getWorkspaceFiles' });
  setTimeout(function() {
    log('[INIT] Posting ready signal to extension host');
    vscode.postMessage({ type: 'ready' });
  }, 300);
} catch (err: any) {
  document.body.textContent = '';
  const crash = document.createElement('div');
  crash.className = 'crash-screen';
  const title = document.createElement('h2');
  title.textContent = 'Webview JS crash';
  const pre = document.createElement('pre');
  pre.textContent = (err?.name || 'Error') + ': ' + (err?.message || String(err)) + '\n' + (err?.stack || '');
  crash.appendChild(title);
  crash.appendChild(pre);
  document.body.appendChild(crash);
}
