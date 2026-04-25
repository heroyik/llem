import * as vscode from 'vscode';

export function getChatWebviewHtml(extensionUri: vscode.Uri, webview: vscode.Webview): string {
    const markdownItUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'node_modules', 'markdown-it', 'dist', 'markdown-it.min.js')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>LLeM</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #110f16;
      --bg-2: #18141f;
      --panel: rgba(27, 22, 35, 0.82);
      --panel-2: rgba(39, 31, 49, 0.72);
      --panel-3: rgba(54, 42, 68, 0.56);
      --border: rgba(255, 255, 255, 0.08);
      --border-strong: rgba(255, 255, 255, 0.14);
      --text: #f5efe8;
      --text-dim: #c1b4bf;
      --text-faint: #8f8493;
      --accent: #ff9e58;
      --accent-2: #68e1fd;
      --accent-3: #ff6f91;
      --accent-glow: rgba(255, 158, 88, 0.2);
      --accent-2-glow: rgba(104, 225, 253, 0.16);
      --danger: #ff6b7a;
      --ok: #8de09f;
      --code: #0f1116;
      --user: rgba(255, 255, 255, 0.05);
      --shadow: 0 18px 60px rgba(0, 0, 0, 0.34);
    }
    body.vscode-light {
      --bg: #fbf6ef;
      --bg-2: #fffaf4;
      --panel: rgba(255, 255, 255, 0.86);
      --panel-2: rgba(246, 239, 230, 0.92);
      --panel-3: rgba(239, 227, 213, 0.9);
      --border: rgba(67, 45, 29, 0.08);
      --border-strong: rgba(67, 45, 29, 0.14);
      --text: #2d2018;
      --text-dim: #6f5b50;
      --text-faint: #9f8d84;
      --accent-glow: rgba(255, 158, 88, 0.16);
      --accent-2-glow: rgba(104, 225, 253, 0.12);
      --danger: #e05162;
      --ok: #248f52;
      --code: #fff8f1;
      --user: rgba(67, 45, 29, 0.04);
      --shadow: 0 20px 50px rgba(81, 53, 29, 0.12);
    }
    html, body {
      height: 100%;
      font-family: 'SF Pro Display', 'Avenir Next', 'Segoe UI', sans-serif;
      font-size: 13px;
      background:
        radial-gradient(circle at top left, rgba(255, 111, 145, 0.12), transparent 34%),
        radial-gradient(circle at top right, rgba(104, 225, 253, 0.12), transparent 28%),
        linear-gradient(180deg, var(--bg-2), var(--bg));
      color: var(--text);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
    }
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background:
        radial-gradient(circle at 20% 18%, rgba(255, 158, 88, 0.08), transparent 30%),
        radial-gradient(circle at 80% 10%, rgba(104, 225, 253, 0.08), transparent 26%),
        radial-gradient(circle at 50% 90%, rgba(255, 111, 145, 0.08), transparent 25%);
      pointer-events: none;
      z-index: 0;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      background: rgba(18, 15, 24, 0.72);
      backdrop-filter: blur(18px);
      position: relative;
      z-index: 10;
      flex-shrink: 0;
    }
    .header::after {
      content: '';
      position: absolute;
      left: 14px;
      right: 14px;
      bottom: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, var(--accent), var(--accent-2), transparent);
      opacity: 0.65;
    }
    .header-left, .header-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .logo {
      width: 28px;
      height: 28px;
      border-radius: 9px;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, rgba(255, 158, 88, 0.2), rgba(104, 225, 253, 0.18));
      border: 1px solid rgba(255, 255, 255, 0.14);
      color: var(--text);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: -0.04em;
      box-shadow: inset 0 0 24px rgba(255, 255, 255, 0.04), 0 0 24px var(--accent-glow);
    }
    .brand {
      font-size: 15px;
      font-weight: 900;
      letter-spacing: -0.04em;
      color: var(--text);
    }
    .subbrand {
      font-size: 10px;
      color: var(--text-faint);
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }
    .brand-stack {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    select {
      max-width: 150px;
      background: var(--panel-2);
      color: var(--text);
      border: 1px solid var(--border-strong);
      padding: 6px 10px;
      border-radius: 10px;
      font-size: 11px;
      outline: none;
      cursor: pointer;
    }
    .btn-icon, .attach-btn, .send-btn, .stop-btn {
      border: 1px solid var(--border-strong);
      width: 30px;
      height: 30px;
      border-radius: 10px;
      display: grid;
      place-items: center;
      cursor: pointer;
      transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease, opacity .18s ease;
      background: var(--panel-2);
      color: var(--text-dim);
    }
    .btn-icon:hover, .attach-btn:hover, .send-btn:hover, .stop-btn:hover {
      transform: translateY(-1px);
      border-color: rgba(255, 255, 255, 0.22);
      box-shadow: 0 10px 26px rgba(0, 0, 0, 0.2);
      color: var(--text);
    }
    .send-btn {
      background: linear-gradient(135deg, var(--accent), var(--accent-3));
      color: #fff;
      border: none;
      box-shadow: 0 10px 24px rgba(255, 158, 88, 0.28);
    }
    .send-btn:disabled {
      opacity: 0.35;
      box-shadow: none;
      cursor: not-allowed;
      transform: none;
    }
    .stop-btn {
      display: none;
      background: rgba(255, 107, 122, 0.18);
      color: #fff;
      border-color: rgba(255, 107, 122, 0.35);
    }
    .stop-btn.visible {
      display: grid;
    }
    .thinking-bar {
      height: 2px;
      position: relative;
      overflow: hidden;
      flex-shrink: 0;
      z-index: 10;
    }
    .thinking-bar.active::after {
      content: '';
      position: absolute;
      top: 0;
      left: -40%;
      width: 40%;
      height: 100%;
      background: linear-gradient(90deg, transparent, var(--accent), var(--accent-2), transparent);
      animation: slideBar 1.3s linear infinite;
    }
    @keyframes slideBar {
      from { left: -40%; }
      to { left: 100%; }
    }
    .main-view {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
      position: relative;
      z-index: 1;
    }
    .chat {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 18px 14px 12px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .chat::-webkit-scrollbar {
      width: 6px;
    }
    .chat::-webkit-scrollbar-thumb {
      background: var(--panel-3);
      border-radius: 999px;
    }
    .chat.drag-over {
      background: linear-gradient(180deg, rgba(104, 225, 253, 0.04), transparent 28%);
    }
    .welcome {
      margin: auto;
      max-width: 560px;
      text-align: center;
      padding: 12px 20px 28px;
    }
    .welcome-logo {
      width: 66px;
      height: 66px;
      margin: 0 auto 18px;
      border-radius: 20px;
      display: grid;
      place-items: center;
      font-size: 20px;
      font-weight: 900;
      letter-spacing: -0.04em;
      color: var(--text);
      background: linear-gradient(135deg, rgba(255, 158, 88, 0.18), rgba(104, 225, 253, 0.16));
      border: 1px solid rgba(255, 255, 255, 0.14);
      box-shadow: var(--shadow);
    }
    .welcome-title {
      font-size: 28px;
      font-weight: 900;
      letter-spacing: -0.05em;
      margin-bottom: 8px;
    }
    .welcome-sub {
      color: var(--text-dim);
      line-height: 1.7;
      font-size: 13px;
      max-width: 440px;
      margin: 0 auto;
    }
    .msg {
      display: flex;
      flex-direction: column;
      gap: 6px;
      animation: msgIn .28s ease;
    }
    @keyframes msgIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .msg-head {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: var(--text-faint);
      padding-left: 2px;
    }
    .msg-time {
      margin-left: auto;
      font-size: 10px;
      color: var(--text-faint);
    }
    .av {
      width: 22px;
      height: 22px;
      border-radius: 8px;
      display: grid;
      place-items: center;
      flex-shrink: 0;
      font-size: 11px;
      font-weight: 800;
    }
    .av-user {
      background: var(--panel-2);
      border: 1px solid var(--border);
      color: var(--text);
    }
    .av-ai {
      background: linear-gradient(135deg, var(--accent), var(--accent-3));
      color: white;
      box-shadow: 0 10px 22px rgba(255, 111, 145, 0.18);
    }
    .msg-body {
      margin-left: 30px;
      line-height: 1.75;
      color: var(--text);
      word-break: break-word;
      white-space: normal;
    }
    .msg-user .msg-body {
      padding: 12px 14px;
      background: var(--user);
      border: 1px solid var(--border);
      border-radius: 16px;
      white-space: pre-wrap;
    }
    .msg-error .msg-body {
      color: #ffd9df;
    }
    .msg-body p {
      margin: 0 0 10px;
    }
    .msg-body p:last-child {
      margin-bottom: 0;
    }
    .msg-body h1, .msg-body h2, .msg-body h3, .msg-body h4, .msg-body h5, .msg-body h6 {
      margin: 16px 0 10px;
      line-height: 1.28;
      color: var(--text);
      letter-spacing: -0.03em;
    }
    .msg-body h1 { font-size: 21px; }
    .msg-body h2 { font-size: 18px; }
    .msg-body h3 { font-size: 16px; }
    .msg-body ul, .msg-body ol {
      margin: 8px 0 12px 22px;
    }
    .msg-body blockquote {
      border-left: 3px solid var(--accent);
      background: rgba(255, 158, 88, 0.08);
      padding: 10px 12px;
      border-radius: 0 12px 12px 0;
      margin: 10px 0;
    }
    .msg-body pre {
      background: var(--code);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 16px;
      overflow-x: auto;
      font-size: 12px;
      line-height: 1.6;
      margin: 10px 0;
    }
    .msg-body code {
      font-family: 'SF Mono', 'JetBrains Mono', 'Menlo', monospace;
      font-size: 11.5px;
    }
    .msg-body :not(pre) > code {
      background: rgba(255, 158, 88, 0.12);
      color: var(--accent);
      padding: 2px 7px;
      border-radius: 6px;
      border: 1px solid rgba(255, 158, 88, 0.16);
    }
    .msg-body table {
      width: 100%;
      display: block;
      overflow-x: auto;
      border-collapse: collapse;
      margin: 12px 0;
      border: 1px solid var(--border);
      border-radius: 12px;
    }
    .msg-body th, .msg-body td {
      border: 1px solid var(--border);
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
    }
    .msg-body th {
      background: rgba(255, 158, 88, 0.08);
    }
    .msg-body a {
      color: var(--accent-2);
      text-decoration: none;
    }
    .msg-body a:hover {
      text-decoration: underline;
    }
    .code-wrap {
      position: relative;
    }
    .code-lang {
      position: absolute;
      top: 0;
      left: 14px;
      padding: 3px 10px;
      border-radius: 0 0 8px 8px;
      background: linear-gradient(135deg, var(--accent), var(--accent-3));
      color: white;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
    }
    .copy-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      padding: 5px 10px;
      border-radius: 8px;
      border: 1px solid var(--border-strong);
      background: var(--panel-2);
      color: var(--text-dim);
      cursor: pointer;
      font-size: 10px;
      opacity: 0;
      transition: opacity .18s ease, color .18s ease, border-color .18s ease;
    }
    .code-wrap:hover .copy-btn {
      opacity: 1;
    }
    .copy-btn:hover {
      color: var(--text);
      border-color: rgba(255, 255, 255, 0.22);
    }
    .copy-btn.copied {
      opacity: 1;
      color: white;
      background: rgba(141, 224, 159, 0.18);
      border-color: rgba(141, 224, 159, 0.35);
    }
    .file-badge, .edit-badge, .cmd-badge {
      margin: 10px 0;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--panel);
      backdrop-filter: blur(10px);
    }
    .file-badge, .edit-badge {
      padding: 10px 14px;
      font-weight: 700;
      font-size: 11px;
      color: var(--text);
    }
    .file-badge {
      border-color: rgba(104, 225, 253, 0.2);
    }
    .edit-badge {
      border-color: rgba(255, 158, 88, 0.2);
    }
    .cmd-badge {
      padding: 12px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-family: 'SF Mono', 'Menlo', monospace;
      color: var(--accent-2);
    }
    .btn-open {
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      background: var(--panel-2);
      color: var(--text-dim);
      padding: 4px 8px;
      font-size: 10px;
      cursor: pointer;
    }
    .btn-open:hover {
      color: var(--text);
    }
    .msg-attachments {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
      gap: 8px;
      margin-top: 10px;
      max-width: 420px;
    }
    .msg-attachment {
      overflow: hidden;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: var(--panel-2);
    }
    .msg-attachment-img {
      display: block;
      width: 100%;
      aspect-ratio: 1.35;
      object-fit: cover;
    }
    .msg-attachment-file {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 8px 10px;
      color: var(--text-dim);
      font-size: 11px;
      min-width: 0;
    }
    .msg-attachment-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .input-wrap {
      padding: 10px 14px 16px;
      flex-shrink: 0;
      position: relative;
      z-index: 2;
    }
    .input-box {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 12px;
      backdrop-filter: blur(16px);
      box-shadow: var(--shadow);
    }
    .input-box:focus-within {
      border-color: rgba(255, 255, 255, 0.18);
      box-shadow: var(--shadow), 0 0 0 1px rgba(255, 158, 88, 0.12);
    }
    .input-box.drag-over {
      border-color: rgba(104, 225, 253, 0.45);
      box-shadow: var(--shadow), 0 0 0 1px rgba(104, 225, 253, 0.2), 0 0 0 10px rgba(104, 225, 253, 0.06);
    }
    textarea {
      width: 100%;
      border: none;
      resize: none;
      outline: none;
      min-height: 24px;
      max-height: 150px;
      background: transparent;
      color: var(--text);
      font-family: inherit;
      font-size: 13px;
      line-height: 1.6;
    }
    textarea::placeholder {
      color: var(--text-faint);
    }
    .attach-preview {
      display: none;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }
    .attach-preview.visible {
      display: flex;
    }
    .attach-chip {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--panel-2);
      color: var(--text-dim);
      font-size: 10px;
      min-width: 0;
    }
    .attach-thumb {
      width: 24px;
      height: 24px;
      border-radius: 7px;
      object-fit: cover;
      border: 1px solid var(--border);
    }
    .chip-name {
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chip-remove {
      cursor: pointer;
      color: var(--text-faint);
    }
    .chip-remove:hover {
      color: var(--danger);
    }
    .input-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-top: 10px;
    }
    .input-hint {
      font-size: 10px;
      color: var(--text-faint);
    }
    .input-btns {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .drop-overlay {
      position: absolute;
      inset: 10px 14px 16px;
      border-radius: 24px;
      border: 1px dashed rgba(104, 225, 253, 0.45);
      background:
        linear-gradient(180deg, rgba(17, 15, 22, 0.82), rgba(17, 15, 22, 0.68)),
        radial-gradient(circle at top, rgba(104, 225, 253, 0.12), transparent 40%);
      backdrop-filter: blur(14px);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 22px;
      pointer-events: none;
      z-index: 4;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
    }
    .drop-overlay.visible {
      display: flex;
    }
    .drop-card {
      width: min(100%, 320px);
      padding: 18px 20px;
      border-radius: 18px;
      border: 1px solid rgba(104, 225, 253, 0.18);
      background: rgba(31, 24, 39, 0.9);
      text-align: center;
      box-shadow: 0 20px 48px rgba(0, 0, 0, 0.24);
    }
    .drop-title {
      font-size: 16px;
      font-weight: 800;
      letter-spacing: -0.03em;
      color: var(--text);
    }
    .drop-sub {
      margin-top: 8px;
      font-size: 11px;
      line-height: 1.6;
      color: var(--text-dim);
    }
    .stream-shell {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .stream-status {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: var(--panel);
    }
    .stream-status.pending { border-color: rgba(255, 158, 88, 0.2); }
    .stream-status.live { border-color: rgba(104, 225, 253, 0.24); }
    .stream-status.done { border-color: rgba(141, 224, 159, 0.28); }
    .stream-status.stopped { border-color: rgba(255, 107, 122, 0.28); }
    .stream-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--accent);
      flex-shrink: 0;
      box-shadow: 0 0 12px rgba(255, 158, 88, 0.28);
    }
    .stream-status.live .stream-dot {
      background: var(--accent-2);
      box-shadow: 0 0 12px rgba(104, 225, 253, 0.28);
      animation: pulseDot .9s ease-in-out infinite;
    }
    .stream-status.done .stream-dot {
      background: var(--ok);
      box-shadow: 0 0 12px rgba(141, 224, 159, 0.28);
    }
    .stream-status.stopped .stream-dot {
      background: var(--danger);
      box-shadow: 0 0 12px rgba(255, 107, 122, 0.28);
    }
    @keyframes pulseDot {
      0%, 100% { transform: scale(.9); opacity: .8; }
      50% { transform: scale(1.15); opacity: 1; }
    }
    .stream-title {
      font-size: 11px;
      font-weight: 700;
      color: var(--text);
    }
    .stream-meta {
      margin-left: auto;
      font-size: 10px;
      color: var(--text-faint);
      white-space: nowrap;
    }
    .stream-preview {
      border-radius: 14px;
      border: 1px solid var(--border);
      background: var(--panel);
      padding: 12px 14px;
      min-height: 64px;
      max-height: min(48vh, 460px);
      overflow: auto;
      line-height: 1.7;
    }
    .stream-preview-empty {
      color: var(--text-faint);
      font-style: italic;
    }
    .stream-preview-live {
      white-space: pre-wrap;
      font-family: 'SF Mono', 'JetBrains Mono', 'Menlo', monospace;
      font-size: 11.5px;
      color: var(--text);
      position: relative;
    }
    .stream-preview-live::after {
      content: '';
      display: inline-block;
      width: 2px;
      height: 14px;
      background: var(--accent);
      margin-left: 2px;
      border-radius: 999px;
      animation: blink .8s step-end infinite;
    }
    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
    .stream-preview-final {
      padding: 0;
      border: none;
      background: transparent;
      max-height: none;
      overflow: visible;
    }
    .regen-btn {
      margin-top: 8px;
      margin-left: 30px;
      padding: 5px 8px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text-faint);
      cursor: pointer;
      font-size: 11px;
    }
    .regen-btn:hover {
      color: var(--text);
      border-color: var(--border-strong);
    }
    body.init .main-view {
      justify-content: center;
    }
    body.init .chat {
      flex: 0 0 auto;
      overflow: visible;
      padding-bottom: 18px;
    }
    body.init .input-wrap {
      max-width: 720px;
      width: 100%;
      margin: 0 auto;
    }
  </style>
