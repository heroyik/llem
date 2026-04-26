// @ts-nocheck
window.onerror = function(msg, url, line) {
  const overlay = document.createElement('div');
  overlay.className = 'fatal-overlay fatal-overlay-top';
  overlay.textContent = 'ERROR: ' + msg + ' at line ' + line;
  document.body.appendChild(overlay);
};
window.addEventListener('unhandledrejection', function(event) {
  const overlay = document.createElement('div');
  overlay.className = 'fatal-overlay fatal-overlay-bottom';
  overlay.textContent = 'PROMISE REJECTION: ' + event.reason;
  document.body.appendChild(overlay);
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
  let dragCounter = 0;
  let dropSequence = 0;
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

      const extensionVersion = document.body.dataset.version || 'dev';
      function welcomeMarkup() {
        return '<div class="welcome"><div class="welcome-logo">LL</div><div class="welcome-title">LLeM<span class="welcome-version">v' + esc(extensionVersion) + '</span></div><div class="welcome-sub">Local models. Repo context. Real edits. Real terminal moves. No cloud weirdness.</div></div>';
      }

  function getTime() {
    return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  function esc(value) {
    const div = document.createElement('div');
    div.innerText = value;
    return div.innerHTML;
  }

  function escapeRegExp(value) {
    return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
  }

  function langLabel(info) {
    const raw = (info || '').trim().split(/\s+/)[0] || 'code';
    return raw.replace(/[{}()[\]"'<>]/g, '') || 'code';
  }

  function highlight(code) {
    let html = esc(code);
    html = html.replace(/(\/\/[^\n]*)/g, '<span class="tok-comment">$1</span>');
    html = html.replace(/(#.*)/g, '<span class="tok-comment">$1</span>');
    html = html.replace(/(&quot;[^&]*?&quot;|&#x27;[^&]*?&#x27;)/g, '<span class="tok-string">$1</span>');
    html = html.replace(/\b(function|const|let|var|return|if|else|for|while|class|import|export|from|default|async|await|try|catch|throw|new|this|def|self|print|lambda|yield|with|as|raise|except|finally)\b/g, '<span class="tok-keyword">$1</span>');
    html = html.replace(/\b(\d+\.?\d*)\b/g, '<span class="tok-number">$1</span>');
    return html;
  }

  function codeBlock(code, info) {
    const lang = langLabel(info);
    return '<div class="code-wrap"><span class="code-lang">' + esc(lang) + '</span><pre><code>' + highlight(code) + '</code></pre><button class="copy-btn" data-action="copy-code">Copy</button></div>';
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
    md.validateLink = function(url) {
      const value = String(url || '').trim().toLowerCase();
      return value.startsWith('https://') ||
             value.startsWith('http://') ||
             value.startsWith('mailto:') ||
             value.startsWith('#');
    };

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

    const COMMON_EXTENSIONS = new Set([
      '.txt', '.md', '.csv', '.json',
      '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.html', '.css', '.scss', '.less',
      '.py', '.java', '.rs', '.go', '.cpp', '.c', '.h', '.hpp', '.cs',
      '.yaml', '.yml', '.xml', '.toml', '.env', '.sh', '.bat', '.ps1',
      '.rb', '.php', '.swift', '.kt', '.sql', '.vue', '.svelte'
    ]);

    function isLikelyFile(name) {
      const text = String(name || '').trim();
      if (!text || text.includes(' ') || text.includes('\\n') || text.includes('(') || text.includes(')') || text.includes('{') || text.includes('}')) return false;
      const dotIndex = text.lastIndexOf('.');
      if (dotIndex < 0) {
        const lower = text.toLowerCase();
        if (lower === 'makefile' || lower === 'dockerfile' || lower === '.gitignore' || lower === '.npmignore') return true;
        return false;
      }
      const ext = text.slice(dotIndex).toLowerCase();
      return COMMON_EXTENSIONS.has(ext);
    }

    const defaultCodeInline = md.renderer.rules.code_inline || function(tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options);
    };
    md.renderer.rules.code_inline = function(tokens, idx, options, env, self) {
      const token = tokens[idx];
      if (isLikelyFile(token.content)) {
        token.attrJoin('class', 'is-file');
      }
      return defaultCodeInline(tokens, idx, options, env, self);
    };

    mdRenderer = md;
    return mdRenderer;
  }

  function fmt(text) {
    let value = text || '';
    if (value.lastIndexOf('<create_file') > value.lastIndexOf('</create_file>')) value += '</create_file>';
    if (value.lastIndexOf('<edit_file') > value.lastIndexOf('</edit_file>')) value += '</edit_file>';
    if (value.lastIndexOf('<run_command') > value.lastIndexOf('</run_command>')) value += '</run_command>';
    if ((value.match(/\`\`\`/g) || []).length % 2 !== 0) value += '\n' + String.fromCharCode(96, 96, 96);

    const blocks = [];
    function pushBlock(html) {
      const token = '@@LLEM_BLOCK_' + blocks.length + '@@';
      blocks.push({ token, html });
      return '\n\n' + token + '\n\n';
    }

    value = value.replace(/(?:<|call:)\s*create_file\s+path="([^"]+)">([\s\S]*?)<\/create_file>/gi, function(_, filePath, content) {
      return pushBlock('<div class="file-badge">📁 Created file · ' + esc(filePath) + '</div><div class="code-wrap"><pre><code>' + esc(content) + '</code></pre><button class="copy-btn" data-action="copy-code">Copy</button></div>');
    });
    value = value.replace(/(?:<|call:)\s*edit_file\s+path="([^"]+)">([\s\S]*?)<\/edit_file>/gi, function(_, filePath, content) {
      return pushBlock('<div class="edit-badge">✏️ Edited file · ' + esc(filePath) + '</div><div class="code-wrap"><pre><code>' + esc(content) + '</code></pre><button class="copy-btn" data-action="copy-code">Copy</button></div>');
    });
    value = value.replace(/(?:<|call:)\s*run_command>([\s\S]*?)<\/run_command>/gi, function(_, command) {
      return pushBlock('<div class="cmd-badge"><span>▶ ' + esc(command.trim()) + '</span><button class="btn-open" data-action="open-terminal">Open</button></div>');
    });

    const md = getMarkdownRenderer();
    if (!md) {
      let fallback = esc(value).replace(/\n/g, '<br>');
      blocks.forEach(function(block) {
        fallback = fallback.split(esc(block.token)).join(block.html);
      });
      return fallback;
    }

    let html = md.render(value);
    blocks.forEach(function(block) {
      const wrapped = new RegExp('<p>\\s*' + escapeRegExp(block.token) + '\\s*<\\/p>', 'g');
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
  function openTerminal() {
    vscode.postMessage({ type: 'showTerminal' });
  }

  document.addEventListener('click', function(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const copyButton = target.closest('[data-action="copy-code"]');
    if (copyButton) {
      copyCode(copyButton);
      return;
    }

    if (target.closest('[data-action="open-terminal"]')) {
      openTerminal();
      return;
    }

    const inlineCode = target.closest('.msg-body :not(pre) > code.is-file');
    if (inlineCode) {
      const fileName = inlineCode.textContent.trim();
      if (fileName) {
        vscode.postMessage({ type: 'openAttachment', file: { name: fileName } });
      }
    }
  });

  function renderAttachments(files) {
    if (!files || files.length === 0) {
      return null;
    }
    const wrap = document.createElement('div');
    wrap.className = 'msg-attachments';
    files.forEach(function(file) {
      const item = document.createElement('div');
      item.className = 'msg-attachment';
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.title = file.sourceUri ? 'Open ' + (file.name || 'attachment') : 'Find and open ' + (file.name || 'attachment');
      item.addEventListener('click', function() {
        vscode.postMessage({ type: 'openAttachment', file: { name: file.name || '', sourceUri: file.sourceUri || '' } });
      });
      item.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          vscode.postMessage({ type: 'openAttachment', file: { name: file.name || '', sourceUri: file.sourceUri || '' } });
        }
      });
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
    loader.innerHTML = '<div class="msg-head"><div class="av av-ai">LL</div><span>LLeM</span><span class="msg-time">' + getTime() + '</span></div><div class="msg-body msg-body-muted">Cooking up a reply...</div>';
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

  function getTransferTypes(transfer) {
    return Array.from((transfer && transfer.types) || []);
  }

  function getLowerTransferTypes(transfer) {
    return getTransferTypes(transfer).map(function(type) {
      return String(type).toLowerCase();
    });
  }

  function isVsCodeDragType(type) {
    return String(type || '').toLowerCase().startsWith('application/vnd.code.');
  }

  function canAcceptDropEvent(event) {
    return Boolean(event && event.shiftKey && hasFilePayload(event));
  }

  function acceptDropEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  function getAttachmentSize(file) {
    if (!file) {
      return 0;
    }
    if (typeof file.originalSize === 'number') {
      return file.originalSize;
    }
    if (typeof file.size === 'number') {
      return file.size;
    }
    return 0;
  }

  function attachmentFingerprint(file) {
    const data = String((file && file.data) || '');
    return [
      String((file && file.name) || '').toLowerCase(),
      String((file && file.type) || '').toLowerCase(),
      String(getAttachmentSize(file)),
      file && file.truncated ? 'partial' : 'full',
      String(data.length),
      data.slice(0, 64),
      data.slice(-64)
    ].join('|');
  }

  function appendAttachmentRecords(files) {
    const incoming = Array.from(files || []);
    if (incoming.length === 0) {
      return;
    }

    const seen = new Set(pendingFiles.map(attachmentFingerprint));
    const accepted = [];

    incoming.forEach(function(file) {
      const key = attachmentFingerprint(file);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      pendingFiles.push(file);
      accepted.push(file);
    });

    if (accepted.length > 0) {
      renderPreview();
    }
  }

  function hasFilePayload(event) {
    const transfer = event.dataTransfer;
    if (!transfer) {
      return false;
    }
    const types = getLowerTransferTypes(transfer);
    const items = Array.from(transfer.items || []);
    // Include 'text/plain' to catch some VS Code file/tree drag actions.
    return types.includes('files') ||
           types.includes('text/uri-list') ||
           types.includes('text/plain') ||
           types.some(isVsCodeDragType) ||
           items.some(function(item) { return item.kind === 'file'; });
  }

  function trimDroppedUri(value) {
    return String(value || '').trim().replace(/^["']|["']$/g, '');
  }

  function looksLikeDroppedUri(value) {
    const candidate = trimDroppedUri(value);
    return /^file:\/\//i.test(candidate) ||
           /^vscode-remote:\/\//i.test(candidate) ||
           /^[a-zA-Z]:[\\/]/.test(candidate) ||
           /^\\\\/.test(candidate) ||
           /^\//.test(candidate);
  }

  function addDroppedUri(uris, value) {
    const candidate = trimDroppedUri(value);
    if (!candidate || candidate.startsWith('#') || !looksLikeDroppedUri(candidate)) {
      return;
    }
    if (!uris.includes(candidate)) {
      uris.push(candidate);
    }
  }

  function collectDroppedUrisFromText(text, uris) {
    String(text || '')
      .split(/\r?\n|\r/)
      .map(trimDroppedUri)
      .filter(function(line) { return line.length > 0 && !line.startsWith('#'); })
      .forEach(function(line) { addDroppedUri(uris, line); });
  }

  function collectDroppedUrisFromObject(value, uris) {
    if (!value) {
      return;
    }

    if (typeof value === 'string') {
      collectDroppedUrisFromText(value, uris);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(function(item) { collectDroppedUrisFromObject(item, uris); });
      return;
    }

    if (typeof value !== 'object') {
      return;
    }

    const directUriKeys = ['external', 'fsPath', 'uri', 'resourceUri', 'path'];
    directUriKeys.forEach(function(key) {
      if (typeof value[key] === 'string') {
        addDroppedUri(uris, value[key]);
      } else if (value[key]) {
        collectDroppedUrisFromObject(value[key], uris);
      }
    });

    if (typeof value.scheme === 'string' && typeof value.path === 'string') {
      if (value.scheme === 'file') {
        addDroppedUri(uris, 'file://' + value.path);
      } else if (value.scheme === 'vscode-remote') {
        const authority = value.authority ? '//' + value.authority : '';
        addDroppedUri(uris, 'vscode-remote:' + authority + value.path);
      }
    }

    Object.keys(value).forEach(function(key) {
      if (!directUriKeys.includes(key) && key !== 'scheme' && key !== 'authority') {
        collectDroppedUrisFromObject(value[key], uris);
      }
    });
  }

  function collectDroppedUris(transfer) {
    const uris = [];
    if (!transfer) {
      return uris;
    }

    const types = getTransferTypes(transfer);
    types.forEach(function(type) {
      const lowerType = String(type).toLowerCase();
      if (lowerType !== 'text/uri-list' &&
          lowerType !== 'text/plain' &&
          !isVsCodeDragType(lowerType)) {
        return;
      }

      const raw = transfer.getData(type);
      if (!raw) {
        return;
      }

      if (lowerType === 'text/plain' || lowerType === 'text/uri-list') {
        collectDroppedUrisFromText(raw, uris);
        return;
      }

      try {
        collectDroppedUrisFromObject(JSON.parse(raw), uris);
      } catch (_error) {
        collectDroppedUrisFromText(raw, uris);
      }
    });

    return uris;
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

    const blobSource = file.size > limit ? file.slice(0, limit) : file;
    const dataUrl = await readBlobAsDataUrl(blobSource);
    const base64 = String(dataUrl).split(',')[1] || '';

    const attachment = {
      name: file.name,
      type: type,
      data: base64,
      truncated: file.size > limit,
      originalSize: file.size
    };

    return attachment;
  }

  async function appendPendingFiles(files, source, requestId) {
    const incoming = Array.from(files || []);
    if (incoming.length === 0) {
      return;
    }

    const appended = [];
    for (const file of incoming) {
      try {
        const attachment = await buildAttachment(file);
        if (attachment) {
          appended.push(attachment);
        }
      } catch (error) {
        console.error('LLeM Drag & Drop: Failed to read native file attachment.', {
          source: source,
          requestId: requestId,
          fileName: file && file.name,
          error: error && (error.stack || error.message || String(error))
        });
        alert('Could not read ' + file.name + '.');
      }
    }

    appendAttachmentRecords(appended);
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
    info.innerHTML = '<div class="msg-body msg-body-info">🌐 Live web mode is now ' + (internetEnabled ? 'ON' : 'OFF') + '.</div>';
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
        appendAttachmentRecords([{ name: 'clipboard-image.png', type: file.type, data: base64, originalSize: file.size }]);
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
    void appendPendingFiles(Array.from(fileInput.files || []), 'file-input', 'file-input-' + Date.now());
    fileInput.value = '';
  });

  window.addEventListener('dragenter', function(event) {
    if (!canAcceptDropEvent(event)) {
      return;
    }
    acceptDropEvent(event);
    dragCounter++;
    setDropActive(true);
  }, true);

  window.addEventListener('dragover', function(event) {
    if (!canAcceptDropEvent(event)) {
      if (dragCounter > 0 && hasFilePayload(event)) {
        dragCounter = 0;
        resetDropActive();
      }
      return;
    }
    acceptDropEvent(event);
    if (dragCounter <= 0) {
      dragCounter = 1;
      setDropActive(true);
    }
  }, true);

  window.addEventListener('dragleave', function(event) {
    if (dragCounter <= 0) {
      return;
    }
    event.stopPropagation();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      resetDropActive();
    }
  }, true);

  window.addEventListener('drop', function(event) {
    if (!canAcceptDropEvent(event)) {
      if (dragCounter > 0) {
        dragCounter = 0;
        resetDropActive();
      }
      return;
    }
    acceptDropEvent(event);
    const requestId = 'drop-' + (++dropSequence);
    dragCounter = 0;
    resetDropActive();

    const droppedFiles = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
    if (droppedFiles.length > 0) {
      void appendPendingFiles(droppedFiles, 'native-drop', requestId);
    }

    const droppedUris = collectDroppedUris(event.dataTransfer);
    if (droppedUris.length > 0) {
      vscode.postMessage({ type: 'fetchUris', requestId: requestId, uris: droppedUris });
    }
  }, true);

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
        chat.innerHTML = welcomeMarkup();
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
          chat.innerHTML = welcomeMarkup();
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
        appendAttachmentRecords(msg.files || []);
        break;
    }
  });

  vscode.postMessage({ type: 'getModels' });
  setTimeout(function() { vscode.postMessage({ type: 'ready' }); }, 300);
} catch (err) {
  document.body.textContent = '';
  const crash = document.createElement('div');
  crash.className = 'crash-screen';
  const title = document.createElement('h2');
  title.textContent = 'Webview JS crash';
  const pre = document.createElement('pre');
  pre.textContent = err.name + ': ' + err.message + '\n' + err.stack;
  crash.appendChild(title);
  crash.appendChild(pre);
  document.body.appendChild(crash);
}


