import * as crypto from 'crypto';
import * as vscode from 'vscode';

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function getChatWebviewHtml(extensionUri: vscode.Uri, webview: vscode.Webview, extensionVersion: string): string {
    const markdownItUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'node_modules', 'markdown-it', 'dist', 'markdown-it.min.js')
    );
    const katexCssUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'node_modules', 'katex', 'dist', 'katex.min.css')
    );
    const texmathCssUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'node_modules', 'markdown-it-texmath', 'css', 'texmath.css')
    );
    const stylesUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'assets', 'webview.css')
    );
    const mainScriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'assets', 'webview.js')
    );
    const iconUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'assets', 'icon.png')
    );
    const nonce = crypto.randomBytes(16).toString('base64');
    const safeExtensionVersion = escapeHtml(extensionVersion || 'dev');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>LLeM</title>
  <link nonce="${nonce}" rel="stylesheet" href="${katexCssUri}">
  <link nonce="${nonce}" rel="stylesheet" href="${texmathCssUri}">
  <link nonce="${nonce}" rel="stylesheet" href="${stylesUri}">
</head>
<body class="init" data-version="${safeExtensionVersion}">
  <div class="header">
    <div class="header-left">
      <div class="logo"><img src="${iconUri}" alt="LLeM"></div>
      <div class="brand-stack">
        <div class="brand-line"><span class="brand">LLeM</span><span class="version-badge">v${safeExtensionVersion}</span></div>
        <span class="subbrand">Local-first code sidekick</span>
      </div>
    </div>
    <div class="header-right">
      <select id="modelSel"></select>
      <button class="btn-icon" id="historyBtn" title="Chat history">🕒</button>
      <button class="btn-icon" id="internetBtn" title="Live web: OFF">
        <svg class="icon-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="2" y1="12" x2="22" y2="12"></line>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
        </svg>
      </button>
      <button class="btn-icon" id="brainBtn" title="Vault tools">⟡</button>
      <button class="btn-icon" id="settingsBtn" title="Tune LLeM">⚙</button>
    </div>
  </div>
  <div class="thinking-bar" id="thinkingBar"></div>
  <div class="main-view" id="mainView">
    <div class="history-view" id="historyView">
      <div class="history-header">
        <div class="history-title">Chat History</div>
        <div class="history-actions">
          <button class="btn-new-chat" id="newChatHistoryBtn" title="New chat">New Chat</button>
          <button class="btn-clear-all" id="clearAllHistoryBtn" title="Clear all history">Clear All</button>
          <button class="btn-close" id="closeHistoryBtn" title="Close history">✕</button>
        </div>
      </div>
      <div class="history-search">
        <input type="text" id="historySearch" placeholder="Search threads...">
      </div>
      <div class="history-list" id="historyList"></div>
    </div>
    <div class="drop-overlay" id="dropOverlay">
      <div class="drop-card">
        <div class="drop-title">Drop files to attach</div>
        <div class="drop-sub">Images up to 8MB. Text and code files up to 512KB are added to the next message.</div>
      </div>
    </div>
    <div class="chat" id="chat">
      <div class="welcome">
        <div class="welcome-logo"><img src="${iconUri}" alt="LLeM"></div>
        <div class="welcome-title">LLeM<span class="welcome-version">v${safeExtensionVersion}</span></div>
        <div class="welcome-sub">Local models. Repo context. Real edits. Real terminal moves. No cloud weirdness.</div>
      </div>
    </div>
    <div class="input-wrap">
      <div class="input-box" id="inputBox">
        <div class="queue-panel" id="queuePanel" hidden></div>
        <div class="attach-preview" id="attachPreview"></div>
        <div class="edit-banner" id="editBanner" hidden>
          <span class="edit-banner-label" id="editBannerLabel">Editing this message in a new branch</span>
          <button class="edit-banner-cancel" id="cancelEditBtn" type="button">Cancel</button>
        </div>
        <div class="composer-surface">
          <textarea id="input" rows="1" placeholder="What are we building today?"></textarea>
          <div class="input-suggest" id="inputSuggest" hidden></div>
        </div>
        <div class="input-footer">
          <label class="mode-select-wrap" for="modeSel" title="Execution mode">
            <span class="mode-select-label">Mode</span>
            <select id="modeSel" aria-label="Execution mode">
              <option value="default">Default</option>
              <option value="plan">Plan</option>
              <option value="agent">Agent</option>
            </select>
          </label>
          <span class="input-hint">Enter sends · Shift+Enter adds a line · / commands · @ files</span>
          <div class="input-btns">
            <button class="attach-btn" id="attachBtn" title="Attach files, including images">📎</button>
            <button class="attach-btn" id="injectLocalBtn" title="Drop files into the vault">✦</button>
            <button class="stop-btn" id="stopBtn" title="Stop generating">■</button>
            <button class="send-btn" id="sendBtn" title="Send message">↑</button>
          </div>
        </div>
      </div>
      <input type="file" id="fileInput" multiple accept="image/*,audio/*,.txt,.md,.csv,.json,.js,.ts,.html,.css,.py,.java,.rs,.go,.yaml,.yml,.xml,.toml" hidden>
    </div>
  </div>

  <div id="deleteModal" class="modal-overlay">
    <div class="modal">
      <div class="modal-title">Delete Thread?</div>
      <div class="modal-body">
        Are you sure you want to delete "<span id="deleteThreadTitle"></span>"? This cannot be undone.
      </div>
      <div class="modal-footer">
        <button id="cancelDeleteBtn" class="btn-secondary">Cancel</button>
        <button id="confirmDeleteBtn" class="btn-danger">Delete Thread</button>
      </div>
    </div>
  </div>

  <div id="settingsModal" class="modal-overlay">
    <div class="modal settings-modal">
      <div class="settings-header">
        <div class="settings-title">Settings</div>
        <button id="closeSettingsBtn" class="settings-close-btn" type="button" title="Close settings">✕</button>
      </div>

      <div class="settings-scroll">
        <!-- Engine -->
        <div class="settings-section">
          <div class="settings-section-title"><span class="settings-label-icon">⚡</span> Engine</div>
          <div class="settings-field">
            <label class="settings-field-label" for="settingsEngineSel">Engine</label>
            <select id="settingsEngineSel" class="settings-select"></select>
          </div>
          <div class="settings-field">
            <label class="settings-field-label" for="settingsModelSel">Model</label>
            <select id="settingsModelSel" class="settings-select"></select>
          </div>
        </div>

        <!-- Performance -->
        <div class="settings-section">
          <div class="settings-section-title"><span class="settings-label-icon">🚀</span> Performance</div>
          <div class="settings-field">
            <label class="settings-field-label" for="settingsPerfSel">Profile</label>
            <select id="settingsPerfSel" class="settings-select">
              <option value="auto">auto</option>
              <option value="balanced">balanced</option>
              <option value="large-local-26b">large-local-26b</option>
            </select>
          </div>
          <div id="settingsPerfDesc" class="settings-field-desc">Recommended for most setups</div>
        </div>

        <!-- Advanced (collapsible) -->
        <div class="settings-section settings-advanced">
          <button id="settingsAdvancedToggle" class="settings-advanced-toggle" type="button">
            <span id="settingsAdvancedArrow" class="settings-arrow">▶</span>
            <span>Advanced</span>
          </button>

          <div id="settingsAdvancedBody" class="settings-advanced-body" hidden>
            <!-- Sampling -->
            <div class="settings-subsection">
              <div class="settings-section-title"><span class="settings-label-icon">🎛</span> Sampling</div>
              <div class="slider-row">
                <label class="slider-label">Temperature</label>
                <input type="range" id="settingsTemp" class="slider-input" min="0" max="2" step="0.01" value="0.7">
                <span id="settingsTempVal" class="slider-value">0.70</span>
              </div>
              <div class="slider-row">
                <label class="slider-label">Top P</label>
                <input type="range" id="settingsTopP" class="slider-input" min="0" max="1" step="0.01" value="0.9">
                <span id="settingsTopPVal" class="slider-value">0.90</span>
              </div>
              <div class="slider-row">
                <label class="slider-label">Top K</label>
                <input type="range" id="settingsTopK" class="slider-input" min="1" max="100" step="1" value="40">
                <span id="settingsTopKVal" class="slider-value">40</span>
              </div>
              <div class="slider-row">
                <label class="slider-label">Repeat Penalty</label>
                <input type="range" id="settingsRepeatPenalty" class="slider-input" min="0.8" max="2" step="0.01" value="1.1">
                <span id="settingsRepeatPenaltyVal" class="slider-value">1.10</span>
              </div>
              <div class="slider-row">
                <label class="slider-label">Max Tokens</label>
                <input type="range" id="settingsMaxTokens" class="slider-input" min="128" max="8192" step="128" value="2048">
                <span id="settingsMaxTokensVal" class="slider-value">2048</span>
              </div>
              <div class="settings-reset-row">
                <button id="settingsResetSamplingBtn" class="settings-reset-btn" type="button">Reset to defaults</button>
              </div>
            </div>

            <!-- System Prompt -->
            <div class="settings-subsection">
              <div class="settings-section-title"><span class="settings-label-icon">📝</span> System Prompt</div>
              <textarea id="settingsSystemPrompt" class="settings-textarea" rows="3" placeholder="System prompt for the AI..."></textarea>
              <div class="settings-reset-row">
                <button id="settingsResetPromptBtn" class="settings-reset-btn" type="button">Reset to default</button>
              </div>
            </div>

            <!-- MCP Servers -->
            <div class="settings-subsection">
              <div class="settings-section-title"><span class="settings-label-icon">🔌</span> MCP Servers</div>
              <div class="mcp-toolbar">
                <label class="mcp-global-toggle">
                  <input id="settingsMcpGlobalToggle" type="checkbox">
                  <span>MCP runtime</span>
                </label>
                <div class="mcp-toolbar-actions">
                  <button id="settingsRefreshMcpBtn" class="btn-secondary btn-compact" type="button">Refresh</button>
                  <button id="settingsSyncMcpBtn" class="btn-secondary btn-compact" type="button">Sync Codex</button>
                  <button id="settingsImportMcpBtn" class="btn-secondary btn-compact" type="button">Import</button>
                </div>
              </div>
              <div id="settingsMcpStatus" class="mcp-status"></div>
              <div id="settingsMcpServerList" class="mcp-server-list"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}" src="${markdownItUri}"></script>
  <script nonce="${nonce}" src="${mainScriptUri}"></script>
</body>
</html>`;
}