</head>
<body class="init">
  <div class="header">
    <div class="header-left">
      <div class="logo">LL</div>
      <div class="brand-stack">
        <span class="brand">LLeM</span>
        <span class="subbrand">Local-first code sidekick</span>
      </div>
    </div>
    <div class="header-right">
      <select id="modelSel"></select>
      <button class="btn-icon" id="internetBtn" title="Live web: OFF" style="opacity:0.45;filter:grayscale(1)">🌐</button>
      <button class="btn-icon" id="brainBtn" title="Vault tools">⟡</button>
      <button class="btn-icon" id="settingsBtn" title="Tune LLeM">⚙</button>
      <button class="btn-icon" id="newChatBtn" title="Fresh thread">+</button>
    </div>
  </div>
  <div class="thinking-bar" id="thinkingBar"></div>
  <div class="main-view" id="mainView">
    <div class="drop-overlay" id="dropOverlay">
      <div class="drop-card">
        <div class="drop-title">Drop files to attach</div>
        <div class="drop-sub">Images up to 8MB. Text and code files up to 512KB are added to the next message.</div>
      </div>
    </div>
    <div class="chat" id="chat">
      <div class="welcome">
        <div class="welcome-logo">LL</div>
        <div class="welcome-title">LLeM</div>
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
            <button class="stop-btn" id="stopBtn">■</button>
            <button class="send-btn" id="sendBtn">↑</button>
          </div>
        </div>
      </div>
      <input type="file" id="fileInput" multiple accept="image/*,audio/*,.txt,.md,.csv,.json,.js,.ts,.html,.css,.py,.java,.rs,.go,.yaml,.yml,.xml,.toml" hidden>
    </div>
  </div>

  <script src="${markdownItUri}"></script>
  <script>
    window.onerror = function(msg, url, line) {
      document.body.innerHTML += '<div style="position:absolute;z-index:9999;background:#d94e5d;color:white;padding:10px;top:0;left:0;right:0">ERROR: ' + msg + ' at line ' + line + '</div>';
    };
    window.addEventListener('unhandledrejection', function(event) {
      document.body.innerHTML += '<div style="position:absolute;z-index:9999;background:#d94e5d;color:white;padding:10px;bottom:0;left:0;right:0">PROMISE REJECTION: ' + event.reason + '</div>';
    });

    try {
      const vscode = acquireVsCodeApi();
      const mainView = document.getElementById('mainView');
      const chat = document.getElementById('chat');
      const input = document.getElementById('input');
      const sendBtn = document.getElementById('sendBtn');
      const stopBtn = document.getElementById('stopBtn');
      const modelSel = document.getElementById('modelSel');
      const newChatBtn = document.getElementById('newChatBtn');
      const settingsBtn = document.getElementById('settingsBtn');
      const brainBtn = document.getElementById('brainBtn');
      const internetBtn = document.getElementById('internetBtn');
      const attachBtn = document.getElementById('attachBtn');
      const injectLocalBtn = document.getElementById('injectLocalBtn');
      const inputBox = document.getElementById('inputBox');
      const fileInput = document.getElementById('fileInput');
      const attachPreview = document.getElementById('attachPreview');
      const dropOverlay = document.getElementById('dropOverlay');
      const thinkingBar = document.getElementById('thinkingBar');

      let loader = null;
      let sending = false;
      let pendingFiles = [];
      let internetEnabled = false;
      let streamEl = null;
      let streamRaw = '';
      let streamStatusEl = null;
      let streamStatusTitleEl = null;
      let streamMetaEl = null;
      let streamPreviewEl = null;
      let streamRenderTimer = null;
      let streamMetaTimer = null;
      let streamLastRender = 0;
      let streamStartedAt = 0;
      let streamChunkCount = 0;
      const STREAM_RENDER_INTERVAL = 80;
      const STREAM_META_INTERVAL = 250;
      const MAX_TEXT_ATTACHMENT_BYTES = 512 * 1024;
      const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
      const ATTACHABLE_EXTENSIONS = new Set([
        '.txt', '.md', '.csv', '.json',
        '.js', '.ts', '.html', '.css',
        '.py', '.java', '.rs', '.go',
        '.yaml', '.yml', '.xml', '.toml'
      ]);

      function getTime() {
        return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      }

      function esc(value) {
        const div = document.createElement('div');
        div.innerText = value;
        return div.innerHTML;
      }

      function escapeRegExp(value) {
        return value.replace(/[|\\\\{}()[\\]^$+*?.]/g, '\\\\$&');
      }

      function langLabel(info) {
        const raw = (info || '').trim().split(/\\s+/)[0] || 'code';
        return raw.replace(/[{}()[\\]"'<>]/g, '') || 'code';
      }

      function highlight(code) {
        let html = esc(code);
        html = html.replace(/(\\/\\/[^\\n]*)/g, '<span style="color:#8f8493">$1</span>');
        html = html.replace(/(#.*)/g, '<span style="color:#8f8493">$1</span>');
        html = html.replace(/(&quot;[^&]*?&quot;|&#x27;[^&]*?&#x27;)/g, '<span style="color:#8de09f">$1</span>');
        html = html.replace(/\\b(function|const|let|var|return|if|else|for|while|class|import|export|from|default|async|await|try|catch|throw|new|this|def|self|print|lambda|yield|with|as|raise|except|finally)\\b/g, '<span style="color:#caa8ff">$1</span>');
        html = html.replace(/\\b(\\d+\\.?\\d*)\\b/g, '<span style="color:#ffb87a">$1</span>');
        return html;
      }

      function codeBlock(code, info) {
        const lang = langLabel(info);
        return '<div class="code-wrap"><span class="code-lang">' + esc(lang) + '</span><pre><code>' + highlight(code) + '</code></pre><button class="copy-btn" onclick="copyCode(this)">Copy</button></div>';
      }

      let mdRenderer = null;
      function getMarkdownRenderer() {
        if (!window.markdownit) {
          return null;
        }
        if (mdRenderer) {
          return mdRenderer;
        }

        const md = window.markdownit({
          html: false,
          linkify: true,
          typographer: true,
          breaks: false
        });

        md.renderer.rules.fence = (tokens, idx) => codeBlock(tokens[idx].content, tokens[idx].info);
        md.renderer.rules.code_block = (tokens, idx) => codeBlock(tokens[idx].content, '');

        const defaultLinkOpen = md.renderer.rules.link_open || function(tokens, idx, options, env, self) {
          return self.renderToken(tokens, idx, options);
        };
        md.renderer.rules.link_open = function(tokens, idx, options, env, self) {
          const token = tokens[idx];
          const target = token.attrIndex('target');
          if (target < 0) token.attrPush(['target', '_blank']); else token.attrs[target][1] = '_blank';
          const rel = token.attrIndex('rel');
          if (rel < 0) token.attrPush(['rel', 'noopener noreferrer']); else token.attrs[rel][1] = 'noopener noreferrer';
          return defaultLinkOpen(tokens, idx, options, env, self);
        };

        mdRenderer = md;
        return mdRenderer;
      }

      function fmt(text) {
        let value = text || '';
        if (value.lastIndexOf('<create_file') > value.lastIndexOf('</create_file>')) value += '</create_file>';
        if (value.lastIndexOf('<edit_file') > value.lastIndexOf('</edit_file>')) value += '</edit_file>';
        if (value.lastIndexOf('<run_command') > value.lastIndexOf('</run_command>')) value += '</run_command>';
        if ((value.match(/\`\`\`/g) || []).length % 2 !== 0) value += '\\n' + String.fromCharCode(96, 96, 96);

        const blocks = [];
        function pushBlock(html) {
          const token = '@@LLEM_BLOCK_' + blocks.length + '@@';
          blocks.push({ token, html });
          return '\\n\\n' + token + '\\n\\n';
        }

        value = value.replace(/<create_file\\s+path="([^"]+)">([\\s\\S]*?)<\\/create_file>/gi, function(_, filePath, content) {
          return pushBlock('<div class="file-badge">📁 Created file · ' + esc(filePath) + '</div><div class="code-wrap"><pre><code>' + esc(content) + '</code></pre><button class="copy-btn" onclick="copyCode(this)">Copy</button></div>');
        });
        value = value.replace(/<edit_file\\s+path="([^"]+)">([\\s\\S]*?)<\\/edit_file>/gi, function(_, filePath, content) {
          return pushBlock('<div class="edit-badge">✏️ Edited file · ' + esc(filePath) + '</div><div class="code-wrap"><pre><code>' + esc(content) + '</code></pre><button class="copy-btn" onclick="copyCode(this)">Copy</button></div>');
        });
        value = value.replace(/<run_command>([\\s\\S]*?)<\\/run_command>/gi, function(_, command) {
          return pushBlock('<div class="cmd-badge"><span>▶ ' + esc(command.trim()) + '</span><button class="btn-open" onclick="openTerminal()">Open</button></div>');
        });

        const md = getMarkdownRenderer();
        if (!md) {
          let fallback = esc(value).replace(/\\n/g, '<br>');
          blocks.forEach(function(block) {
            fallback = fallback.split(esc(block.token)).join(block.html);
          });
          return fallback;
        }

        let html = md.render(value);
        blocks.forEach(function(block) {
          const wrapped = new RegExp('<p>\\\\s*' + escapeRegExp(block.token) + '\\\\s*<\\\\/p>', 'g');
          html = html.replace(wrapped, block.html).split(block.token).join(block.html);
        });
        return html;
      }

      function copyCode(btn) {
        const code = btn.parentElement.querySelector('code');
        if (!code) return;
        navigator.clipboard.writeText(code.innerText).then(function() {
          btn.textContent = 'Copied';
          btn.classList.add('copied');
          setTimeout(function() {
            btn.textContent = 'Copy';
            btn.classList.remove('copied');
          }, 1400);
        });
      }
      window.copyCode = copyCode;

      function openTerminal() {
        vscode.postMessage({ type: 'showTerminal' });
      }
      window.openTerminal = openTerminal;

      function renderAttachments(files) {
        if (!files || files.length === 0) {
          return null;
        }
        const wrap = document.createElement('div');
        wrap.className = 'msg-attachments';
        files.forEach(function(file) {
          const item = document.createElement('div');
          item.className = 'msg-attachment';
          const isImage = file.type && file.type.startsWith('image/') && file.data;
          if (isImage) {
            const img = document.createElement('img');
            img.className = 'msg-attachment-img';
            img.src = 'data:' + file.type + ';base64,' + file.data;
            img.alt = file.name || 'attached image';
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

      function addMsg(text, role, files) {
        const isUser = role === 'user';
        const isErr = role === 'error';
        const el = document.createElement('div');
        el.className = 'msg' + (isUser ? ' msg-user' : '') + (isErr ? ' msg-error' : '');
        const head = document.createElement('div');
        head.className = 'msg-head';
        head.innerHTML = (isUser
          ? '<div class="av av-user">You</div><span>You</span>'
          : '<div class="av av-ai">LL</div><span>LLeM</span>') + '<span class="msg-time">' + getTime() + '</span>';
        const body = document.createElement('div');
        body.className = 'msg-body';
        if (isUser) {
          body.innerText = text || '';
        } else {
          body.innerHTML = fmt(text || '');
        }
        const attachments = renderAttachments(files);
        if (attachments) {
          body.appendChild(attachments);
        }
        el.appendChild(head);
        el.appendChild(body);
        chat.appendChild(el);
        chat.scrollTop = chat.scrollHeight;
      }

      function showLoader() {
        loader = document.createElement('div');
        loader.className = 'msg';
        loader.innerHTML = '<div class="msg-head"><div class="av av-ai">LL</div><span>LLeM</span><span class="msg-time">' + getTime() + '</span></div><div class="msg-body" style="color:var(--text-faint)">Cooking up a reply...</div>';
        chat.appendChild(loader);
        chat.scrollTop = chat.scrollHeight;
        thinkingBar.classList.add('active');
      }

      function hideLoader() {
        if (loader && loader.parentNode) {
          loader.parentNode.removeChild(loader);
        }
        loader = null;
        thinkingBar.classList.remove('active');
      }

      function setSending(value) {
        sending = value;
        sendBtn.disabled = value;
        input.disabled = value;
        stopBtn.classList.toggle('visible', value);
        if (!value) {
          input.focus();
          thinkingBar.classList.remove('active');
        }
      }

      function clearStreamRenderTimer() {
        if (streamRenderTimer) {
          clearTimeout(streamRenderTimer);
          streamRenderTimer = null;
        }
      }

      function clearStreamMetaTimer() {
        if (streamMetaTimer) {
          clearInterval(streamMetaTimer);
          streamMetaTimer = null;
        }
      }

      function formatElapsed(ms) {
        const total = Math.max(0, Math.floor(ms / 1000));
        const mins = Math.floor(total / 60);
        const secs = String(total % 60).padStart(2, '0');
        return mins > 0 ? mins + ':' + secs : secs + 's';
      }

      function updateStreamMeta() {
        if (!streamMetaEl) return;
        const parts = [formatElapsed(Date.now() - streamStartedAt)];
        if (streamChunkCount > 0) parts.push(streamChunkCount + ' chunk' + (streamChunkCount === 1 ? '' : 's'));
        if (streamRaw.length > 0) parts.push(streamRaw.length + ' chars');
        streamMetaEl.textContent = parts.join(' · ');
      }

      function startStreamMetaTimer() {
        clearStreamMetaTimer();
        updateStreamMeta();
        streamMetaTimer = setInterval(updateStreamMeta, STREAM_META_INTERVAL);
      }

      function resetStreamRefs() {
        clearStreamRenderTimer();
        clearStreamMetaTimer();
        streamEl = null;
        streamRaw = '';
        streamStatusEl = null;
        streamStatusTitleEl = null;
        streamMetaEl = null;
        streamPreviewEl = null;
        streamLastRender = 0;
        streamStartedAt = 0;
        streamChunkCount = 0;
      }

      function appendRegenButton(target) {
        if (!target || target.querySelector('.regen-btn')) return;
        const button = document.createElement('button');
        button.className = 'regen-btn';
        button.innerHTML = '↻ Run it back';
        button.addEventListener('click', function() {
          button.remove();
          vscode.postMessage({ type: 'regenerate' });
          showLoader();
          setSending(true);
        });
        target.appendChild(button);
      }

      function renderStreamNow() {
        clearStreamRenderTimer();
        if (!streamPreviewEl) return;
        streamLastRender = Date.now();
        if (streamRaw.length === 0) {
          streamPreviewEl.className = 'stream-preview stream-preview-empty';
          streamPreviewEl.textContent = 'The first token will show up here the second it lands.';
        } else {
          streamPreviewEl.className = 'stream-preview stream-preview-live';
          streamPreviewEl.textContent = streamRaw;
        }
        updateStreamMeta();
        chat.scrollTop = chat.scrollHeight;
      }

      function scheduleStreamRender(force) {
        if (!streamPreviewEl) return;
        if (force) {
          renderStreamNow();
          return;
        }
        if (streamRenderTimer) return;
        const delay = Math.max(0, STREAM_RENDER_INTERVAL - (Date.now() - streamLastRender));
        streamRenderTimer = setTimeout(renderStreamNow, delay);
      }

      function finalizeStream(state) {
        hideLoader();
        if (!streamEl || !streamPreviewEl) {
          setSending(false);
          resetStreamRefs();
          return;
        }
        scheduleStreamRender(true);
        if (streamStatusEl) streamStatusEl.className = 'stream-status ' + state;
        if (streamStatusTitleEl) {
          streamStatusTitleEl.textContent = state === 'done' ? 'Reply ready' : 'Generation stopped';
        }
        if (streamPreviewEl) {
          if (streamRaw.length > 0) {
            streamPreviewEl.className = 'stream-preview stream-preview-final';
            streamPreviewEl.innerHTML = fmt(streamRaw);
          } else {
            streamPreviewEl.className = 'stream-preview stream-preview-empty';
            streamPreviewEl.textContent = state === 'done' ? 'The reply came back empty.' : 'Generation stopped before output landed.';
          }
        }
        updateStreamMeta();
        appendRegenButton(streamEl);
        setSending(false);
        resetStreamRefs();
      }

      function formatAttachmentBytes(bytes) {
        if (bytes < 1024) return bytes + 'B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
        return (bytes / 1024 / 1024).toFixed(1) + 'MB';
      }

      function hasFilePayload(event) {
        const transfer = event.dataTransfer;
        if (!transfer || !transfer.types) {
          return false;
        }
        return Array.prototype.includes.call(transfer.types, 'Files') || 
               Array.prototype.includes.call(transfer.types, 'text/uri-list');
      }

      function isSupportedAttachment(file) {
        if (!file) {
          return false;
        }
        const type = file.type || '';
        if (type.startsWith('image/') || type.startsWith('audio/')) {
          return true;
        }
        const lowerName = (file.name || '').toLowerCase();
        const dotIndex = lowerName.lastIndexOf('.');
        return dotIndex >= 0 && ATTACHABLE_EXTENSIONS.has(lowerName.slice(dotIndex));
      }

      function setDropActive(active) {
        dropOverlay.classList.toggle('visible', active);
        inputBox.classList.toggle('drag-over', active);
        chat.classList.toggle('drag-over', active);
      }

      function resetDropActive() {
        setDropActive(false);
      }

      function readBlobAsDataUrl(blob) {
        return new Promise(function(resolve, reject) {
          const reader = new FileReader();
          reader.onerror = function() {
            reject(reader.error || new Error('Failed to read file.'));
          };
          reader.onload = function() {
            resolve(reader.result || '');
          };
          reader.readAsDataURL(blob);
        });
      }

      async function buildAttachment(file) {
        if (!isSupportedAttachment(file)) {
          alert(file.name + ' is not a supported attachment yet.');
          return null;
        }

        const type = file.type || 'text/plain';
        const isImage = type.startsWith('image/');
        const limit = isImage ? MAX_IMAGE_ATTACHMENT_BYTES : MAX_TEXT_ATTACHMENT_BYTES;

        if (isImage && file.size > limit) {
          alert(file.name + ' is too big. Images can be up to ' + formatAttachmentBytes(limit) + '.');
          return null;
        }

        const source = file.size > limit ? file.slice(0, limit) : file;
        const dataUrl = await readBlobAsDataUrl(source);
        const base64 = String(dataUrl).split(',')[1] || '';

        return {
          name: file.name,
          type: type,
          data: base64,
          truncated: file.size > limit,
          originalSize: file.size
        };
      }

      async function appendPendingFiles(files) {
        if (!files || files.length === 0) {
          return;
        }

        const appended = [];
        for (const file of files) {
          try {
            const attachment = await buildAttachment(file);
            if (attachment) {
              appended.push(attachment);
            }
          } catch (error) {
            alert('Could not read ' + file.name + '.');
          }
        }

        if (appended.length > 0) {
          pendingFiles = pendingFiles.concat(appended);
          renderPreview();
        }
      }

      function renderPreview() {
        attachPreview.innerHTML = '';
        if (pendingFiles.length === 0) {
          attachPreview.classList.remove('visible');
          return;
        }
        attachPreview.classList.add('visible');
        pendingFiles.forEach(function(file, index) {
          const chip = document.createElement('div');
          chip.className = 'attach-chip';
          const isImage = file.type.startsWith('image/');
          if (isImage) {
            const thumb = document.createElement('img');
            thumb.className = 'attach-thumb';
            thumb.src = 'data:' + file.type + ';base64,' + file.data;
            chip.appendChild(thumb);
          } else {
            const icon = document.createElement('span');
            icon.textContent = file.type.startsWith('audio/') ? '🎧' : '📄';
            chip.appendChild(icon);
          }
          const name = document.createElement('span');
          name.className = 'chip-name';
          name.textContent = file.name + (file.truncated ? ' (partial)' : '');
          const remove = document.createElement('span');
          remove.className = 'chip-remove';
          remove.textContent = '✕';
          remove.addEventListener('click', function() {
            pendingFiles.splice(index, 1);
            renderPreview();
          });
          chip.appendChild(name);
          chip.appendChild(remove);
          attachPreview.appendChild(chip);
        });
      }

      function send() {
        const text = input.value.trim();
        if ((!text && pendingFiles.length === 0) || sending) return;
        const attachedFiles = pendingFiles.slice();
        document.body.classList.remove('init');
        const welcome = document.querySelector('.welcome');
        if (welcome) welcome.remove();
        addMsg(text, 'user', attachedFiles);
        input.value = '';
        input.style.height = 'auto';
        setSending(true);
        showLoader();
        if (attachedFiles.length > 0) {
          vscode.postMessage({
            type: 'promptWithFile',
            value: text || 'Take a look at these files.',
            model: modelSel.value,
            files: attachedFiles,
            internet: internetEnabled
          });
          pendingFiles = [];
          renderPreview();
        } else {
          vscode.postMessage({
            type: 'prompt',
            value: text,
            model: modelSel.value,
            internet: internetEnabled
          });
        }
      }

      internetBtn.addEventListener('click', function() {
        internetEnabled = !internetEnabled;
        internetBtn.style.opacity = internetEnabled ? '1' : '0.45';
        internetBtn.style.filter = internetEnabled ? 'none' : 'grayscale(1)';
        internetBtn.title = 'Live web: ' + (internetEnabled ? 'ON' : 'OFF');
        const info = document.createElement('div');
        info.className = 'msg';
        info.innerHTML = '<div class="msg-body" style="color:var(--accent-2);font-size:12px">🌐 Live web mode is now ' + (internetEnabled ? 'ON' : 'OFF') + '.</div>';
        chat.appendChild(info);
        chat.scrollTop = chat.scrollHeight;
      });

      input.addEventListener('input', function() {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 150) + 'px';
      });

      input.addEventListener('paste', function(event) {
        const items = event.clipboardData && event.clipboardData.items;
        if (!items) return;
        for (const item of items) {
          if (!item.type.startsWith('image/')) continue;
          event.preventDefault();
          const file = item.getAsFile();
          if (!file) return;
          const reader = new FileReader();
          reader.onload = function() {
            const base64 = reader.result.split(',')[1];
            pendingFiles.push({ name: 'clipboard-image.png', type: file.type, data: base64 });
            renderPreview();
          };
          reader.readAsDataURL(file);
          return;
        }
      });

      attachBtn.addEventListener('click', function() {
        fileInput.click();
      });

      injectLocalBtn.addEventListener('click', function() {
        if (pendingFiles.length === 0) {
          alert('Attach files first, then drop them into the vault.');
          return;
        }
        vscode.postMessage({ type: 'injectLocalBrain', files: pendingFiles });
        pendingFiles = [];
        renderPreview();
      });

      fileInput.addEventListener('change', function() {
        void appendPendingFiles(Array.from(fileInput.files || []));
        fileInput.value = '';
      });

      mainView.addEventListener('dragenter', function(event) {
        if (!hasFilePayload(event)) {
          return;
        }
        event.preventDefault();
        setDropActive(true);
      });

      mainView.addEventListener('dragover', function(event) {
        if (!hasFilePayload(event)) {
          return;
        }
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'copy';
        }
        setDropActive(true);
      });

      mainView.addEventListener('dragleave', function(event) {
        if (!mainView.contains(event.relatedTarget)) {
          resetDropActive();
        }
      });

      window.addEventListener('dragover', function(event) {
        if (hasFilePayload(event)) {
          event.preventDefault();
        }
      });

      window.addEventListener('drop', function(event) {
        if (!hasFilePayload(event)) {
          return;
        }
        event.preventDefault();
        const dropTarget = event.target;
        const isInsideMainView = dropTarget instanceof Node && mainView.contains(dropTarget);
        resetDropActive();
        if (isInsideMainView) {
          const isUriList = Array.prototype.includes.call(event.dataTransfer.types, 'text/uri-list');
          if (isUriList) {
            const uriListString = event.dataTransfer.getData('text/uri-list');
            if (uriListString) {
              const uris = uriListString.split('\\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));
              vscode.postMessage({ type: 'fetchUris', uris: uris });
            }
          } else {
            const droppedFiles = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
            void appendPendingFiles(droppedFiles);
          }
        }
      });

      sendBtn.addEventListener('click', send);
      input.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          send();
        }
      });
      newChatBtn.addEventListener('click', function() { vscode.postMessage({ type: 'newChat' }); });
      settingsBtn.addEventListener('click', function() { vscode.postMessage({ type: 'openSettings' }); });
      brainBtn.addEventListener('click', function() { vscode.postMessage({ type: 'syncBrain' }); });
      stopBtn.addEventListener('click', function() {
        vscode.postMessage({ type: 'stopGeneration' });
        hideLoader();
        finalizeStream('stopped');
      });

      window.addEventListener('message', function(event) {
        const msg = event.data;
        switch (msg.type) {
          case 'response':
            hideLoader();
            setSending(false);
            addMsg(msg.value, 'ai');
            break;
          case 'error':
            if (streamEl) {
              finalizeStream('stopped');
            } else {
              hideLoader();
              setSending(false);
            }
            addMsg(msg.value, 'error');
            break;
          case 'streamStart': {
            hideLoader();
            resetStreamRefs();
            streamStartedAt = Date.now();
            streamEl = document.createElement('div');
            streamEl.className = 'msg';
            const head = document.createElement('div');
            head.className = 'msg-head';
            head.innerHTML = '<div class="av av-ai">LL</div><span>LLeM</span><span class="msg-time">' + getTime() + '</span>';
            const body = document.createElement('div');
            body.className = 'msg-body';
            const shell = document.createElement('div');
            shell.className = 'stream-shell';
            streamStatusEl = document.createElement('div');
            streamStatusEl.className = 'stream-status pending';
            const dot = document.createElement('span');
            dot.className = 'stream-dot';
            streamStatusTitleEl = document.createElement('span');
            streamStatusTitleEl.className = 'stream-title';
            streamStatusTitleEl.textContent = 'Warming up output';
            streamMetaEl = document.createElement('span');
            streamMetaEl.className = 'stream-meta';
            streamStatusEl.appendChild(dot);
            streamStatusEl.appendChild(streamStatusTitleEl);
            streamStatusEl.appendChild(streamMetaEl);
            streamPreviewEl = document.createElement('div');
            streamPreviewEl.className = 'stream-preview stream-preview-empty';
            streamPreviewEl.textContent = 'The first token will show up here the second it lands.';
            shell.appendChild(streamStatusEl);
            shell.appendChild(streamPreviewEl);
            body.appendChild(shell);
            streamEl.appendChild(head);
            streamEl.appendChild(body);
            chat.appendChild(streamEl);
            chat.scrollTop = chat.scrollHeight;
            thinkingBar.classList.add('active');
            startStreamMetaTimer();
            break;
          }
          case 'streamChunk':
            streamRaw += msg.value || '';
            if (msg.value) streamChunkCount += 1;
            if (streamStatusEl) streamStatusEl.className = 'stream-status live';
            if (streamStatusTitleEl && streamRaw.length > 0) streamStatusTitleEl.textContent = 'Live output';
            scheduleStreamRender(false);
            break;
          case 'streamEnd':
            finalizeStream('done');
            break;
          case 'streamAbort':
            finalizeStream('stopped');
            break;
          case 'modelsList':
            modelSel.innerHTML = '';
            msg.value.forEach(function(model) {
              const option = document.createElement('option');
              option.value = model;
              option.textContent = model;
              modelSel.appendChild(option);
            });
            break;
          case 'clearChat':
            document.body.classList.add('init');
            chat.innerHTML = '<div class="welcome"><div class="welcome-logo">LL</div><div class="welcome-title">LLeM</div><div class="welcome-sub">Local models. Repo context. Real edits. Real terminal moves. No cloud weirdness.</div></div>';
            break;
          case 'restoreMessages':
            chat.innerHTML = '';
            if (msg.value && msg.value.length > 0) {
              document.body.classList.remove('init');
              msg.value.forEach(function(item) {
                addMsg(item.text, item.role, item.files);
              });
            } else {
              document.body.classList.add('init');
              chat.innerHTML = '<div class="welcome"><div class="welcome-logo">LL</div><div class="welcome-title">LLeM</div><div class="welcome-sub">Local models. Repo context. Real edits. Real terminal moves. No cloud weirdness.</div></div>';
            }
            break;
          case 'focusInput':
            input.focus();
            break;
          case 'injectPrompt':
            input.value = msg.value;
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 150) + 'px';
            send();
            break;
          case 'fetchedUris':
            if (msg.files && msg.files.length > 0) {
              pendingFiles = pendingFiles.concat(msg.files);
              renderPreview();
            }
            break;
        }
      });

      vscode.postMessage({ type: 'getModels' });
      setTimeout(function() { vscode.postMessage({ type: 'ready' }); }, 300);
    } catch (err) {
      document.body.innerHTML = '<div style="color:#fff;padding:20px;background:#111;height:100%;font-size:14px;overflow:auto"><h2>Webview JS crash</h2><pre>' + err.name + ': ' + err.message + '\\n' + err.stack + '</pre></div>';
    }
  </script>
</body>
</html>`;
}
