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
    const stylesUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'assets', 'webview.css')
    );
    const mainScriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'assets', 'webview.js')
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
  <link nonce="${nonce}" rel="stylesheet" href="${stylesUri}">
</head>
<body class="init" data-version="${safeExtensionVersion}">
  <div class="header">
    <div class="header-left">
      <div class="logo">LL</div>
      <div class="brand-stack">
        <div class="brand-line"><span class="brand">LLeM</span><span class="version-badge">v${safeExtensionVersion}</span></div>
        <span class="subbrand">Local-first code sidekick</span>
      </div>
    </div>
    <div class="header-right">
      <select id="modelSel"></select>
      <button class="btn-icon" id="historyBtn" title="Chat history">🕒</button>
      <button class="btn-icon" id="internetBtn" title="Live web: OFF">🌐</button>
      <button class="btn-icon" id="brainBtn" title="Vault tools">⟡</button>
      <button class="btn-icon" id="settingsBtn" title="Tune LLeM">⚙</button>
      <button class="btn-icon" id="newChatBtn" title="New chat">+</button>
    </div>
  </div>
  <div class="thinking-bar" id="thinkingBar"></div>
  <div class="main-view" id="mainView">
    <div class="history-view" id="historyView">
      <div class="history-header">
        <div class="history-title">Chat History</div>
        <div class="history-actions">
          <button class="btn-new-chat" id="newChatHistoryBtn" title="New chat">New Chat</button>
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
        <div class="welcome-logo">LL</div>
        <div class="welcome-title">LLeM<span class="welcome-version">v${safeExtensionVersion}</span></div>
        <div class="welcome-sub">Local models. Repo context. Real edits. Real terminal moves. No cloud weirdness.</div>
      </div>
    </div>
    <div class="input-wrap">
      <div class="input-box" id="inputBox">
        <div class="attach-preview" id="attachPreview"></div>
        <textarea id="input" rows="1" placeholder="What are we building today?"></textarea>
        <div class="input-footer">
          <span class="input-hint">Enter sends · Shift+Enter adds a line · Drop files to attach</span>
          <div class="input-btns">
            <button class="attach-btn" id="attachBtn" title="Attach files">+</button>
            <button class="attach-btn" id="injectLocalBtn" title="Drop files into the vault">✦</button>
            <button class="stop-btn" id="stopBtn" title="Stop generating">■</button>
            <button class="send-btn" id="sendBtn" title="Send message">↑</button>
          </div>
        </div>
      </div>
      <input type="file" id="fileInput" multiple accept="image/*,audio/*,.txt,.md,.csv,.json,.js,.ts,.html,.css,.py,.java,.rs,.go,.yaml,.yml,.xml,.toml" hidden>
    </div>
  </div>

  <script nonce="${nonce}" src="${markdownItUri}"></script>
  <script nonce="${nonce}" src="${mainScriptUri}"></script>
</body>
</html>`;
}
