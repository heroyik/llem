import { isEditableFilePath, resolveEditableWorkspacePath } from '../editableFiles';
import { shouldSubmitOnEnter } from '../inputComposition';

const texmath = require('markdown-it-texmath');
const katex = require('katex');

declare function acquireVsCodeApi(): {
  postMessage: (message: any) => void;
  getState: () => any;
  setState: (state: any) => void;
};

interface FileAttachment {
  name: string;
  type: string;
  data?: string;
  sourceUri?: string;
  truncated?: boolean;
  originalSize?: number;
}

interface Message {
  role: 'user' | 'ai' | 'error';
  text: string;
  files?: FileAttachment[];
  feedback?: 'like' | 'dislike' | null;
}

interface HistoryItem {
  id: string;
  title: string;
  lastModified?: number;
}

interface QueueRequestSummary {
  id: string;
  kind: 'prompt' | 'promptWithFile' | 'editMessage' | 'regenerate';
  prompt: string;
  modelName: string;
  internetEnabled?: boolean;
  messageIndex?: number;
  createdAt: number;
  attachmentCount: number;
}

interface QueueStatePayload {
  running: boolean;
  paused: boolean;
  activeRequest?: QueueRequestSummary;
  pendingRequests: QueueRequestSummary[];
}

interface QueueDraftPayload {
  kind: 'prompt' | 'promptWithFile' | 'editMessage' | 'regenerate';
  prompt: string;
  modelName: string;
  files: FileAttachment[];
  internetEnabled?: boolean;
  messageIndex?: number;
}

interface WebviewWindow extends Window {
  markdownit?: any;
}

const typedWindow = window as WebviewWindow;

function splitFileReference(rawValue: string): { path: string; line?: number } {
  const value = String(rawValue || '').trim();
  const match = value.match(/^(.*):(\d+)$/);
  if (!match) {
    return { path: value };
  }

  const line = Number(match[2]);
  if (!Number.isFinite(line) || line <= 0) {
    return { path: value };
  }
  return { path: match[1], line };
}

window.onerror = function(msg: string | Event, url?: string, line?: number) {
  const overlay = document.createElement('div');
  overlay.className = 'fatal-overlay fatal-overlay-top';
  overlay.textContent = 'ERROR: ' + String(msg) + (line ? ' at line ' + line : '');
  document.body.appendChild(overlay);
};
window.addEventListener('unhandledrejection', function(event: PromiseRejectionEvent) {
  const overlay = document.createElement('div');
  overlay.className = 'fatal-overlay fatal-overlay-bottom';
  overlay.textContent = 'PROMISE REJECTION: ' + event.reason;
  document.body.appendChild(overlay);
});

