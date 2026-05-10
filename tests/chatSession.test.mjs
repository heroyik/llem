import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const originalLoad = Module._load;

Module._load = function(request, parent, isMain) {
  if (request === 'vscode') {
    return {
      Uri: {
        file: (value) => ({ fsPath: value })
      },
      workspace: {
        openTextDocument: async () => ({})
      },
      window: {
        showWarningMessage: () => undefined,
        showTextDocument: async () => undefined
      }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { ChatSession } = require('../out-test/chatSession.js');

Module._load = originalLoad;

function createContext(savedState) {
  let state = savedState;
  return {
    workspaceState: {
      get: () => state,
      update: (_key, value) => {
        state = value;
      }
    }
  };
}

test('removeLastAssistantResponse removes only the trailing assistant message', () => {
  const session = new ChatSession(createContext(), () => 'system prompt');
  session.chatHistory = [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'first reply' }
  ];
  session.displayMessages = [
    { role: 'user', text: 'hello', feedback: null },
    { role: 'ai', text: 'first reply', feedback: null }
  ];

  session.removeLastAssistantResponse();

  assert.deepEqual(session.chatHistory, [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'hello' }
  ]);
  assert.deepEqual(session.displayMessages, [
    { role: 'user', text: 'hello', feedback: null }
  ]);
});

test('removeLastAssistantResponse keeps history unchanged when the last message is user', () => {
  const session = new ChatSession(createContext(), () => 'system prompt');
  session.chatHistory = [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'hello' }
  ];
  session.displayMessages = [
    { role: 'user', text: 'hello', feedback: null }
  ];

  session.removeLastAssistantResponse();

  assert.deepEqual(session.chatHistory, [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'hello' }
  ]);
  assert.deepEqual(session.displayMessages, [
    { role: 'user', text: 'hello', feedback: null }
  ]);
});
