import { scoreFileSuggestion } from './file-refs';

type SuggestKind = 'slash' | 'mention';

interface SuggestItem {
  label: string;
  detail: string;
  insertText: string;
  kind: SuggestKind;
}

export interface InputSuggestEls {
  inputSuggest: HTMLElement | null;
  input: HTMLTextAreaElement | null;
}

export interface InputSuggestState {
  workspaceFiles: Set<string>;
}

export interface InputSuggestDeps {
  els: InputSuggestEls;
  state: InputSuggestState;
  postMessage: (msg: any) => void;
}

const SLASH_COMMANDS: SuggestItem[] = [
  { kind: 'slash', label: '/agent', detail: 'Switch to autonomous agent mode', insertText: '/agent' },
  { kind: 'slash', label: '/plan', detail: 'Switch to planning mode', insertText: '/plan' },
  { kind: 'slash', label: '/default', detail: 'Switch to default mode', insertText: '/default' },
  { kind: 'slash', label: '/approve', detail: 'Approve the current plan and run', insertText: '/approve' },
  { kind: 'slash', label: '/run-plan', detail: 'Approve the current plan and run', insertText: '/run-plan' },
  { kind: 'slash', label: '/list_mcp_tools', detail: 'Ask the agent to list available MCP tools', insertText: '/list_mcp_tools' }
];

export function createInputSuggest(deps: InputSuggestDeps) {
  const { els, state, postMessage } = deps;
  const { inputSuggest, input } = els;

  let suggestItems: SuggestItem[] = [];
  let suggestSelectedIndex = 0;
  let suggestTrigger: { kind: SuggestKind; start: number; end: number } | null = null;

  function hideInputSuggest(): void {
    suggestItems = [];
    suggestSelectedIndex = 0;
    suggestTrigger = null;
    if (inputSuggest) {
      inputSuggest.hidden = true;
      inputSuggest.innerHTML = '';
    }
  }

  function getActiveSuggestTrigger(): { kind: SuggestKind; query: string; start: number; end: number } | null {
    if (!input) return null;
    const caret = input.selectionStart ?? 0;
    const before = input.value.slice(0, caret);
    const match = before.match(/(^|[\s([{])([/@])(\S*)$/);
    if (!match) return null;
    const token = match[2];
    const query = match[3] || '';
    if (token === '/' && query.includes('/')) return null;
    const start = caret - token.length - query.length;
    return {
      kind: token === '/' ? 'slash' : 'mention',
      query,
      start,
      end: caret
    };
  }

  function buildSuggestItems(kind: SuggestKind, query: string): SuggestItem[] {
    if (kind === 'slash') {
      const q = query.toLowerCase();
      return SLASH_COMMANDS
        .filter(function(item) {
          return item.label.toLowerCase().includes(q) || item.detail.toLowerCase().includes(q);
        })
        .slice(0, 8);
    }

    return Array.from(state.workspaceFiles)
      .map(function(filePath) {
        return { filePath, score: scoreFileSuggestion(filePath, query) };
      })
      .filter(function(item) { return item.score < 9999; })
      .sort(function(a, b) {
        return a.score - b.score || a.filePath.length - b.filePath.length || a.filePath.localeCompare(b.filePath);
      })
      .slice(0, 12)
      .map(function(item) {
        const name = item.filePath.split('/').pop() || item.filePath;
        return {
          kind: 'mention',
          label: name,
          detail: item.filePath,
          insertText: '@' + item.filePath
        };
      });
  }

  function renderInputSuggest(): void {
    if (!inputSuggest) return;
    const trigger = getActiveSuggestTrigger();
    if (!trigger) {
      hideInputSuggest();
      return;
    }

    const items = buildSuggestItems(trigger.kind, trigger.query);
    if (items.length === 0) {
      hideInputSuggest();
      return;
    }

    suggestTrigger = { kind: trigger.kind, start: trigger.start, end: trigger.end };
    suggestItems = items;
    suggestSelectedIndex = Math.min(suggestSelectedIndex, suggestItems.length - 1);
    inputSuggest.innerHTML = '';
    inputSuggest.hidden = false;
    inputSuggest.dataset.kind = trigger.kind;

    suggestItems.forEach(function(item, index) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'input-suggest-row' + (index === suggestSelectedIndex ? ' active' : '');
      row.dataset.index = String(index);
      const icon = document.createElement('span');
      icon.className = 'input-suggest-icon';
      icon.textContent = item.kind === 'slash' ? '/' : '@';
      const copy = document.createElement('span');
      copy.className = 'input-suggest-copy';
      const label = document.createElement('span');
      label.className = 'input-suggest-label';
      label.textContent = item.label;
      const detail = document.createElement('span');
      detail.className = 'input-suggest-detail';
      detail.textContent = item.detail;
      copy.appendChild(label);
      copy.appendChild(detail);
      row.appendChild(icon);
      row.appendChild(copy);
      row.addEventListener('mouseenter', function() {
        suggestSelectedIndex = index;
        renderInputSuggest();
      });
      row.addEventListener('mousedown', function(event) {
        event.preventDefault();
        acceptInputSuggest(index);
      });
      inputSuggest.appendChild(row);
    });
  }

  function acceptInputSuggest(index = suggestSelectedIndex): boolean {
    if (!input || !suggestTrigger || suggestItems.length === 0) return false;
    const item = suggestItems[Math.max(0, Math.min(index, suggestItems.length - 1))];
    const before = input.value.slice(0, suggestTrigger.start);
    const after = input.value.slice(suggestTrigger.end);
    const suffix = after.startsWith(' ') || after.startsWith('\n') || after.length === 0 ? '' : ' ';
    input.value = before + item.insertText + suffix + after;
    const nextCaret = (before + item.insertText + suffix).length;
    input.selectionStart = nextCaret;
    input.selectionEnd = nextCaret;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 150) + 'px';
    hideInputSuggest();
    input.focus();
    // If this was an @ mention, send fetchFileContent to read and attach the file
    if (item.kind === 'mention') {
      const filePath = item.detail;
      postMessage({
        type: 'fetchFileContent',
        requestId: 'mention-' + Date.now(),
        path: filePath
      });
    }
    return true;
  }

  return {
    get suggestItems() { return suggestItems; },
    get suggestSelectedIndex() { return suggestSelectedIndex; },
    set suggestSelectedIndex(value: number) { suggestSelectedIndex = value; },
    hideInputSuggest,
    renderInputSuggest,
    acceptInputSuggest
  };
}