try {
  const vscode = acquireVsCodeApi();
  function log(message: any, level: string = 'info') {
    vscode.postMessage({ type: 'log', value: message, level: level });
  }
  const mainView = document.getElementById('mainView');
  const chat = document.getElementById('chat');
  const input = document.getElementById('input') as HTMLTextAreaElement | null;
  const sendBtn = document.getElementById('sendBtn');
  const stopBtn = document.getElementById('stopBtn');
  const modelSel = document.getElementById('modelSel') as HTMLSelectElement | null;
  const newChatBtn = document.getElementById('newChatBtn');
  const newChatHistoryBtn = document.getElementById('newChatHistoryBtn');
  const deleteModal = document.getElementById('deleteModal');
  const deleteThreadTitle = document.getElementById('deleteThreadTitle');
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
  const clearAllHistoryBtn = document.getElementById('clearAllHistoryBtn');
  let currentDeletingId: string | null = null;
  let isBulkDelete = false;
  const brainBtn = document.getElementById('brainBtn');
  const internetBtn = document.getElementById('internetBtn');
  const historyBtn = document.getElementById('historyBtn');
  const historyView = document.getElementById('historyView');
  const closeHistoryBtn = document.getElementById('closeHistoryBtn');
  const historySearch = document.getElementById('historySearch') as HTMLInputElement | null;
  const historyList = document.getElementById('historyList');
  const attachBtn = document.getElementById('attachBtn');
  const injectLocalBtn = document.getElementById('injectLocalBtn');
  const inputBox = document.getElementById('inputBox');
  const fileInput = document.getElementById('fileInput') as HTMLInputElement | null;
  const attachPreview = document.getElementById('attachPreview');
  const queuePanel = document.getElementById('queuePanel');
  const editBanner = document.getElementById('editBanner');
  const editBannerLabel = document.getElementById('editBannerLabel');
  const cancelEditBtn = document.getElementById('cancelEditBtn');
  const dropOverlay = document.getElementById('dropOverlay');
  const thinkingBar = document.getElementById('thinkingBar');
  const settingsBtn = document.getElementById('settingsBtn');

  let loader: HTMLElement | null = null;
  let sending = false;
  let pendingFiles: FileAttachment[] = [];
  let editingMessageIndex = -1;
  let displayMessages: Message[] = [];
  let queueState: QueueStatePayload = { running: false, paused: false, pendingRequests: [] };
  let lastQueuePaused = false;
  let internetEnabled = false;
  let inputCompositionActive = false;
  if (internetBtn) {
    log('[INIT] Syncing Live web mode icon (enabled=' + internetEnabled + ')');
    internetBtn.classList.toggle('active', internetEnabled);
    internetBtn.title = 'Live web: ' + (internetEnabled ? 'ON' : 'OFF');
  }
  let dragCounter = 0;
  let dropSequence = 0;
  let streamEl: HTMLElement | null = null;
  let streamRaw = '';
  let streamStatusEl: HTMLElement | null = null;
  let streamStatusTitleEl: HTMLElement | null = null;
  let streamMetaEl: HTMLElement | null = null;
  let streamPreviewEl: HTMLElement | null = null;
  let streamRenderTimer: ReturnType<typeof setTimeout> | null = null;
  let streamMetaTimer: ReturnType<typeof setInterval> | null = null;
  let streamLastRender = 0;
  let streamStartedAt = 0;
  let streamChunkCount = 0;
  let historyItems: HistoryItem[] = [];
  let workspaceFiles = new Set<string>();
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

  function queueKindLabel(kind: QueueRequestSummary['kind']): string {
    if (kind === 'promptWithFile') return 'Files';
    if (kind === 'editMessage') return 'Edit';
    if (kind === 'regenerate') return 'Retry';
    return 'Prompt';
  }

  function queuePromptPreview(request: QueueRequestSummary): string {
    const base = String(request.prompt || '').trim();
    if (base) {
      return base.length > 120 ? base.slice(0, 117) + '...' : base;
    }
    if (request.kind === 'regenerate') {
      return 'Regenerate the last assistant reply.';
    }
    return 'Queued request';
  }

  function renderQueuePanel(): void {
    if (!queuePanel) return;
    const active = queueState.activeRequest;
    const pending = queueState.pendingRequests || [];
    if (!active && pending.length === 0 && !queueState.paused) {
      queuePanel.innerHTML = '';
      queuePanel.hidden = true;
      return;
    }

    queuePanel.hidden = false;
    const total = pending.length + (active ? 1 : 0);
    const activeHtml = active ? [
      '<div class="queue-item queue-item-active">',
      '<div class="queue-copy">',
      '<div class="queue-kind">Running now</div>',
      '<div class="queue-text">' + esc(queuePromptPreview(active)) + '</div>',
      '<div class="queue-submeta">' + esc(queueKindLabel(active.kind) + ' · ' + (active.modelName || 'default model') + (active.attachmentCount ? ' · ' + active.attachmentCount + ' file' + (active.attachmentCount === 1 ? '' : 's') : '')) + '</div>',
      '</div>',
      '<div class="queue-actions"><span class="queue-meta">Live output</span></div>',
      '</div>'
    ].join('') : '';

    const pendingHtml = pending.map(function(request) {
      const index = pending.findIndex(function(item) { return item.id === request.id; });
      const moveUpBtn = index > 0
        ? '<button class="queue-btn" data-action="move-queued-request" data-direction="up" data-queue-id="' + esc(request.id) + '" title="Move up">↑</button>'
        : '';
      const moveDownBtn = index < pending.length - 1
        ? '<button class="queue-btn" data-action="move-queued-request" data-direction="down" data-queue-id="' + esc(request.id) + '" title="Move down">↓</button>'
        : '';
      const editBtn = '<button class="queue-btn" data-action="edit-queued-request" data-queue-id="' + esc(request.id) + '" title="Edit queued request">Edit</button>';
      return [
        '<div class="queue-item" data-queue-id="' + esc(request.id) + '">',
        '<div class="queue-copy">',
        '<div class="queue-kind">' + esc(queueKindLabel(request.kind)) + '</div>',
        '<div class="queue-text">' + esc(queuePromptPreview(request)) + '</div>',
        '<div class="queue-submeta">' + esc((request.modelName || 'default model') + (request.attachmentCount ? ' · ' + request.attachmentCount + ' file' + (request.attachmentCount === 1 ? '' : 's') : '') + (request.internetEnabled ? ' · Live web' : '')) + '</div>',
        '</div>',
        '<div class="queue-actions">' + moveUpBtn + moveDownBtn + editBtn + '<button class="queue-btn queue-btn-danger" data-action="cancel-queued-request" data-queue-id="' + esc(request.id) + '">Cancel</button></div>',
        '</div>'
      ].join('');
    }).join('');

    const clearAll = pending.length > 1
      ? '<button class="queue-btn" data-action="clear-queued-requests">Clear queue</button>'
      : '';
    const resumeBtn = queueState.paused
      ? '<button class="queue-btn" data-action="resume-queue">Resume</button>'
      : '';
    const statusText = queueState.running
      ? 'Active request running'
      : (queueState.paused ? 'Queue paused' : 'Waiting');

    queuePanel.innerHTML = [
      '<div class="queue-head">',
      '<div><div class="queue-title">Request queue</div><div class="queue-meta">' + total + ' total · ' + pending.length + ' waiting · ' + statusText + '</div></div>',
      '<div class="queue-actions">' + resumeBtn + clearAll + '</div>',
      '</div>',
      '<div class="queue-list">',
      activeHtml,
      pendingHtml,
      '</div>'
    ].join('');
  }

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

  function esc(value: string): string {
    const div = document.createElement('div');
    div.innerText = value;
    return div.innerHTML;
  }

  function escapeRegExp(value: string): string {
    return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
  }

  function langLabel(info: string): string {
    const raw = (info || '').trim().split(/\s+/)[0] || 'code';
    return raw.replace(/[{}()[\]"'<>]/g, '') || 'code';
  }

  function getTime(): string {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function highlight(code: string): string {
    let html = esc(code);
    const tokens: string[] = [];

    // 1. Protect comments
    html = html.replace(/(\/\/[^\n]*|#.*)/g, (m) => {
      const id = '@@LLEM_TOK_' + tokens.length + '@@';
      tokens.push('<span class="tok-comment">' + m + '</span>');
      return id;
    });

    // 2. Protect strings
    html = html.replace(/(&quot;[^&]*?&quot;|&#x27;[^&]*?&#x27;)/g, (m) => {
      const id = '@@LLEM_TOK_' + tokens.length + '@@';
      tokens.push('<span class="tok-string">' + m + '</span>');
      return id;
    });

    // 3. Highlight keywords & numbers on the clean text
    html = html.replace(/\b(function|const|let|var|return|if|else|for|while|class|import|export|from|default|async|await|try|catch|throw|new|this|def|self|print|lambda|yield|with|as|raise|except|finally)\b/g, '<span class="tok-keyword">$1</span>');
    html = html.replace(/\b(\d+\.?\d*)\b/g, '<span class="tok-number">$1</span>');

    // Step 4: Restore tokens
    for (let i = 0; i < tokens.length; i++) {
      // Use function to avoid $1 backreference bug if tokens[i] contains $
      html = html.replace('@@LLEM_TOK_' + i + '@@', function() { return tokens[i]; });
    }
    return html;
  }

  function codeBlock(code: string, info: string): string {
    const lang = langLabel(info);
    return '<div class="code-wrap"><span class="code-lang">' + esc(lang) + '</span><pre><code>' + highlight(code) + '</code></pre><button class="copy-btn" data-action="copy-code">Copy</button></div>';
  }

  function applyLiteralMarkdownFallback(html: string): string {
    const protectedBlocks: string[] = [];
    const protect = function(match: string): string {
      const token = '@@LLEM_HTML_' + protectedBlocks.length + '@@';
      protectedBlocks.push(match);
      return token;
    };

    let value = html.replace(/<pre\b[\s\S]*?<\/pre>/gi, protect)
      .replace(/<code\b[\s\S]*?<\/code>/gi, protect);

    value = value.split(/(<[^>]+>)/g).map(function(part) {
      if (!part || part.charAt(0) === '<') {
        return part;
      }

      return part
        .replace(/\*\*([^*\n](?:[\s\S]*?[^*\n])?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^\*])\*([^*\n](?:[\s\S]*?[^*\n])?)\*(?!\*)/g, '$1<em>$2</em>');
    }).join('');

    protectedBlocks.forEach(function(block, index) {
      value = value.split('@@LLEM_HTML_' + index + '@@').join(block);
    });
    return value;
  }

  let mdRenderer: any = null;
  function installMathRenderer(md: any) {
    try {
      md.use(texmath, {
        engine: katex,
        delimiters: 'dollars',
        katexOptions: {
          throwOnError: false,
          strict: 'ignore'
        }
      });
    } catch (error) {
      log('[markdown] Failed to enable math rendering: ' + String(error), 'warn');
    }
  }
  function getMarkdownRenderer() {
    if (!typedWindow.markdownit) {
      return null;
    }
    if (mdRenderer) {
      return mdRenderer;
    }

    const md = typedWindow.markdownit({
      html: false,
      linkify: true,
      typographer: true,
      breaks: true
    });
    installMathRenderer(md);
    md.validateLink = function(url: string) {
      const rawValue = String(url || '').trim();
      const value = rawValue.toLowerCase();
      const reference = splitFileReference(rawValue);
      if (reference.path && isEditableWorkspaceFile(reference.path)) {
        return true;
      }
      return value.startsWith('https://') ||
             value.startsWith('http://') ||
             value.startsWith('mailto:') ||
             value.startsWith('#');
    };

    md.renderer.rules.fence = (tokens: any[], idx: number) => codeBlock(tokens[idx].content, tokens[idx].info);
    md.renderer.rules.code_block = (tokens: any[], idx: number) => codeBlock(tokens[idx].content, '');

    const defaultLinkOpen = md.renderer.rules.link_open || function(tokens: any[], idx: number, options: any, env: any, self: any) {
      return self.renderToken(tokens, idx, options);
    };
    md.renderer.rules.link_open = function(tokens: any[], idx: number, options: any, env: any, self: any) {
      const token = tokens[idx];
      const hrefIndex = token.attrIndex('href');
      const href = hrefIndex >= 0 ? token.attrs[hrefIndex][1] : '';
      const reference = splitFileReference(href);
      if (reference.path && isEditableWorkspaceFile(reference.path)) {
        if (hrefIndex >= 0) token.attrs[hrefIndex][1] = '#';
        token.attrJoin('class', 'is-file-link');
        token.attrSet('data-action', 'open-file');
        token.attrSet('data-file-path', reference.path);
        if (typeof reference.line === 'number') {
          token.attrSet('data-line', String(reference.line));
        }
        token.attrSet('role', 'button');
        token.attrSet('tabindex', '0');
        token.attrSet('title', 'Open ' + reference.path);
        return defaultLinkOpen(tokens, idx, options, env, self);
      }

      const target = token.attrIndex('target');
      if (target < 0) token.attrPush(['target', '_blank']); else token.attrs[target][1] = '_blank';
      const rel = token.attrIndex('rel');
      if (rel < 0) token.attrPush(['rel', 'noopener noreferrer']); else token.attrs[rel][1] = 'noopener noreferrer';
      return defaultLinkOpen(tokens, idx, options, env, self);
    };

    function isEditableWorkspaceFile(name: string) {
      const text = String(name || '').trim();
      if (!text || text.includes(' ') || text.includes('\n')) return false;

      // 1. Check absolute path (rough check for Windows/POSIX)
      if (text.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(text)) {
        return isEditableFilePath(text);
      }

      // 2. Check relative or basename match in workspace
      return Boolean(resolveEditableWorkspacePath(text, workspaceFiles));
    }

    const defaultCodeInline = md.renderer.rules.code_inline || function(tokens: any[], idx: number, options: any, env: any, self: any) {
      return self.renderToken(tokens, idx, options);
    };
    md.renderer.rules.code_inline = function(tokens: any[], idx: number, options: any, env: any, self: any) {
      const token = tokens[idx];
      if (isEditableWorkspaceFile(token.content)) {
        token.attrJoin('class', 'is-file');
      }
      return defaultCodeInline(tokens, idx, options, env, self);
    };

    mdRenderer = md;
    return mdRenderer;
  }

  function fmt(text: string): string {
    let value = text || '';
    if (value.lastIndexOf('<create_file') > value.lastIndexOf('</create_file>')) value += '</create_file>';
    if (value.lastIndexOf('<edit_file') > value.lastIndexOf('</edit_file>')) value += '</edit_file>';
    if (value.lastIndexOf('<run_command') > value.lastIndexOf('</run_command>')) value += '</run_command>';
    if ((value.match(/\`\`\`/g) || []).length % 2 !== 0) value += '\n' + String.fromCharCode(96, 96, 96);

    const blocks: { token: string; html: string }[] = [];
    function pushBlock(html: string) {
      const token = '@@LLEM_BLOCK_' + blocks.length + '@@';
      blocks.push({ token, html });
      return token;
    }

    value = value.replace(/(?:<|call:)\s*create_file\s+path="([^"]+)">([\s\S]*?)<\/create_file>/gi, function(_: string, filePath: string, content: string) {
      const attrs = isEditableFilePath(filePath)
        ? ' data-action="open-file" data-file-path="' + esc(filePath) + '" role="button" tabindex="0" title="Open ' + esc(filePath) + '"'
        : '';
      return pushBlock('<div class="file-badge"' + attrs + '>📁 Created file · ' + esc(filePath) + '</div><div class="code-wrap"><pre><code>' + esc(content) + '</code></pre><button class="copy-btn" data-action="copy-code">Copy</button></div>');
    });
    value = value.replace(/(?:<|call:)\s*edit_file\s+path="([^"]+)">([\s\S]*?)<\/edit_file>/gi, function(_: string, filePath: string, content: string) {
      const attrs = isEditableFilePath(filePath)
        ? ' data-action="open-file" data-file-path="' + esc(filePath) + '" role="button" tabindex="0" title="Open ' + esc(filePath) + '"'
        : '';
      return pushBlock('<div class="edit-badge"' + attrs + '>✏️ Edited file · ' + esc(filePath) + '</div><div class="code-wrap"><pre><code>' + esc(content) + '</code></pre><button class="copy-btn" data-action="copy-code">Copy</button></div>');
    });
    value = value.replace(/(?:<|call:)\s*run_command>([\s\S]*?)<\/run_command>/gi, function(_: string, command: string) {
      return pushBlock('<div class="cmd-badge"><span>▶ ' + esc(command.trim()) + '</span><button class="btn-open" data-action="open-terminal">Open</button></div>');
    });

    const md = getMarkdownRenderer();
    if (!md) {
      let fallback = esc(value).replace(/\n/g, '<br>');
      blocks.forEach(function(block) {
        fallback = fallback.split(block.token).join(block.html);
      });
      return fallback;
    }

    let html = md.render(value);
    blocks.forEach(function(block) {
      // Replace token. If markdown-it wrapped it in <p> because it was on its own line, we try to unwrap it
      // to keep the layout clean, but split/join handles inline cases perfectly.
      const wrapped = new RegExp('<p>\\s*' + escapeRegExp(block.token) + '\\s*<\\/p>', 'g');
      html = html.replace(wrapped, block.html).split(block.token).join(block.html);
    });
    return applyLiteralMarkdownFallback(html);
  }

  function sanitizeAssistantDisplayText(text: string): string {
    if (!text) return '';

    let value = String(text)
      .replace(/<(?:create_file|file|edit_file|edit|run_command|command|bash|terminal|read_url|url|fetch_url|read_brain|read_vault|call:[a-z_]+)\b[\s\S]*?<\/(?:create_file|file|edit_file|edit|run_command|command|bash|terminal|read_url|url|fetch_url|read_brain|read_vault|call:[a-z_]+)>/gi, '')
      .replace(/<(?:delete_file|delete|read_file|read|list_files|list_dir|ls|call:delete_file|call:delete|call:read_file|call:read|call:list_files|call:list_dir|call:ls)\b[^>]*\/?>/gi, '')
      .replace(/<\/?(?:create_file|file|edit_file|edit|delete_file|delete|read_file|read|list_files|list_dir|ls|run_command|command|bash|terminal|read_url|url|fetch_url|read_brain|read_vault|call:[a-z_]+)\b[^>]*>/gi, '')
      .replace(/<\/?(?:find|replace)\b[^>]*>/gi, '')
      .replace(/<(?:create_file|file|edit_file|edit|run_command|command|bash|terminal|read_url|url|fetch_url|read_brain|read_vault|call:[a-z_]+)\b[^>]*>[\s\S]*$/gi, '');

    value = value
      .split('\n')
      .filter(line => !/^\s*\(?\s*(?:wait(?:[,!]|)|let(?:'|’)?s)\s+.*(?:\brefine\b|\breplace block\b|\bclean pass\b|\bworks perfectly\b|\bdynamic mapping\b|\buser(?:'|’)?s environment\b|provided\s+\w+\s+structure|[a-z0-9_/.-]+\.(?:ts|tsx|js|jsx|py|java|go|rs|rb|php|cs|json|md))[\s\S]*\)?\s*$/i.test(line.trim()))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');

    return value.trim();
  }

  function copyCode(btn: HTMLElement) {
    const code = btn.parentElement?.querySelector('code');
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

  function copyMessageText(messageEl: HTMLElement | null) {
    if (!(messageEl instanceof Element)) return;
    const body = messageEl.querySelector('.msg-body');
    if (!(body instanceof HTMLElement)) return;
    navigator.clipboard.writeText(body.innerText.trim()).then(function() {
      const feedback = messageEl.querySelector('.msg-action-feedback');
      if (!feedback) return;
      const previous = feedback.textContent;
      feedback.textContent = 'Copied';
      setTimeout(function() {
        feedback.textContent = previous || '';
      }, 1400);
    });
  }

  function iconMarkup(kind: string): string {
    if (kind === 'copy') return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
    if (kind === 'branch') return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 3a3 3 0 1 0 2.83 4H10a4 4 0 0 1 4 4v1.17A3 3 0 1 0 16 12V11a6 6 0 0 0-6-6H8.83A3 3 0 0 0 6 3zm0 14a3 3 0 1 0 2.83 4H10a6 6 0 0 0 6-6v-1.17A3 3 0 1 0 14 14v1a4 4 0 0 1-4 4H8.83A3 3 0 0 0 6 17zm10-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>';
    if (kind === 'edit') return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
    if (kind === 'up') return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>';
    if (kind === 'down') return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.37-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/></svg>';
    return '';
  }

  function renderMessageActions(message: Message, messageIndex: number, timestamp?: string): HTMLElement {
    const actionBar = document.createElement('div');
    actionBar.className = 'msg-actions';
    actionBar.dataset.index = String(messageIndex);

    const isUser = message.role === 'user';
    const timeLabel = document.createElement('span');
    timeLabel.className = 'msg-action-time';
    timeLabel.textContent = timestamp || getTime();

    if (isUser) {
      actionBar.appendChild(timeLabel);
    }

    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action-btn icon-only';
    copyBtn.title = isUser ? 'Copy message' : 'Copy markdown';
    copyBtn.setAttribute('aria-label', isUser ? 'Copy message' : 'Copy markdown');
    copyBtn.innerHTML = iconMarkup('copy');
    copyBtn.addEventListener('click', function() {
      navigator.clipboard.writeText(message.text || '').then(function() {
        copyBtn.classList.add('active');
        setTimeout(function() { copyBtn.classList.remove('active'); }, 1000);
      });
      // Automatically paste into input and show edit banner
      enterEditMode(messageIndex, message);
    });
    actionBar.appendChild(copyBtn);

    if (isUser) {
      const editBtn = document.createElement('button');
      editBtn.className = 'msg-action-btn icon-only';
      editBtn.title = 'Edit message';
      editBtn.setAttribute('aria-label', 'Edit message');
      editBtn.innerHTML = iconMarkup('edit');
      editBtn.addEventListener('click', function() {
        enterEditMode(messageIndex, message);
      });
      actionBar.appendChild(editBtn);
      return actionBar;
    }

    if (!isUser) {
      const upBtn = document.createElement('button');
      upBtn.className = 'msg-action-btn icon-only feedback-btn' + (message.feedback === 'like' ? ' active' : '');
      upBtn.title = 'Helpful';
      upBtn.setAttribute('aria-label', 'Helpful');
      upBtn.innerHTML = iconMarkup('up');
      upBtn.addEventListener('click', function() {
        const newVal = message.feedback === 'like' ? null : 'like';
        vscode.postMessage({ type: 'setMessageFeedback', messageIndex: messageIndex, feedback: newVal });
        setFeedbackState(actionBar, newVal);
        syncFeedbackAcrossCopies(messageIndex, newVal);
      });
      actionBar.appendChild(upBtn);

      const downBtn = document.createElement('button');
      downBtn.className = 'msg-action-btn icon-only feedback-btn' + (message.feedback === 'dislike' ? ' active' : '');
      downBtn.title = 'Not helpful';
      downBtn.setAttribute('aria-label', 'Not helpful');
      downBtn.innerHTML = iconMarkup('down');
      downBtn.addEventListener('click', function() {
        const newVal = message.feedback === 'dislike' ? null : 'dislike';
        vscode.postMessage({ type: 'setMessageFeedback', messageIndex: messageIndex, feedback: newVal });
        setFeedbackState(actionBar, newVal);
        syncFeedbackAcrossCopies(messageIndex, newVal);
      });
      actionBar.appendChild(downBtn);

      const branchBtn = document.createElement('button');
      branchBtn.className = 'msg-action-btn icon-only';
      branchBtn.title = 'Branch chat';
      branchBtn.setAttribute('aria-label', 'Branch chat');
      branchBtn.innerHTML = iconMarkup('branch');
      branchBtn.addEventListener('click', function() {
        vscode.postMessage({ type: 'branchChat', messageIndex: messageIndex });
        branchBtn.classList.add('active');
        setTimeout(function() { branchBtn.classList.remove('active'); }, 1000);
      });
      actionBar.appendChild(branchBtn);
      actionBar.appendChild(timeLabel);
    }

    return actionBar;
  }

  function setFeedbackState(actionBar: HTMLElement, feedback: 'like' | 'dislike' | null): void {
    const btns = actionBar.querySelectorAll('.feedback-btn');
    btns.forEach(function(btn) {
      if (!(btn instanceof HTMLElement)) return;
      const isUp = btn.title === 'Helpful';
      btn.classList.toggle('active', (isUp && feedback === 'like') || (!isUp && feedback === 'dislike'));
    });
  }

  function syncFeedbackAcrossCopies(messageIndex: number, feedback: 'like' | 'dislike' | null): void {
    const bars = document.querySelectorAll('.msg-actions[data-index="' + messageIndex + '"]');
    bars.forEach(function(bar) {
      setFeedbackState(bar as HTMLElement, feedback);
    });
    if (displayMessages[messageIndex]) {
      displayMessages[messageIndex].feedback = feedback;
    }
  }

  function enterEditMode(messageIndex: number, message: Message): void {
    if (!input || !message) return;
    editingMessageIndex = messageIndex;
    input.value = message.text || '';
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 150) + 'px';
    pendingFiles = Array.from(message.files || []).map(function(file) {
      return {
        name: file.name,
        type: file.type,
        data: file.data,
        sourceUri: file.sourceUri,
        truncated: file.truncated,
        originalSize: file.originalSize
      };
    });
    renderPreview();
    if (editBanner) editBanner.hidden = false;
    if (editBannerLabel) editBannerLabel.textContent = 'Editing this message in a new branch';
    input.focus();
  }

  function exitEditMode(clearInput: boolean): void {
    editingMessageIndex = -1;
    if (editBanner) editBanner.hidden = true;
    if (clearInput && input) {
      input.value = '';
      input.style.height = 'auto';
    }
  }

  function openEditableFile(fileName: string, sourceUri: string, line?: number): void {
    const reference = splitFileReference(fileName);
    const safeName = String(reference.path || '').trim();
    const resolvedWorkspacePath = resolveEditableWorkspacePath(safeName, workspaceFiles);
    const isAbsoluteEditablePath = isEditableFilePath(safeName) && (safeName.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(safeName));
    if (!safeName || (!resolvedWorkspacePath && !isAbsoluteEditablePath && !sourceUri)) {
      return;
    }
    vscode.postMessage({
      type: 'openAttachment',
      file: {
        name: resolvedWorkspacePath || safeName,
        sourceUri: sourceUri || '',
        line: typeof line === 'number' ? line : reference.line
      }
    });
  }

  function rerenderDisplayedMessages(): void {
    if (!chat || displayMessages.length === 0) {
      return;
    }
    chat.innerHTML = '';
    displayMessages.forEach(function(message, index) {
      addMsg(message, message.role as 'user' | 'ai' | 'error', message.files, index);
    });
  }

  document.addEventListener('click', function(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const copyButton = target.closest('[data-action="copy-code"]');
    if (copyButton instanceof HTMLElement) {
      copyCode(copyButton);
      return;
    }

    const cancelQueuedButton = target.closest('[data-action="cancel-queued-request"]');
    if (cancelQueuedButton instanceof HTMLElement) {
      const queueId = cancelQueuedButton.getAttribute('data-queue-id') || '';
      if (queueId) {
        vscode.postMessage({ type: 'cancelQueuedRequest', id: queueId });
      }
      return;
    }

    const editQueuedButton = target.closest('[data-action="edit-queued-request"]');
    if (editQueuedButton instanceof HTMLElement) {
      const queueId = editQueuedButton.getAttribute('data-queue-id') || '';
      if (queueId) {
        vscode.postMessage({ type: 'editQueuedRequest', id: queueId });
      }
      return;
    }

    if (target.closest('[data-action="clear-queued-requests"]')) {
      vscode.postMessage({ type: 'clearQueuedRequests' });
      return;
    }

    const moveQueuedButton = target.closest('[data-action="move-queued-request"]');
    if (moveQueuedButton instanceof HTMLElement) {
      const queueId = moveQueuedButton.getAttribute('data-queue-id') || '';
      const direction = moveQueuedButton.getAttribute('data-direction');
      if (queueId && (direction === 'up' || direction === 'down')) {
        vscode.postMessage({ type: 'moveQueuedRequest', id: queueId, direction: direction });
      }
      return;
    }

    if (target.closest('[data-action="resume-queue"]')) {
      vscode.postMessage({ type: 'resumeQueue' });
      return;
    }

    const messageActionBar = target.closest('.msg-actions');
    if (messageActionBar) {
      const messageIndexStr = messageActionBar.getAttribute('data-index');
      const messageIndex = messageIndexStr ? Number(messageIndexStr) : -1;
      const message = messageIndex >= 0 ? displayMessages[messageIndex] : undefined;

      if (target.closest('[data-action="copy-message"]')) {
        const messageEl = target.closest('.msg') as HTMLElement;
        copyMessageText(messageEl);
        return;
      }
    }

    if (target.closest('[data-action="open-terminal"]')) {
      openTerminal();
      return;
    }

    const externalLink = target.closest('a[href]');
    if (externalLink instanceof HTMLAnchorElement && !externalLink.closest('[data-action="open-file"]')) {
      const href = externalLink.getAttribute('href') || '';
      if (href && href !== '#' && (/^https?:\/\//i.test(href) || /^mailto:/i.test(href))) {
        event.preventDefault();
        vscode.postMessage({ type: 'openExternalUrl', url: href });
        return;
      }
    }

    const openFileTrigger = target.closest('[data-action="open-file"]');
    if (openFileTrigger) {
      event.preventDefault();
      const line = Number(openFileTrigger.getAttribute('data-line') || '');
      openEditableFile(openFileTrigger.getAttribute('data-file-path') || '', '', Number.isFinite(line) ? line : undefined);
      return;
    }

    const inlineCode = target.closest('.msg-body :not(pre) > code.is-file');
    if (inlineCode) {
      const fileName = inlineCode.textContent?.trim() || '';
      openEditableFile(fileName, '');
    }
  });

  document.addEventListener('keydown', function(event: KeyboardEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;

    const openFileTrigger = target.closest('[data-action="open-file"]');
    if (openFileTrigger) {
      event.preventDefault();
      const line = Number(openFileTrigger.getAttribute('data-line') || '');
      openEditableFile(openFileTrigger.getAttribute('data-file-path') || '', '', Number.isFinite(line) ? line : undefined);
      return;
    }

    const externalLink = target.closest('a[href]');
    if (externalLink instanceof HTMLAnchorElement) {
      const href = externalLink.getAttribute('href') || '';
      if (href && href !== '#' && (/^https?:\/\//i.test(href) || /^mailto:/i.test(href))) {
        event.preventDefault();
        vscode.postMessage({ type: 'openExternalUrl', url: href });
      }
    }
  });

  function renderAttachments(files: FileAttachment[]): HTMLElement | null {
    if (!files || files.length === 0) {
      return null;
    }
    const wrap = document.createElement('div');
    wrap.className = 'msg-attachments';
    files.forEach(function(file) {
      const item = document.createElement('div');
      item.className = 'msg-attachment';
      const editable = isEditableFilePath(file.name || '');
      if (editable) {
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        item.title = file.sourceUri ? 'Open ' + (file.name || 'attachment') : 'Find and open ' + (file.name || 'attachment');
        item.addEventListener('click', function() {
          openEditableFile(file.name || '', file.sourceUri || '');
        });
        item.addEventListener('keydown', function(event: KeyboardEvent) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openEditableFile(file.name || '', file.sourceUri || '');
          }
        });
      } else {
        item.title = file.name || 'attachment';
      }
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

  function addMsg(messageOrText: string | Message, role?: 'user' | 'ai' | 'error', files?: FileAttachment[], messageIndex?: number): HTMLElement {
    const message: Message = typeof messageOrText === 'object' && messageOrText !== null
      ? messageOrText as Message
      : { text: messageOrText as string, role: role || 'user', files: files, feedback: null };
    const resolvedRole = message.role || role;
    const resolvedFiles = message.files || files;
    const isUser = resolvedRole === 'user';
    const isErr = resolvedRole === 'error';
    const el = document.createElement('div');
    el.className = 'msg' + (isUser ? ' msg-user' : '') + (isErr ? ' msg-error' : '');
    const head = document.createElement('div');
    head.className = 'msg-head';
    if (isUser) {
      head.innerHTML = '<div class="av av-user">You</div><span>You</span>';
    } else {
      head.innerHTML = '<div class="av av-ai">LL</div><span>LLeM</span><span class="msg-time">' + getTime() + '</span>';
    }
    const body = document.createElement('div');
    body.className = 'msg-body';
    if (isUser) {
      body.innerText = message.text || '';
    } else {
      body.innerHTML = fmt(message.text || '');
    }
    const attachments = renderAttachments(resolvedFiles || []);
    if (attachments) {
      body.appendChild(attachments);
    }
    el.appendChild(head);
    el.appendChild(body);
    if (typeof messageIndex === 'number' && messageIndex >= 0) {
      displayMessages[messageIndex] = message;
      const actions = renderMessageActions(message, messageIndex, getTime());
      el.appendChild(actions);
    }
    if (chat) {
      chat.appendChild(el);
      chat.scrollTop = chat.scrollHeight;
    }
    return el;
  }

  function showDeleteModal(id: string, title: string): void {
    resetDeleteModalUI();
    isBulkDelete = false;
    currentDeletingId = id;
    const deleteThreadTitle = document.getElementById('deleteThreadTitle');
    if (deleteThreadTitle) deleteThreadTitle.textContent = title;
    if (deleteModal) deleteModal.classList.add('visible');
  }

  function hideDeleteModal(): void {
    currentDeletingId = null;
    isBulkDelete = false;
    if (deleteModal) deleteModal.classList.remove('visible');
  }

  function showClearAllModal(): void {
    isBulkDelete = true;
    currentDeletingId = null;
    const modalTitle = deleteModal?.querySelector('.modal-title');
    const modalBody = deleteModal?.querySelector('.modal-body');
    const confirmBtn = document.getElementById('confirmDeleteBtn');

    if (modalTitle) modalTitle.textContent = 'Clear All History?';
    if (modalBody) modalBody.innerHTML = 'Are you sure you want to delete <strong>all</strong> chat threads? This cannot be undone.';
    if (confirmBtn) confirmBtn.textContent = 'Clear All';
    if (deleteModal) deleteModal.classList.add('visible');
  }

  function resetDeleteModalUI(): void {
    const modalTitle = deleteModal?.querySelector('.modal-title');
    const modalBody = deleteModal?.querySelector('.modal-body');
    const confirmBtn = document.getElementById('confirmDeleteBtn');

    if (modalTitle) modalTitle.textContent = 'Delete Thread?';
    if (modalBody) modalBody.innerHTML = 'Are you sure you want to delete "<span id="deleteThreadTitle"></span>"? This cannot be undone.';
    if (confirmBtn) confirmBtn.textContent = 'Delete Thread';
  }

  function showLoader(): void {
    loader = document.createElement('div');
    loader.className = 'msg';
    loader.innerHTML = '<div class="msg-head"><div class="av av-user">You</div><span>You</span><span class="msg-time">' + getTime() + '</span></div><div class="msg-body msg-body-muted">Cooking up a reply...</div>';
    if (chat) {
      chat.appendChild(loader);
      chat.scrollTop = chat.scrollHeight;
    }
    if (thinkingBar) thinkingBar.classList.add('active');
  }

  function hideLoader(): void {
    if (loader && loader.parentNode) {
      loader.parentNode.removeChild(loader);
    }
    loader = null;
    if (thinkingBar) thinkingBar.classList.remove('active');
  }

  function setSending(value: boolean): void {
    sending = value;
    if (sendBtn) {
      (sendBtn as HTMLButtonElement).disabled = false;
      sendBtn.classList.remove('hidden');
    }
    if (stopBtn) stopBtn.classList.toggle('visible', value);
    if (!value) {
      if (input) input.focus();
      if (thinkingBar) thinkingBar.classList.remove('active');
    }
  }

  function clearStreamRenderTimer(): void {
    if (streamRenderTimer) {
      clearTimeout(streamRenderTimer);
      streamRenderTimer = null;
    }
  }

  function clearStreamMetaTimer(): void {
    if (streamMetaTimer) {
      clearInterval(streamMetaTimer);
      streamMetaTimer = null;
    }
  }

  function formatElapsed(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const mins = Math.floor(total / 60);
    const secs = String(total % 60).padStart(2, '0');
    return mins > 0 ? mins + ':' + secs : secs + 's';
  }

  function updateStreamMeta(): void {
    if (!streamMetaEl) return;
    const parts = [formatElapsed(Date.now() - streamStartedAt)];
    if (streamChunkCount > 0) parts.push(streamChunkCount + ' chunk' + (streamChunkCount === 1 ? '' : 's'));
    if (streamRaw.length > 0) parts.push(streamRaw.length + ' chars');
    streamMetaEl.textContent = parts.join(' · ');
  }

  function startStreamMetaTimer(): void {
    clearStreamMetaTimer();
    updateStreamMeta();
    streamMetaTimer = setInterval(updateStreamMeta, STREAM_META_INTERVAL);
  }

  function resetStreamRefs(): void {
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

  function appendRegenButton(target: HTMLElement | null): void {
    if (!target || target.querySelector('.regen-btn')) return;
    const button = document.createElement('button');
    button.className = 'regen-btn';
    button.innerHTML = '↻ Regenerate reply';
    button.addEventListener('click', function() {
      button.remove();
      vscode.postMessage({ type: 'regenerate' });
      showLoader();
      setSending(true);
    });
    target.appendChild(button);
  }

  function renderStreamNow(): void {
    clearStreamRenderTimer();
    if (!streamPreviewEl) return;
    streamLastRender = Date.now();
    const visibleText = sanitizeAssistantDisplayText(streamRaw);
    if (visibleText.length === 0) {
      streamPreviewEl.className = 'stream-preview stream-preview-empty';
      streamPreviewEl.textContent = 'The first token will show up here the second it lands.';
    } else {
      streamPreviewEl.className = 'stream-preview stream-preview-live';
      streamPreviewEl.innerHTML = fmt(visibleText);
    }
    updateStreamMeta();
    if (chat) chat.scrollTop = chat.scrollHeight;
  }

  function scheduleStreamRender(force: boolean): void {
    if (!streamPreviewEl) return;
    if (force) {
      renderStreamNow();
      return;
    }
    if (streamRenderTimer) return;
    const delay = Math.max(0, STREAM_RENDER_INTERVAL - (Date.now() - streamLastRender));
    streamRenderTimer = setTimeout(renderStreamNow, delay);
  }

  function finalizeStream(state: 'done' | 'stopped', message?: Message, messageIndex?: number): void {
    hideLoader();
    if (!streamEl || !streamPreviewEl) {
      setSending(false);
      resetStreamRefs();
      return;
    }
    scheduleStreamRender(true);
    const finalText = typeof message?.text === 'string' && message.text.length > 0
      ? message.text
      : streamRaw;
    const sanitizedFinalText = sanitizeAssistantDisplayText(finalText);
    const hasFinalText = sanitizedFinalText.length > 0;
    if (streamStatusEl) streamStatusEl.className = 'stream-status ' + state;
    if (streamStatusTitleEl) {
      if (state === 'done') {
        streamStatusTitleEl.textContent = hasFinalText ? 'Reply ready' : 'Reply finished without text';
      } else {
        streamStatusTitleEl.textContent = 'Generation stopped';
      }
    }
    if (streamPreviewEl) {
      if (hasFinalText) {
        streamPreviewEl.className = 'stream-preview stream-preview-final';
        streamPreviewEl.innerHTML = fmt(sanitizedFinalText);
      } else {
        streamPreviewEl.className = 'stream-preview stream-preview-empty';
        streamPreviewEl.textContent = state === 'done' ? 'The reply came back empty. Check the LLeM output log for stream details.' : 'Generation stopped before output landed.';
      }
    }
    updateStreamMeta();
    if (state === 'done') {
      const isIndexValid = typeof messageIndex === 'number' && messageIndex >= 0;
      if (isIndexValid) {
        displayMessages[messageIndex!] = message || { role: 'ai', text: streamRaw, feedback: null };
        const actions = renderMessageActions(message || { role: 'ai', text: streamRaw, feedback: null }, messageIndex!, getTime());
        if (actions && !streamEl.querySelector('.msg-actions')) {
          streamEl.appendChild(actions);
        }
      }
    }
    appendRegenButton(streamEl);
    setSending(false);
    resetStreamRefs();
  }

  function formatAttachmentBytes(bytes: number): string {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    return (bytes / 1024 / 1024).toFixed(1) + 'MB';
  }

  function getTransferTypes(transfer: DataTransfer | null): string[] {
    return Array.from((transfer && transfer.types) || []);
  }

  function getLowerTransferTypes(transfer: DataTransfer | null): string[] {
    return getTransferTypes(transfer).map(function(type) {
      return String(type).toLowerCase();
    });
  }

  function isVsCodeDragType(type: string): boolean {
    return String(type || '').toLowerCase().startsWith('application/vnd.code.');
  }

  function canAcceptDropEvent(event: DragEvent): boolean {
    return Boolean(event && event.shiftKey && hasFilePayload(event));
  }

  function acceptDropEvent(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  function getAttachmentSize(file: any): number {
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

  function attachmentFingerprint(file: any): string {
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

  function appendAttachmentRecords(files: FileAttachment[]): void {
    const incoming = Array.from(files || []);
    if (incoming.length === 0) {
      return;
    }

    const seen = new Set(pendingFiles.map(attachmentFingerprint));
    const accepted: FileAttachment[] = [];

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

  function hasFilePayload(event: DragEvent): boolean {
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

  function trimDroppedUri(value: any): string {
    return String(value || '').trim().replace(/^["']|["']$/g, '');
  }

  function looksLikeDroppedUri(value: string): boolean {
    const candidate = trimDroppedUri(value);
    return /^file:\/\//i.test(candidate) ||
           /^vscode-remote:\/\//i.test(candidate) ||
           /^[a-zA-Z]:[\\/]/.test(candidate) ||
           /^\\\\/.test(candidate) ||
           /^\//.test(candidate);
  }

  function addDroppedUri(uris: string[], value: string): void {
    const candidate = trimDroppedUri(value);
    if (!candidate || candidate.startsWith('#') || !looksLikeDroppedUri(candidate)) {
      return;
    }
    if (!uris.includes(candidate)) {
      uris.push(candidate);
    }
  }

  function collectDroppedUrisFromText(text: string, uris: string[]): void {
    String(text || '')
      .split(/\r?\n|\r/)
      .map(trimDroppedUri)
      .filter(function(line) { return line.length > 0 && !line.startsWith('#'); })
      .forEach(function(line) { addDroppedUri(uris, line); });
  }

  function collectDroppedUrisFromObject(value: any, uris: string[]): void {
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

  function collectDroppedUris(transfer: DataTransfer | null): string[] {
    const uris: string[] = [];
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

  function isSupportedAttachment(file: any): boolean {
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

  function setDropActive(active: boolean): void {
    if (dropOverlay) dropOverlay.classList.toggle('visible', active);
    if (inputBox) inputBox.classList.toggle('drag-over', active);
    if (chat) chat.classList.toggle('drag-over', active);
  }

  function resetDropActive(): void {
    setDropActive(false);
  }

  function readBlobAsDataUrl(blob: Blob): Promise<string> {
    return new Promise(function(resolve, reject) {
      const reader = new FileReader();
      reader.onerror = function() {
        reject(reader.error || new Error('Failed to read file.'));
      };
      reader.onload = function() {
        resolve(reader.result as string || '');
      };
      reader.readAsDataURL(blob);
    });
  }

  async function buildAttachment(file: File): Promise<FileAttachment | null> {
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

    const attachment: FileAttachment = {
      name: file.name,
      type: type,
      data: base64,
      truncated: file.size > limit,
      originalSize: file.size
    };

    return attachment;
  }

  async function appendPendingFiles(files: File[], source: string, requestId: string): Promise<void> {
    const incoming = Array.from(files || []);
    if (incoming.length === 0) {
      return;
    }

    const appended: FileAttachment[] = [];
    for (const file of incoming) {
      try {
        const attachment = await buildAttachment(file);
        if (attachment) {
          appended.push(attachment);
        }
      } catch (error: any) {
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

  function renderPreview(): void {
    if (!attachPreview) return;
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

  function renderHistory(items: HistoryItem[]): void {
    if (!historyList) return;
    historyList.innerHTML = '';
    const filtered = items.filter(function(item) {
      const q = (historySearch?.value || '').toLowerCase();
      return (item.title || '').toLowerCase().includes(q);
    });

    if (filtered.length === 0) {
      historyList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-faint);">No threads found.</div>';
      return;
    }

    filtered.forEach(function(item) {
      const el = document.createElement('div');
      el.className = 'history-item';
      const title = document.createElement('div');
      title.className = 'history-item-title';
      title.textContent = item.title || 'Untitled Thread';
      const meta = document.createElement('div');
      meta.className = 'history-item-meta';
      var dateStr = 'Unknown date';
      if (item.lastModified) {
        var d = new Date(item.lastModified);
        if (!isNaN(d.getTime())) {
          var now = Date.now();
          var diff = now - d.getTime();
          if (diff < 60000) {
            dateStr = 'Just now';
          } else if (diff < 3600000) {
            dateStr = Math.floor(diff / 60000) + 'm ago';
          } else if (diff < 86400000) {
            dateStr = Math.floor(diff / 3600000) + 'h ago';
          } else if (diff < 604800000) {
            dateStr = Math.floor(diff / 86400000) + 'd ago';
          } else {
            dateStr = d.toLocaleDateString();
          }
        }
      }
      meta.innerHTML = '<span>' + dateStr + '</span>';

      const actions = document.createElement('div');
      actions.className = 'history-item-actions';
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-delete-history';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        vscode.postMessage({ 
          type: 'requestDeleteHistory', 
          id: item.id, 
          title: item.title || 'Untitled Thread' 
        });
      });
      actions.appendChild(delBtn);
      meta.appendChild(actions);

      el.appendChild(title);
      el.appendChild(meta);
      el.addEventListener('click', function() {
        vscode.postMessage({ type: 'loadHistory', id: item.id });
        toggleHistory(false);
      });
      historyList.appendChild(el);
    });
  }

  function toggleHistory(show: boolean): void {
    if (show) {
      if (historyView) historyView.classList.add('visible');
      vscode.postMessage({ type: 'getHistory' });
      if (historySearch) historySearch.focus();
    } else {
      if (historyView) historyView.classList.remove('visible');
    }
  }

  // History, internet, and other listeners are now handled below via safeListen.

  function postQueuedRequest(request: {
    kind: 'prompt' | 'promptWithFile' | 'editMessage' | 'regenerate';
    prompt: string;
    modelName: string;
    files?: FileAttachment[];
    internetEnabled?: boolean;
    messageIndex?: number;
  }): void {
    vscode.postMessage({
      type: 'enqueueRequest',
      request: {
        kind: request.kind,
        prompt: request.prompt,
        modelName: request.modelName,
        files: request.files || [],
        internetEnabled: request.internetEnabled,
        messageIndex: request.messageIndex
      }
    });
  }

  function send(): void {
    const text = input ? input.value.trim() : '';
    if (!text && pendingFiles.length === 0) return;
    const attachedFiles = pendingFiles.slice();
    const isQueued = sending;
    document.body.classList.remove('init');
    const welcome = document.querySelector('.welcome');
    if (welcome) welcome.remove();
    if (editingMessageIndex >= 0) {
      if (input) {
        input.value = '';
        input.style.height = 'auto';
      }
      if (!isQueued) {
        setSending(true);
        showLoader();
      }
      postQueuedRequest({
        kind: 'editMessage',
        messageIndex: editingMessageIndex,
        prompt: text || 'Update this message.',
        modelName: modelSel?.value || '',
        files: attachedFiles,
        internetEnabled: internetEnabled
      });
      pendingFiles = [];
      renderPreview();
      exitEditMode(false);
      return;
    }
    if (!isQueued) {
      const localMessageIndex = displayMessages.length;
      addMsg({ text: text, role: 'user', files: attachedFiles, feedback: null }, 'user', attachedFiles, localMessageIndex);
    }
    if (input) {
      input.value = '';
      input.style.height = 'auto';
    }
    if (!isQueued) {
      setSending(true);
      showLoader();
    }
    postQueuedRequest({
      kind: attachedFiles.length > 0 ? 'promptWithFile' : 'prompt',
      prompt: attachedFiles.length > 0 ? (text || 'Take a look at these files.') : text,
      modelName: modelSel?.value || '',
      files: attachedFiles,
      internetEnabled: internetEnabled
    });
    pendingFiles = [];
    renderPreview();
  }

  // Internet toggle is handled below via safeListen.

  input?.addEventListener('input', function() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 150) + 'px';
  });

  input?.addEventListener('compositionstart', function() {
    inputCompositionActive = true;
  });

  input?.addEventListener('compositionend', function() {
    inputCompositionActive = false;
  });

  input?.addEventListener('paste', function(event: ClipboardEvent) {
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
        appendAttachmentRecords([{ name: 'clipboard-image.png', type: file.type, data: base64, originalSize: file.size }]);
      };
      reader.readAsDataURL(file);
      return;
    }
  });

  // Attach button is handled below.

  // InjectLocalBtn is handled below.

  // FileInput is handled below.

  window.addEventListener('dragenter', function(event: DragEvent) {
    if (!canAcceptDropEvent(event)) {
      return;
    }
    acceptDropEvent(event);
    dragCounter++;
    setDropActive(true);
  }, true);

  window.addEventListener('dragover', function(event: DragEvent) {
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

  window.addEventListener('dragleave', function(event: DragEvent) {
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

  window.addEventListener('drop', function(event: DragEvent) {
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

  function safeListen(idOrEl: string | HTMLElement | null, event: string, handler: (ev: any) => any): void {
    const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
    if (el) el.addEventListener(event, handler);
  }

  safeListen(sendBtn, 'click', function() {
    log('[UI] Send button clicked (pendingFiles=' + pendingFiles.length + ', sending=' + sending + ')');
    send();
  });
  safeListen(modelSel, 'change', function() {
    const nextModel = modelSel?.value || '';
    log('[MODELS] User selected model: ' + nextModel);
    vscode.postMessage({ type: 'setDefaultModel', model: nextModel });
  });
  safeListen(input, 'keydown', function(event) {
    const keyboardEvent = event as KeyboardEvent;
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
  safeListen(newChatBtn, 'click', function() {
    log('[UI] New chat button (header) clicked → posting newChat');
    vscode.postMessage({ type: 'newChat' });
  });
  safeListen(newChatHistoryBtn, 'click', function() {
    log('[UI] New chat (from history) button clicked → posting newChat');
    vscode.postMessage({ type: 'newChat' });
    if (historyView) historyView.classList.remove('visible');
    if (input) input.focus();
  });
  safeListen(confirmDeleteBtn, 'click', function() {
    if (isBulkDelete) {
      log('[UI] Confirm clear all history clicked');
      vscode.postMessage({ type: 'deleteAllHistory' });
      historyItems = [];
      renderHistory(historyItems);
      hideDeleteModal();
    } else if (currentDeletingId) {
      log('[UI] Confirm delete clicked for: ' + currentDeletingId);
      vscode.postMessage({ type: 'deleteHistory', id: currentDeletingId });
      historyItems = historyItems.filter(function(item) { return item.id !== currentDeletingId; });
      renderHistory(historyItems);
      hideDeleteModal();
    }
  });
  safeListen(cancelDeleteBtn, 'click', function() {
    log('[UI] Cancel delete clicked');
    hideDeleteModal();
  });
  safeListen(settingsBtn, 'click', function() {
    log('[UI] Settings button clicked');
    vscode.postMessage({ type: 'openSettings' });
  });
  safeListen(brainBtn, 'click', function() {
    log('[UI] Brain sync button clicked');
    vscode.postMessage({ type: 'syncBrain' });
  });
  safeListen(stopBtn, 'click', function() {
    log('[UI] Stop button clicked → posting stopGeneration');
    vscode.postMessage({ type: 'stopGeneration' });
    hideLoader();
    finalizeStream('stopped');
  });
  safeListen(internetBtn, 'click', function() {
    internetEnabled = !internetEnabled;
    log('[UI] Live web mode toggled: ' + (internetEnabled ? 'ON' : 'OFF'));
    if (internetBtn) {
      internetBtn.classList.toggle('active', internetEnabled);
      internetBtn.title = 'Live web: ' + (internetEnabled ? 'ON' : 'OFF');
    }
    appendInfoMessage('🌐 Live web mode is now ' + (internetEnabled ? 'ON' : 'OFF') + '.');
  });
  safeListen(historyBtn, 'click', function() {
    const opening = historyView && !historyView.classList.contains('visible');
    log('[UI] History button clicked (opening=' + opening + ')');
    if (historyView) historyView.classList.toggle('visible');
    if (historyView && historyView.classList.contains('visible')) {
      vscode.postMessage({ type: 'getHistory' });
      if (historySearch) historySearch.focus();
    }
  });
  safeListen(closeHistoryBtn, 'click', function() {
    log('[UI] Close history button clicked');
    if (historyView) historyView.classList.remove('visible');
  });
  safeListen(clearAllHistoryBtn, 'click', function() {
    log('[UI] Clear all history button clicked');
    vscode.postMessage({ type: 'requestClearAllHistory' });
  });
  safeListen(injectLocalBtn, 'click', function() {
    if (pendingFiles.length === 0) {
      alert('Attach files first, then drop them into the vault.');
      return;
    }
    log('[UI] Inject local brain clicked (files=' + pendingFiles.length + ')');
    vscode.postMessage({ type: 'injectLocalBrain', files: pendingFiles });
    pendingFiles = [];
    renderPreview();
  });
  safeListen(attachBtn, 'click', function() {
    if (fileInput) fileInput.click();
  });
  safeListen(fileInput, 'change', function() {
    if (!fileInput) return;
    const count = (fileInput.files || []).length;
    log('[DROP] ' + count + ' file(s) selected via native picker');
    void appendPendingFiles(Array.from(fileInput.files || []), 'file-input', 'file-input-' + Date.now());
    fileInput.value = '';
  });
  safeListen(cancelEditBtn, 'click', function() {
    exitEditMode(true);
    pendingFiles = [];
    renderPreview();
    if (input) input.focus();
  });
  safeListen(historySearch, 'input', function() {
    renderHistory(historyItems);
  });

  window.addEventListener('message', function(event: MessageEvent) {
    const msg = event.data;
    if (msg.type !== 'streamChunk') {
      log('[MSG←] ' + msg.type + (msg.id ? ' id=' + msg.id : '') + (msg.value && typeof msg.value === 'string' ? ' len=' + msg.value.length : ''));
    }
    switch (msg.type) {
      case 'response':
        hideLoader();
        setSending(false);
        log('[STREAM] Response received (len=' + (msg.value || '').length + ')');
        addMsg(msg.message || { text: msg.value, role: 'ai', feedback: null }, 'ai', undefined, typeof msg.messageIndex === 'number' ? msg.messageIndex : -1);
        break;
      case 'error':
        log('[ERROR] Extension error: ' + msg.value, 'error');
        if (streamEl) {
          finalizeStream('stopped', undefined, -1);
        } else {
          hideLoader();
          setSending(false);
        }
        addMsg({ text: msg.value, role: 'error', feedback: null }, 'error', undefined, -1);
        break;
      case 'streamStart': {
        log('[STREAM] Stream started');
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
        chat?.appendChild(streamEl);
        if (chat) chat.scrollTop = chat.scrollHeight;
        if (thinkingBar) thinkingBar.classList.add('active');
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
        log('[STREAM] Stream ended (chunks=' + streamChunkCount + ', chars=' + streamRaw.length + ')');
        finalizeStream('done', msg.message || undefined, typeof msg.messageIndex === 'number' ? msg.messageIndex : -1);
        break;
      case 'stop':
        log('[MSG←] Stop signal received');
        finalizeStream('stopped', undefined, -1);
        break;
      case 'streamAbort':
        log('[STREAM] Stream aborted');
        finalizeStream('stopped', undefined, -1);
        break;
      case 'modelsList':
        if (modelSel) {
          modelSel.innerHTML = '';
          (msg.value as string[]).forEach(function(model) {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            modelSel.appendChild(option);
          });
          if (msg.selectedModel) {
            if (!Array.from(modelSel.options).some(function(option) { return option.value === msg.selectedModel; })) {
              const option = document.createElement('option');
              option.value = msg.selectedModel;
              option.textContent = msg.selectedModel;
              modelSel.appendChild(option);
            }
            modelSel.value = msg.selectedModel;
          }
        }
        log('[MODELS] Loaded ' + msg.value.length + ' model(s): ' + msg.value.join(', '));
        break;
      case 'clearChat':
        log('[RESET] clearChat received — resetting all UI state (streamEl=' + !!streamEl + ', sending=' + sending + ')');
        if (streamEl) {
          log('[RESET] Aborting active stream before reset');
          resetStreamRefs();
        }
        hideLoader();
        setSending(false);
        document.body.classList.add('init');
        if (chat) chat.innerHTML = welcomeMarkup();
        displayMessages = [];
        pendingFiles = [];
        exitEditMode(true);
        renderPreview();
        renderQueuePanel();
        if (input) {
          input.value = '';
          input.style.height = 'auto';
        }
        internetEnabled = false;
        if (internetBtn) {
          internetBtn.classList.remove('active');
          internetBtn.title = 'Live web: OFF';
        }
        log('[RESET] Chat UI fully reset — new thread ready');
        setTimeout(function() { if (input) input.focus(); }, 50);
        break;
      case 'restoreMessages':
        if (chat) chat.innerHTML = '';
        exitEditMode(true);
        displayMessages = msg.value || [];
        if (msg.value && msg.value.length > 0) {
          log('[RESTORE] Restoring ' + msg.value.length + ' display message(s)');
          document.body.classList.remove('init');
          (msg.value as Message[]).forEach(function(item, index) {
            addMsg(item, item.role, item.files, index);
          });
        } else {
          log('[RESTORE] No messages to restore — showing welcome screen');
          document.body.classList.add('init');
          if (chat) chat.innerHTML = welcomeMarkup();
        }
        renderQueuePanel();
        break;
      case 'focusInput':
        log('[UI] focusInput received');
        if (input) input.focus();
        break;
      case 'injectPrompt':
        log('[UI] injectPrompt received (len=' + (msg.value || '').length + ')');
        if (input) {
          input.value = msg.value;
          input.style.height = 'auto';
          input.style.height = Math.min(input.scrollHeight, 150) + 'px';
        }
        send();
        break;
      case 'editQueuedRequest': {
        const draft = (msg.value || {}) as QueueDraftPayload;
        if (input) {
          input.value = draft.prompt || '';
          input.style.height = 'auto';
          input.style.height = Math.min(input.scrollHeight, 150) + 'px';
        }
        pendingFiles = (draft.files || []).map(function(file) { return { ...file }; });
        renderPreview();
        internetEnabled = Boolean(draft.internetEnabled);
        if (internetBtn) {
          internetBtn.classList.toggle('active', internetEnabled);
          internetBtn.title = 'Live web: ' + (internetEnabled ? 'ON' : 'OFF');
        }
        if (modelSel && draft.modelName) {
          if (!Array.from(modelSel.options).some(function(option) { return option.value === draft.modelName; })) {
            const option = document.createElement('option');
            option.value = draft.modelName;
            option.textContent = draft.modelName;
            modelSel.appendChild(option);
          }
          modelSel.value = draft.modelName;
        }
        if (draft.kind === 'editMessage' && typeof draft.messageIndex === 'number' && draft.messageIndex >= 0) {
          editingMessageIndex = draft.messageIndex;
          if (editBanner) editBanner.hidden = false;
          if (editBannerLabel) editBannerLabel.textContent = 'Editing queued request from an earlier message';
        } else {
          exitEditMode(false);
        }
        appendInfoMessage('✏️ Queued request moved back into the composer for editing.');
        setTimeout(function() { if (input) input.focus(); }, 50);
        break;
      }
      case 'queuedRequestStarting':
        document.body.classList.remove('init');
        if (chat && chat.querySelector('.welcome')) {
          chat.innerHTML = '';
        }
        addMsg({
          text: msg.value?.prompt || '',
          role: 'user',
          files: msg.value?.files || [],
          feedback: null
        }, 'user', msg.value?.files || [], displayMessages.length);
        showLoader();
        break;
      case 'historyList':
        historyItems = msg.value || [];
        log('[HISTORY] Received ' + historyItems.length + ' history item(s)');
        renderHistory(historyItems);
        break;
      case 'requestDeleteHistory':
        log('[UI] requestDeleteHistory received for: ' + msg.id);
        showDeleteModal(msg.id, msg.title);
        break;
      case 'requestClearAllHistory':
        log('[UI] requestClearAllHistory received');
        showClearAllModal();
        break;
      case 'historyLoaded':
        log('[HISTORY] Session loaded: ' + msg.id);
        break;
      case 'queueState':
        queueState = (msg.value || { running: false, paused: false, pendingRequests: [] }) as QueueStatePayload;
        setSending(Boolean(queueState.running));
        renderQueuePanel();
        if (queueState.paused && !lastQueuePaused) {
          const waiting = queueState.pendingRequests.length;
          appendInfoMessage(waiting > 0
            ? '⏸ Generation stopped. The queue is paused with ' + waiting + ' waiting request' + (waiting === 1 ? '' : 's') + '.'
            : '⏸ Generation stopped. The queue is paused until you resume it.');
        } else if (!queueState.paused && lastQueuePaused) {
          appendInfoMessage(queueState.running
            ? '▶ Queue resumed. Running the next request now.'
            : '▶ Queue resumed.');
        }
        lastQueuePaused = queueState.paused;
        break;
      case 'fetchedUris':
        log('[DROP] Fetched ' + (msg.files || []).length + ' URI attachment(s)');
        appendAttachmentRecords(msg.files || []);
        break;
      case 'injectAttachment':
        appendAttachmentRecords([msg.value]);
        break;
      case 'workspaceFilesList':
        workspaceFiles = new Set(msg.value || []);
        log('[FILES] Synchronized ' + workspaceFiles.size + ' workspace file path(s)');
        rerenderDisplayedMessages();
        if (streamPreviewEl && streamRaw) {
          streamPreviewEl.innerHTML = fmt(streamRaw);
        }
        break;
      default:
        log('[MSG←] Unhandled message type: ' + msg.type, 'error');
    }
  });

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
