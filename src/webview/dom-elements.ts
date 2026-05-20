// ---------------------------------------------------------------------------
// DOM element queries — extracted from main.ts
// ---------------------------------------------------------------------------

export interface DomElements {
  mainView: HTMLElement | null;
  chat: HTMLElement | null;
  input: HTMLTextAreaElement | null;
  inputSuggestEl: HTMLElement | null;
  sendBtn: HTMLElement | null;
  stopBtn: HTMLElement | null;
  modelSel: HTMLSelectElement | null;
  newChatHistoryBtn: HTMLElement | null;
  deleteModal: HTMLElement | null;
  deleteThreadTitle: HTMLElement | null;
  confirmDeleteBtn: HTMLElement | null;
  cancelDeleteBtn: HTMLElement | null;
  clearAllHistoryBtn: HTMLElement | null;
  brainBtn: HTMLElement | null;
  internetBtn: HTMLElement | null;
  historyBtn: HTMLElement | null;
  historyView: HTMLElement | null;
  closeHistoryBtn: HTMLElement | null;
  historySearch: HTMLInputElement | null;
  historyList: HTMLElement | null;
  attachBtn: HTMLElement | null;
  injectLocalBtn: HTMLElement | null;
  inputBox: HTMLElement | null;
  fileInput: HTMLInputElement | null;
  attachPreview: HTMLElement | null;
  queuePanel: HTMLElement | null;
  editBanner: HTMLElement | null;
  editBannerLabel: HTMLElement | null;
  cancelEditBtn: HTMLElement | null;
  dropOverlay: HTMLElement | null;
  thinkingBar: HTMLElement | null;
  settingsBtn: HTMLElement | null;
  modeSel: HTMLSelectElement | null;
  settingsModal: HTMLElement | null;
  closeSettingsBtn: HTMLElement | null;
  settingsEngineSel: HTMLSelectElement | null;
  settingsModelSel: HTMLSelectElement | null;
  settingsPerfSel: HTMLSelectElement | null;
  settingsPerfDesc: HTMLElement | null;
  settingsAdvancedToggle: HTMLElement | null;
  settingsAdvancedArrow: HTMLElement | null;
  settingsAdvancedBody: HTMLElement | null;
  settingsTemp: HTMLInputElement | null;
  settingsTempVal: HTMLElement | null;
  settingsTopP: HTMLInputElement | null;
  settingsTopPVal: HTMLElement | null;
  settingsTopK: HTMLInputElement | null;
  settingsTopKVal: HTMLElement | null;
  settingsRepeatPenalty: HTMLInputElement | null;
  settingsRepeatPenaltyVal: HTMLElement | null;
  settingsMaxTokens: HTMLInputElement | null;
  settingsMaxTokensVal: HTMLElement | null;
  settingsResetSamplingBtn: HTMLElement | null;
  settingsSystemPrompt: HTMLTextAreaElement | null;
  settingsResetPromptBtn: HTMLElement | null;
  settingsMcpGlobalToggle: HTMLInputElement | null;
  settingsRefreshMcpBtn: HTMLElement | null;
  settingsSyncMcpBtn: HTMLElement | null;
  settingsImportMcpBtn: HTMLElement | null;
  settingsMcpStatus: HTMLElement | null;
  settingsMcpServerList: HTMLElement | null;
}

