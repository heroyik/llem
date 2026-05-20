import { esc } from './strings';
import { queueKindLabel, queuePromptPreview, type QueueRequestSummary } from './queue-helpers';

export type QueueRequestKind = 'prompt' | 'promptWithFile' | 'editMessage' | 'regenerate';

export interface QueueStatePayload {
  running: boolean;
  paused: boolean;
  activeRequest?: QueueRequestSummary;
  pendingRequests: QueueRequestSummary[];
}

export interface QueueManagerDeps {
  els: {
    queuePanel: HTMLElement | null;
  };
  postMessage: (msg: any) => void;
  log: (message: any, level?: string) => void;
}

export function createQueueManager(deps: QueueManagerDeps) {
  const { els, postMessage, log } = deps;
  const { queuePanel } = els;

  let queueState: QueueStatePayload = { running: false, paused: false, pendingRequests: [] };
  let lastQueuePaused = false;

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
      '<div class=\"queue-item queue-item-active\">',
      '<div class=\"queue-copy\">',
      '<div class=\"queue-kind\">Running now</div>',
      '<div class=\"queue-text\">' + esc(queuePromptPreview(active)) + '</div>',
      '<div class=\"queue-submeta\">' + esc(queueKindLabel(active.kind) + ' · ' + (active.modelName || 'default model') + (active.attachmentCount ? ' · ' + active.attachmentCount + ' file' + (active.attachmentCount === 1 ? '' : 's') : '')) + '</div>',
      '</div>',
      '<div class=\"queue-actions\"><span class=\"queue-meta\">Live output</span></div>',
      '</div>'
    ].join('') : '';

    const pendingHtml = pending.map(function(request) {
      const index = pending.findIndex(function(item) { return item.id === request.id; });
      const moveUpBtn = index > 0
        ? '<button class=\"queue-btn\" data-action=\"move-queued-request\" data-direction=\"up\" data-queue-id=\"' + esc(request.id) + '\" title=\"Move up\">↑</button>'
        : '';
      const moveDownBtn = index < pending.length - 1
        ? '<button class=\"queue-btn\" data-action=\"move-queued-request\" data-direction=\"down\" data-queue-id=\"' + esc(request.id) + '\" title=\"Move down\">↓</button>'
        : '';
      const editBtn = '<button class=\"queue-btn\" data-action=\"edit-queued-request\" data-queue-id=\"' + esc(request.id) + '\" title=\"Edit queued request\">Edit</button>';
      
      const now = Date.now();
      const isCooldown = request.scheduledAt && request.scheduledAt > now;
      const cooldownClass = isCooldown ? ' queue-item-cooldown' : '';
      const retryLabel = request.retryCount ? ' (Retry ' + request.retryCount + '/3)' : '';
      
      let cooldownText = '';
      if (isCooldown) {
        const secs = Math.ceil((request.scheduledAt! - now) / 1000);
        cooldownText = ' · <span class=\"cooldown-timer\">Retrying in ' + secs + 's</span>';
      }

      return [
        '<div class=\"queue-item' + cooldownClass + '\" data-queue-id=\"' + esc(request.id) + '\">',
        '<div class=\"queue-copy\">',
        '<div class=\"queue-kind\">' + esc(queueKindLabel(request.kind)) + retryLabel + '</div>',
        '<div class=\"queue-text\">' + esc(queuePromptPreview(request)) + '</div>',
        '<div class=\"queue-submeta\">' + esc((request.modelName || 'default model') + (request.attachmentCount ? ' · ' + request.attachmentCount + ' file' + (request.attachmentCount === 1 ? '' : 's') : '') + (request.internetEnabled ? ' · Live web' : '')) + cooldownText + '</div>',
        '</div>',
        '<div class=\"queue-actions\">' + moveUpBtn + moveDownBtn + editBtn + '<button class=\"queue-btn queue-btn-danger\" data-action=\"cancel-queued-request\" data-queue-id=\"' + esc(request.id) + '\">Cancel</button></div>',
        '</div>'
      ].join('');
    }).join('');

    const clearAll = pending.length > 1
      ? '<button class=\"queue-btn\" data-action=\"clear-queued-requests\">Clear queue</button>'
      : '';
    const resumeBtn = queueState.paused
      ? '<button class=\"queue-btn\" data-action=\"resume-queue\">Resume</button>'
      : '';
    const statusText = queueState.running
      ? 'Active request running'
      : (queueState.paused ? 'Queue paused' : 'Waiting');

    queuePanel.innerHTML = [
      '<div class=\"queue-head\">',
      '<div><div class=\"queue-title\">Request queue</div><div class=\"queue-meta\">' + total + ' total · ' + pending.length + ' waiting · ' + statusText + '</div></div>',
      '<div class=\"queue-actions\">' + resumeBtn + clearAll + '</div>',
      '</div>',
      '<div class=\"queue-list\">',
      activeHtml,
      pendingHtml,
      '</div>'
    ].join('');
  }

  function postQueuedRequest(request: {
    kind: QueueRequestKind;
    prompt: string;
    modelName: string;
    files?: any[];
    internetEnabled?: boolean;
    messageIndex?: number;
  }): void {
    postMessage({
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

  return {
    get queueState() { return queueState; },
    set queueState(value: QueueStatePayload) { queueState = value; },
    get lastQueuePaused() { return lastQueuePaused; },
    set lastQueuePaused(value: boolean) { lastQueuePaused = value; },
    renderQueuePanel,
    postQueuedRequest
  };
}
