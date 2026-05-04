import test from 'node:test';
import assert from 'node:assert/strict';
import { routeWebviewMessage } from '../out-test/webviewMessageRouter.js';

function createHost() {
  const calls = [];
  const host = {
    handleBrainMenu: async () => { calls.push(['handleBrainMenu']); },
    handleInjectLocalBrain: async (files) => { calls.push(['handleInjectLocalBrain', files]); },
    handleSettingsMenu: async () => { calls.push(['handleSettingsMenu']); },
    resetChat: async () => { calls.push(['resetChat']); },
    restoreDisplayMessages: async () => { calls.push(['restoreDisplayMessages']); },
    sendModels: async () => { calls.push(['sendModels']); },
    showBrainNetwork: () => { calls.push(['showBrainNetwork']); },
    showTerminal: () => { calls.push(['showTerminal']); },
    stopGeneration: () => { calls.push(['stopGeneration']); },
    openExternalUrl: async (url) => { calls.push(['openExternalUrl', url]); },
    fetchUris: async (uris, requestId) => { calls.push(['fetchUris', uris, requestId]); },
    openAttachment: async (file) => { calls.push(['openAttachment', file]); },
    branchChat: async (messageIndex) => { calls.push(['branchChat', messageIndex]); },
    enqueueRequest: async (request) => { calls.push(['enqueueRequest', request]); },
    cancelQueuedRequest: async (id) => { calls.push(['cancelQueuedRequest', id]); },
    clearQueuedRequests: async () => { calls.push(['clearQueuedRequests']); },
    moveQueuedRequest: async (id, direction) => { calls.push(['moveQueuedRequest', id, direction]); },
    editQueuedRequest: async (id) => { calls.push(['editQueuedRequest', id]); },
    resumeQueue: async () => { calls.push(['resumeQueue']); },
    setMessageFeedback: async (messageIndex, feedback) => { calls.push(['setMessageFeedback', messageIndex, feedback]); },
    getHistory: async () => { calls.push(['getHistory']); },
    loadHistory: async (id) => { calls.push(['loadHistory', id]); },
    deleteHistory: async (id) => { calls.push(['deleteHistory', id]); },
    deleteAllHistory: async () => { calls.push(['deleteAllHistory']); },
    requestDeleteHistory: async (id, title) => { calls.push(['requestDeleteHistory', id, title]); },
    requestClearAllHistory: async () => { calls.push(['requestClearAllHistory']); },
    getWorkspaceFiles: async () => { calls.push(['getWorkspaceFiles']); },
    setDefaultModel: async (modelName) => { calls.push(['setDefaultModel', modelName]); },
    log: (message, level) => { calls.push(['log', message, level]); }
  };

  return { host, calls };
}

test('routeWebviewMessage maps prompt messages into enqueue requests', async () => {
  const { host, calls } = createHost();

  await routeWebviewMessage({
    type: 'promptWithFile',
    value: 'Read these',
    model: 'gemma4:e4b',
    files: [{ name: 'plan.md' }],
    internet: true
  }, host);

  assert.deepEqual(calls, [[
    'enqueueRequest',
    {
      kind: 'promptWithFile',
      prompt: 'Read these',
      modelName: 'gemma4:e4b',
      files: [{ name: 'plan.md' }],
      internetEnabled: true
    }
  ]]);
});

test('routeWebviewMessage forwards queue control messages', async () => {
  const { host, calls } = createHost();

  await routeWebviewMessage({ type: 'cancelQueuedRequest', id: 'req_1' }, host);
  await routeWebviewMessage({ type: 'clearQueuedRequests' }, host);
  await routeWebviewMessage({ type: 'moveQueuedRequest', id: 'req_2', direction: 'up' }, host);
  await routeWebviewMessage({ type: 'editQueuedRequest', id: 'req_3' }, host);
  await routeWebviewMessage({ type: 'resumeQueue' }, host);
  await routeWebviewMessage({ type: 'stopGeneration' }, host);

  assert.deepEqual(calls, [
    ['cancelQueuedRequest', 'req_1'],
    ['clearQueuedRequests'],
    ['moveQueuedRequest', 'req_2', 'up'],
    ['editQueuedRequest', 'req_3'],
    ['resumeQueue'],
    ['stopGeneration']
  ]);
});

test('routeWebviewMessage maps edit and regenerate to queued requests', async () => {
  const { host, calls } = createHost();

  await routeWebviewMessage({
    type: 'editMessage',
    messageIndex: 4,
    value: 'Fix this paragraph',
    model: 'deepseek',
    files: [{ name: 'draft.md' }],
    internet: false
  }, host);

  await routeWebviewMessage({ type: 'regenerate' }, host);

  assert.deepEqual(calls, [
    ['enqueueRequest', {
      kind: 'editMessage',
      prompt: 'Fix this paragraph',
      modelName: 'deepseek',
      files: [{ name: 'draft.md' }],
      internetEnabled: false,
      messageIndex: 4
    }],
    ['enqueueRequest', {
      kind: 'regenerate',
      prompt: '',
      modelName: ''
    }]
  ]);
});

test('routeWebviewMessage forwards external link open requests', async () => {
  const { host, calls } = createHost();

  await routeWebviewMessage({ type: 'openExternalUrl', url: 'https://example.com/docs' }, host);

  assert.deepEqual(calls, [
    ['openExternalUrl', 'https://example.com/docs']
  ]);
});