export function getDomElements(): DomElements {
  return {
    mainView: document.getElementById('mainView'),
    chat: document.getElementById('chat'),
    input: document.getElementById('input') as HTMLTextAreaElement | null,
    inputSuggestEl: document.getElementById('inputSuggest'),
    sendBtn: document.getElementById('sendBtn'),
    stopBtn: document.getElementById('stopBtn'),
    modelSel: document.getElementById('modelSel') as HTMLSelectElement | null,
    newChatHistoryBtn: document.getElementById('newChatHistoryBtn'),
    deleteModal: document.getElementById('deleteModal'),
    deleteThreadTitle: document.getElementById('deleteThreadTitle'),
    confirmDeleteBtn: document.getElementById('confirmDeleteBtn'),
    cancelDeleteBtn: document.getElementById('cancelDeleteBtn'),
    clearAllHistoryBtn: document.getElementById('clearAllHistoryBtn'),
    brainBtn: document.getElementById('brainBtn'),
    internetBtn: document.getElementById('internetBtn'),
    historyBtn: document.getElementById('historyBtn'),
    historyView: document.getElementById('historyView'),
    closeHistoryBtn: document.getElementById('closeHistoryBtn'),
    historySearch: document.getElementById('historySearch') as HTMLInputElement | null,
    historyList: document.getElementById('historyList'),
    attachBtn: document.getElementById('attachBtn'),
    injectLocalBtn: document.getElementById('injectLocalBtn'),
    inputBox: document.getElementById('inputBox'),
    fileInput: document.getElementById('fileInput') as HTMLInputElement | null,
    attachPreview: document.getElementById('attachPreview'),
    queuePanel: document.getElementById('queuePanel'),
    editBanner: document.getElementById('editBanner'),
    editBannerLabel: document.getElementById('editBannerLabel'),
    cancelEditBtn: document.getElementById('cancelEditBtn'),
    dropOverlay: document.getElementById('dropOverlay'),
    thinkingBar: document.getElementById('thinkingBar'),
    settingsBtn: document.getElementById('settingsBtn'),
    modeSel: document.getElementById('modeSel') as HTMLSelectElement | null,
    settingsModal: document.getElementById('settingsModal'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    settingsEngineSel: document.getElementById('settingsEngineSel') as HTMLSelectElement | null,
    settingsModelSel: document.getElementById('settingsModelSel') as HTMLSelectElement | null,
    settingsPerfSel: document.getElementById('settingsPerfSel') as HTMLSelectElement | null,
    settingsPerfDesc: document.getElementById('settingsPerfDesc'),
    settingsAdvancedToggle: document.getElementById('settingsAdvancedToggle'),
    settingsAdvancedArrow: document.getElementById('settingsAdvancedArrow'),
    settingsAdvancedBody: document.getElementById('settingsAdvancedBody'),
    settingsTemp: document.getElementById('settingsTemp') as HTMLInputElement | null,
    settingsTempVal: document.getElementById('settingsTempVal'),
    settingsTopP: document.getElementById('settingsTopP') as HTMLInputElement | null,
    settingsTopPVal: document.getElementById('settingsTopPVal'),
    settingsTopK: document.getElementById('settingsTopK') as HTMLInputElement | null,
    settingsTopKVal: document.getElementById('settingsTopKVal'),
    settingsRepeatPenalty: document.getElementById('settingsRepeatPenalty') as HTMLInputElement | null,
    settingsRepeatPenaltyVal: document.getElementById('settingsRepeatPenaltyVal'),
    settingsMaxTokens: document.getElementById('settingsMaxTokens') as HTMLInputElement | null,
    settingsMaxTokensVal: document.getElementById('settingsMaxTokensVal'),
    settingsResetSamplingBtn: document.getElementById('settingsResetSamplingBtn'),
    settingsSystemPrompt: document.getElementById('settingsSystemPrompt') as HTMLTextAreaElement | null,
    settingsResetPromptBtn: document.getElementById('settingsResetPromptBtn'),
    settingsMcpGlobalToggle: document.getElementById('settingsMcpGlobalToggle') as HTMLInputElement | null,
    settingsRefreshMcpBtn: document.getElementById('settingsRefreshMcpBtn'),
    settingsSyncMcpBtn: document.getElementById('settingsSyncMcpBtn'),
    settingsImportMcpBtn: document.getElementById('settingsImportMcpBtn'),
    settingsMcpStatus: document.getElementById('settingsMcpStatus'),
    settingsMcpServerList: document.getElementById('settingsMcpServerList'),
  };
}
