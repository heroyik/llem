import { type Message } from './types';

import { formatElapsed, fileNameFromPath, generateCompletionSummary, formatMcpToolLabel } from './format';
import { smoothCollapseElement, smoothExpandElement } from './animations';
import { ACTION_HEADLINE_MAP, collectStreamActions, extractActionHeadline } from './stream-actions';

export interface StreamHandlerEls {
  chat: HTMLElement | null;
  thinkingBar: HTMLElement | null;
  sendBtn: HTMLElement | null;
  stopBtn: HTMLElement | null;
  input: HTMLTextAreaElement | null;
}

export interface StreamHandlerDeps {
  els: StreamHandlerEls;
  state: {
    displayMessages: Message[];
  };
  postMessage: (msg: any) => void;
  log: (message: any, level?: string) => void;
  getTime: () => string;
  fmt: (text: string) => string;
  openTerminal: () => void;
  renderMessageActions: (message: Message, messageIndex: number, time: string) => HTMLElement | null;
}

interface StreamStep {
  type: string;
  icon: string;
  label: string;
  path?: string;
  startedAt: number;
  completedAt?: number;
}

export function createStreamHandler(deps: StreamHandlerDeps) {
  const { els, state, postMessage, log, getTime, fmt, openTerminal, renderMessageActions } = deps;

  // ── State ──

  let loader: HTMLElement | null = null;
  let _sending = false;
  let streamEl: HTMLElement | null = null;
  let streamRaw = '';
  let streamStatusEl: HTMLElement | null = null;
  let streamStatusTitleEl: HTMLElement | null = null;
  let streamElapsedEl: HTMLElement | null = null;
  let streamStartedAt = 0;
  let streamChunkCount = 0;
  let activeMcpToolLabel = '';
  let lastStreamRaw = '';
  let streamStopReason = '';
  let streamElapsedTimer: ReturnType<typeof setInterval> | null = null;
  let streamSteps: StreamStep[] = [];
  let streamActionLinesEl: HTMLElement | null = null;
  let streamActionLinesExpanded = false;
  let lastActionCount = 0;

  // ── Loader / Sending ──

  function showLoader(): void {
    loader = document.createElement('div');
    loader.className = 'msg';
    loader.innerHTML = '<div class="msg-head"><div class="av av-user">You</div><span>You</span><span class="msg-time">' + getTime() + '</span></div><div class="msg-body msg-body-muted">Cooking up a reply...</div>';
    if (els.chat) {
      els.chat.appendChild(loader);
      els.chat.scrollTop = els.chat.scrollHeight;
    }
    if (els.thinkingBar) els.thinkingBar.classList.add('active');
  }

  function hideLoader(): void {
    if (loader && loader.parentNode) {
      loader.parentNode.removeChild(loader);
    }
    loader = null;
    if (els.thinkingBar) els.thinkingBar.classList.remove('active');
  }

  function setSending(value: boolean): void {
    _sending = value;
    if (els.sendBtn) {
      (els.sendBtn as HTMLButtonElement).disabled = false;
      els.sendBtn.classList.remove('hidden');
    }
    if (els.stopBtn) els.stopBtn.classList.toggle('visible', value);
    if (!value) {
      if (els.input) els.input.focus();
      if (els.thinkingBar) els.thinkingBar.classList.remove('active');
    }
  }

  // ── Stream helpers ──

  function updateStreamElapsed(): void {
    if (!streamElapsedEl) return;
    streamElapsedEl.textContent = '⏱ ' + formatElapsed(Date.now() - streamStartedAt);
  }

  function resetStreamRefs(): void {
    streamEl = null;
    streamRaw = '';
    streamStatusEl = null;
    streamStatusTitleEl = null;
    streamElapsedEl = null;
    streamStartedAt = 0;
    streamChunkCount = 0;
    activeMcpToolLabel = '';
    streamStopReason = '';
    if (streamElapsedTimer) { clearInterval(streamElapsedTimer); streamElapsedTimer = null; }
    streamSteps = [];
    streamActionLinesEl = null;
    streamActionLinesExpanded = false;
    lastActionCount = 0;
    // Smoothly collapse any leftover details panel from previous stream
    const oldDetails = document.querySelector('.stream-details') as HTMLElement | null;
    if (oldDetails) {
      if (!oldDetails.classList.contains('collapsed')) {
        smoothCollapseElement(oldDetails);
      } else {
        oldDetails.remove();
      }
    }
  }

  function setMcpToolStatus(msg: any): void {
    const label = formatMcpToolLabel(String(msg.server || ''), String(msg.tool || ''));
    if (msg.state === 'running') {
      activeMcpToolLabel = label;
      if (streamStatusEl) streamStatusEl.className = 'stream-status live mcp-active';
      if (streamStatusTitleEl) streamStatusTitleEl.textContent = '🔌 ' + label;
      updateStreamElapsed();
      return;
    }

    if (activeMcpToolLabel === label) {
      activeMcpToolLabel = '';
    }
    if (streamStatusEl && streamStatusEl.classList.contains('mcp-active')) {
      streamStatusEl.className = streamRaw.length > 0 ? 'stream-status live' : 'stream-status pending';
    }
    if (streamStatusTitleEl) {
      renderHeadlineStream();
    }
    updateStreamElapsed();
  }

  function appendRegenButton(target: HTMLElement | null): void {
    if (!target || target.querySelector('.regen-btn')) return;
    const button = document.createElement('button');
    button.className = 'regen-btn';
    button.innerHTML = '↻ Regenerate reply';
    button.addEventListener('click', function() {
      button.remove();
      removeLastAiMessageFromView();
      postMessage({ type: 'regenerate' });
      showLoader();
      setSending(true);
    });
    target.appendChild(button);
  }

  function removeLastAiMessageFromView(): void {
    if (state.displayMessages.length > 0 && state.displayMessages[state.displayMessages.length - 1]?.role === 'ai') {
      state.displayMessages.pop();
    }

    if (!els.chat) {
      return;
    }

    const messages = Array.from(els.chat.querySelectorAll('.msg-ai'));
    const lastAiMessage = messages[messages.length - 1];
    if (lastAiMessage && lastAiMessage.parentNode) {
      lastAiMessage.parentNode.removeChild(lastAiMessage);
    }
  }

  // ── Stream action tracking ──

  function recordStreamSteps(): void {
    const actions = collectStreamActions(streamRaw);
    // Process only newly discovered actions (sequential cursor approach)
    for (let i = streamSteps.length; i < actions.length; i++) {
      const action = actions[i];
      const entry = ACTION_HEADLINE_MAP[action.type];
      streamSteps.push({
        type: action.type,
        icon: entry ? entry.icon : '⚡',
        label: entry ? entry.label : action.type,
        path: action.path,
        startedAt: Date.now()
      });
    }
    // Keep max 20 steps (after loop to avoid cursor misalignment)
    if (streamSteps.length > 20) {
      streamSteps = streamSteps.slice(-20);
    }

    // Mark closed tags as completed
    for (let i = 0; i < streamSteps.length; i++) {
      const step = streamSteps[i];
      if (step.completedAt) continue;
      const closeTag = '</' + step.type + '>';
      // Check self-closing syntax with regex to handle attributes (e.g., <delete_file path="x" />)
      const selfClosePattern = '<' + step.type + '\\b[^>]*/>';
      const selfCloseRegex = new RegExp(selfClosePattern, 'i');
      if (streamRaw.indexOf(closeTag) >= 0 || selfCloseRegex.test(streamRaw)) {
        step.completedAt = Date.now();
      }
    }
  }

  function renderStreamActionLines(): void {
    if (!streamActionLinesEl) return;
    if (streamSteps.length === 0) {
      streamActionLinesEl.innerHTML = '';
      lastActionCount = 0;
      return;
    }

    // Auto-expand when new steps arrive
    if (streamSteps.length > lastActionCount) {
      streamActionLinesExpanded = true;
    }
    lastActionCount = streamSteps.length;

    const lines: string[] = [];
    for (let i = 0; i < streamSteps.length; i++) {
      const step = streamSteps[i];
      const isLatest = i === streamSteps.length - 1;
      const isCompleted = !!step.completedAt;

      let cls: string;
      let icon: string;
      if (isCompleted) {
        cls = 'stream-action-line done';
        icon = '✅';
      } else if (isLatest) {
        cls = 'stream-action-line live';
        icon = step.icon;
      } else {
        cls = 'stream-action-line pending';
        icon = step.icon;
      }

      const name = step.path ? fileNameFromPath(step.path) : '';
      const text = name ? step.label + ' ' + name : step.label;
      lines.push('<div class="' + cls + '"><span class="sal-icon">' + icon + '</span><span class="sal-text">' + text + '</span></div>');
    }

    // Count badge
    const completedCount = streamSteps.filter(function(s) { return s.completedAt; }).length;
    const badgeText = completedCount + '/' + streamSteps.length + ' done';

    // Chevron
    const chevron = streamActionLinesExpanded ? '▼' : '▶';

    streamActionLinesEl.innerHTML =
      '<div class="sal-header">' +
        '<span class="sal-chevron">' + chevron + '</span>' +
        '<span class="sal-head-label">Actions</span>' +
        '<span class="sal-badge">' + badgeText + '</span>' +
      '</div>' +
      '<div class="sal-body">' +
        lines.join('') +
      '</div>';

    // Handle initial expanded/collapsed state with smooth height transition
    const bodyEl = streamActionLinesEl.querySelector('.sal-body') as HTMLElement | null;
    if (bodyEl) {
      if (streamActionLinesExpanded) {
        smoothExpandElement(bodyEl, 'collapsed', { useRaf: false });
      } else {
        bodyEl.classList.add('collapsed');
      }
    }

    // Attach toggle click handler with smooth height animation
    const headerEl = streamActionLinesEl.querySelector('.sal-header');
    if (headerEl) {
      headerEl.addEventListener('click', function() {
        streamActionLinesExpanded = !streamActionLinesExpanded;
        const b = streamActionLinesEl!.querySelector('.sal-body') as HTMLElement | null;
        if (!b) return;

        if (streamActionLinesExpanded) {
          smoothExpandElement(b, 'collapsed', { useRaf: false });
        } else {
          smoothCollapseElement(b, 'collapsed', false);
        }
        // Update chevron immediately
        const chevronEl = streamActionLinesEl!.querySelector('.sal-chevron');
        if (chevronEl) {
          chevronEl.textContent = streamActionLinesExpanded ? '▼' : '▶';
        }
      });
    }
  }

  function renderHeadlineStream(): void {
    if (activeMcpToolLabel) {
      if (streamStatusTitleEl) streamStatusTitleEl.textContent = '🔌 ' + activeMcpToolLabel;
      if (streamStatusEl) streamStatusEl.className = 'stream-status mcp-active';
      return;
    }

    if (streamRaw.length === 0) {
      if (streamStatusTitleEl) streamStatusTitleEl.textContent = '🤔 Thinking...';
      if (streamStatusEl) streamStatusEl.className = 'stream-status pending';
      return;
    }

    recordStreamSteps();
    renderStreamActionLines();

    const headline = extractActionHeadline(streamRaw);
    if (headline) {
      if (streamStatusTitleEl) streamStatusTitleEl.textContent = headline;
      if (streamStatusEl) streamStatusEl.className = 'stream-status live';
    } else {
      if (streamStatusTitleEl) streamStatusTitleEl.textContent = '⏳ Generating...';
      if (streamStatusEl) streamStatusEl.className = 'stream-status live';
    }

    updateStreamElapsed();
    if (els.chat) els.chat.scrollTop = els.chat.scrollHeight;
  }

  // ── Details panel ──

  function sanitizeAssistantDisplayText(text: string): string {
    if (!text) return '';

    let value = String(text)
      .replace(/<(?:create_file|file|edit_file|edit|run_command|command|bash|terminal|read_url|url|fetch_url|read_brain|read_vault|call_mcp_tool|call:[a-z_]+)\b[\s\S]*?<\/(?:create_file|file|edit_file|edit|run_command|command|bash|terminal|read_url|url|fetch_url|read_brain|read_vault|call_mcp_tool|call:[a-z_]+)>/gi, '')
      .replace(/<(?:delete_file|delete|read_file|read|list_files|list_dir|ls|call:delete_file|call:delete|call:read_file|call:read|call:list_files|call:list_dir|call:ls)\b[^>]*\/?>/gi, '')
      .replace(/<\/?(?:create_file|file|edit_file|edit|delete_file|delete|read_file|read|list_files|list_dir|ls|run_command|command|bash|terminal|read_url|url|fetch_url|read_brain|read_vault|list_mcp_tools|call_mcp_tool|call:[a-z_]+)\b[^>]*>/gi, '')
      .replace(/<\/?(?:find|replace)\b[^>]*>/gi, '')
      .replace(/<(?:create_file|file|edit_file|edit|run_command|command|bash|terminal|read_url|url|fetch_url|read_brain|read_vault|call_mcp_tool|call:[a-z_]+)\b[^>]*>[\s\S]*$/gi, '');

    value = value
      .split('\n')
      .filter(line => !/^\s*\(?\s*(?:wait(?:[,!]|)|let(?:'|’)?s)\s+.*(?:\brefine\b|\breplace block\b|\bclean pass\b|\bworks perfectly\b|\bdynamic mapping\b|\buser(?:'|’)?s environment\b|provided\s+\w+\s+structure|[a-z0-9_/.-]+\.(?:ts|tsx|js|jsx|py|java|go|rs|rb|php|cs|json|md))[\s\S]*\)?\s*$/i.test(line.trim()))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');

    return value.trim();
  }

  function toggleStreamDetails(): void {
    const shell = document.querySelector('.stream-shell');
    if (!shell) return;

    const discEl = document.querySelector('.stream-title .disclosure');
    const existing = shell.parentElement?.querySelector('.stream-details') as HTMLElement | null;

    if (existing) {
      if (!existing.classList.contains('collapsed')) {
        // Collapse with smooth animation
        if (discEl) discEl.classList.remove('open');
        smoothCollapseElement(existing);
      } else {
        // Expand with smooth animation
        const raw = lastStreamRaw || '';
        if (raw) {
          const sanitized = sanitizeAssistantDisplayText(raw);
          if (sanitized) existing.innerHTML = fmt(sanitized);
        }
        existing.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        smoothExpandElement(existing, 'collapsed', {
          onExpand: function() { if (discEl) discEl.classList.add('open'); }
        });
      }
      return;
    }

    const raw = lastStreamRaw || '';
    if (!raw) return;

    const sanitized = sanitizeAssistantDisplayText(raw);
    if (!sanitized) return;

    const details = document.createElement('div');
    details.className = 'stream-details collapsed';
    details.innerHTML = fmt(sanitized);

    shell.after(details);
    details.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Expand with smooth animation
    smoothExpandElement(details, 'collapsed', {
      onExpand: function() { if (discEl) discEl.classList.add('open'); }
    });
  }

  // ── Finalization ──

  function finalizeStream(streamState: 'done' | 'stopped', message?: Message, messageIndex?: number, stopReason?: string): void {
    hideLoader();
    if (!streamEl) {
      setSending(false);
      resetStreamRefs();
      return;
    }
    // Mark all uncompleted steps as done and render final action lines
    for (let i = 0; i < streamSteps.length; i++) {
      if (!streamSteps[i].completedAt) {
        streamSteps[i].completedAt = Date.now();
      }
    }
    renderStreamActionLines();
    renderHeadlineStream();
    if (stopReason) streamStopReason = stopReason;
    if (streamStatusEl) streamStatusEl.className = 'stream-status ' + streamState;
    if (streamStatusTitleEl) {
      if (streamState === 'done') {
        const summary = generateCompletionSummary(streamRaw);
        streamStatusTitleEl.innerHTML = summary + ' <span class="disclosure">▶</span>';
      } else {
        if (streamStopReason === 'repetition_detected' || streamStopReason === 'watchdog_loop') {
          streamStatusTitleEl.innerHTML = '⚠️ 반복 출력 감지, 중단됨 <span class="disclosure">▶</span>';
        } else {
          streamStatusTitleEl.innerHTML = '⏹ Generation stopped <span class="disclosure">▶</span>';
        }
      }
    }
    updateStreamElapsed();

    // Save raw text for details panel
    lastStreamRaw = streamRaw;

    // Remove any leftover details panel from previous stream
    const oldDetails = streamEl.parentElement?.querySelector('.stream-details');
    if (oldDetails) oldDetails.remove();

    // Add click-to-expand on stream status
    if (streamStatusEl) {
      const statusEl = streamStatusEl;
      // Remove any old listener by cloning
      const newStatus = statusEl.cloneNode(true) as HTMLElement;
      statusEl.parentNode?.replaceChild(newStatus, statusEl);
      streamStatusEl = newStatus;
      streamStatusTitleEl = newStatus.querySelector('.stream-title');
      streamStatusEl.addEventListener('click', function() {
        toggleStreamDetails();
      });
    }

    if (streamState === 'done') {
      const isIndexValid = typeof messageIndex === 'number' && messageIndex >= 0;
      if (isIndexValid) {
        state.displayMessages[messageIndex!] = message || { role: 'ai', text: streamRaw, feedback: null };
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

  // ── Stream start ──

  function startStream(): void {
    hideLoader();
    resetStreamRefs();
    streamStartedAt = Date.now();
    streamElapsedTimer = setInterval(function() { updateStreamElapsed(); }, 1000);
    streamEl = document.createElement('div');
    streamEl.className = 'msg msg-ai';
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
    streamStatusTitleEl.textContent = '🤔 Thinking...';
    streamElapsedEl = document.createElement('span');
    streamElapsedEl.className = 'stream-elapsed';
    streamStatusEl.appendChild(dot);
    streamStatusEl.appendChild(streamStatusTitleEl);
    streamStatusEl.appendChild(streamElapsedEl);
    shell.appendChild(streamStatusEl);
    body.appendChild(shell);
    streamActionLinesEl = document.createElement('div');
    streamActionLinesEl.className = 'stream-action-lines';
    body.appendChild(streamActionLinesEl);
    streamEl.appendChild(head);
    streamEl.appendChild(body);
    if (els.chat) {
      els.chat.appendChild(streamEl);
      els.chat.scrollTop = els.chat.scrollHeight;
    }
    if (els.thinkingBar) els.thinkingBar.classList.add('active');
  }

  function handleStreamChunk(value: string): void {
    streamRaw += value || '';
    if (value) streamChunkCount += 1;
    if (streamStatusEl) streamStatusEl.className = 'stream-status live';
    renderHeadlineStream();
  }

  // ── Public API ──

  return {
    state,
    get sending() { return _sending; },
    setSending,
    showLoader,
    hideLoader,
    resetStreamRefs,
    finalizeStream,
    setMcpToolStatus,
    renderHeadlineStream,
    startStream,
    handleStreamChunk
  };
}
