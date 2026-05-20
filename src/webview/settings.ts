import { type McpServerUiState, type McpServerListUiState } from './types';
import { mcpServerCommand } from './format';

export interface SettingsEls {
  settingsModal: HTMLElement | null;
  settingsEngineSel: HTMLSelectElement | null;
  settingsModelSel: HTMLSelectElement | null;
  settingsPerfSel: HTMLSelectElement | null;
  settingsPerfDesc: HTMLElement | null;
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
  settingsSystemPrompt: HTMLTextAreaElement | null;
  settingsMcpGlobalToggle: HTMLInputElement | null;
  settingsMcpServerList: HTMLElement | null;
  settingsMcpStatus: HTMLElement | null;
}

export interface SettingsDeps {
  els: SettingsEls;
  postMessage: (msg: any) => void;
  log: (message: any, level?: string) => void;
  mcpServerCommand: typeof mcpServerCommand;
}

export function createSettings(deps: SettingsDeps) {
  const { els, postMessage, log } = deps;

  function populateSettingsPanel(data: any): void {
    if (!data) return;
    if (els.settingsEngineSel && data.engines) {
      els.settingsEngineSel.innerHTML = '';
      data.engines.forEach(function(engine: string) {
        const opt = document.createElement('option');
        opt.value = engine;
        opt.textContent = engine;
        els.settingsEngineSel!.appendChild(opt);
      });
      if (data.activeEngine) els.settingsEngineSel.value = data.activeEngine;
    }
    if (els.settingsModelSel && data.models) {
      els.settingsModelSel.innerHTML = '';
      data.models.forEach(function(model: string) {
        const opt = document.createElement('option');
        opt.value = model;
        opt.textContent = model;
        els.settingsModelSel!.appendChild(opt);
      });
      if (data.activeModel) els.settingsModelSel.value = data.activeModel;
    }
    if (els.settingsPerfSel && data.performanceProfiles) {
      els.settingsPerfSel.innerHTML = '';
      data.performanceProfiles.forEach(function(profile: { id: string; label: string }) {
        const opt = document.createElement('option');
        opt.value = profile.id;
        opt.textContent = profile.label;
        els.settingsPerfSel!.appendChild(opt);
      });
      if (data.activePerformanceProfile) els.settingsPerfSel.value = data.activePerformanceProfile;
    }
    if (els.settingsPerfDesc && data.performanceProfileDescription) {
      els.settingsPerfDesc.textContent = data.performanceProfileDescription;
    }
    if (data.sampling) {
      const s = data.sampling;
      if (els.settingsTemp && typeof s.temperature === 'number') {
        els.settingsTemp.value = String(s.temperature);
        if (els.settingsTempVal) els.settingsTempVal.textContent = s.temperature.toFixed(2);
      }
      if (els.settingsTopP && typeof s.topP === 'number') {
        els.settingsTopP.value = String(s.topP);
        if (els.settingsTopPVal) els.settingsTopPVal.textContent = s.topP.toFixed(2);
      }
      if (els.settingsTopK && typeof s.topK === 'number') {
        els.settingsTopK.value = String(s.topK);
        if (els.settingsTopKVal) els.settingsTopKVal.textContent = String(s.topK);
      }
      if (els.settingsRepeatPenalty && typeof s.repeatPenalty === 'number') {
        els.settingsRepeatPenalty.value = String(s.repeatPenalty);
        if (els.settingsRepeatPenaltyVal) els.settingsRepeatPenaltyVal.textContent = s.repeatPenalty.toFixed(2);
      }
      if (els.settingsMaxTokens && typeof s.maxTokens === 'number') {
        els.settingsMaxTokens.value = String(s.maxTokens);
        if (els.settingsMaxTokensVal) els.settingsMaxTokensVal.textContent = String(s.maxTokens);
      }
    }
    if (els.settingsSystemPrompt && typeof data.systemPrompt === 'string') {
      els.settingsSystemPrompt.value = data.systemPrompt;
    }
    log('[UI] Settings panel populated from extension data');
  }

  function showSettingsModal(): void {
    if (!els.settingsModal) return;
    els.settingsModal.classList.add('visible');
    setSettingsMcpStatus('Loading MCP servers...');
    postMessage({ type: 'getMcpServers' });
    postMessage({ type: 'getSettingsData' });
  }

  function hideSettingsModal(): void {
    if (!els.settingsModal) return;
    els.settingsModal.classList.remove('visible');
  }

  function setSettingsMcpStatus(message: string): void {
    if (!els.settingsMcpStatus) return;
    els.settingsMcpStatus.textContent = message;
  }

  function renderSettingsMcpServers(state: McpServerListUiState): McpServerListUiState {
    const serversState = state || { mcpEnabled: true, servers: [] };
    if (els.settingsMcpGlobalToggle) {
      els.settingsMcpGlobalToggle.checked = Boolean(serversState.mcpEnabled);
    }
    if (!els.settingsMcpServerList) return serversState;
    els.settingsMcpServerList.innerHTML = '';
    const servers = serversState.servers || [];
    setSettingsMcpStatus(servers.length > 0
      ? servers.length + ' server' + (servers.length === 1 ? '' : 's') + ' found.'
      : 'No MCP servers configured.');
    servers.forEach(function(server) {
      const row = document.createElement('div');
      row.className = 'mcp-server-row' + (server.enabled ? '' : ' mcp-server-disabled') + (server.editable ? '' : ' mcp-server-readonly');

      const main = document.createElement('div');
      main.className = 'mcp-server-main';
      const title = document.createElement('div');
      title.className = 'mcp-server-title';
      title.textContent = server.name;
      const meta = document.createElement('div');
      meta.className = 'mcp-server-meta';
      meta.textContent = [
        server.sourceKind,
        server.transport,
        deps.mcpServerCommand(server)
      ].filter(Boolean).join(' · ');
      main.appendChild(title);
      main.appendChild(meta);
      if (server.disabledReason) {
        const reason = document.createElement('div');
        reason.className = 'mcp-server-reason';
        reason.textContent = server.disabledReason;
        main.appendChild(reason);
      }

      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'mcp-switch';
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = Boolean(server.enabled);
      toggle.disabled = !server.editable;
      toggle.addEventListener('change', function() {
        setSettingsMcpStatus((toggle.checked ? 'Enabling ' : 'Disabling ') + server.name + '...');
        postMessage({ type: 'setMcpServerEnabled', name: server.name, enabled: toggle.checked });
      });
      const visual = document.createElement('span');
      visual.className = 'mcp-switch-ui';
      toggleLabel.appendChild(toggle);
      toggleLabel.appendChild(visual);

      row.appendChild(main);
      row.appendChild(toggleLabel);
      els.settingsMcpServerList!.appendChild(row);
    });
    return serversState;
  }

  function updateSliderDisplay(input: HTMLInputElement | null, display: HTMLElement | null, decimals?: number): void {
    if (!input || !display) return;
    const val = parseFloat(input.value);
    display.textContent = decimals !== undefined ? val.toFixed(decimals) : String(val);
  }

  function onSliderChange(input: HTMLInputElement | null, display: HTMLElement | null, decimals?: number): void {
    if (!input || !display) return;
    input.addEventListener('input', function() {
      updateSliderDisplay(input, display, decimals);
    });
  }

  function postSliderValue(input: HTMLInputElement | null, key: string): void {
    if (!input) return;
    input.addEventListener('change', function() {
      const val = parseFloat(input.value);
      if (!isNaN(val)) {
        postMessage({ type: 'setSamplingParam', key: key, value: val });
        log('[UI] Sampling param changed: ' + key + ' = ' + val);
      }
    });
  }

  return {
    populateSettingsPanel,
    showSettingsModal,
    hideSettingsModal,
    setSettingsMcpStatus,
    renderSettingsMcpServers,
    updateSliderDisplay,
    onSliderChange,
    postSliderValue
  };
}
