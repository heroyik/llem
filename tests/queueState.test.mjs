import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancelPendingRequest,
  clearPendingRequests,
  createRequestQueueState,
  enqueueRequest,
  finishActiveRequest,
  movePendingRequest,
  pauseQueue,
  promoteNextRequest,
  resetQueueState,
  resumeQueue
} from '../out-test/queueState.js';

function request(id, prompt = id) {
  return {
    id,
    kind: 'prompt',
    prompt,
    modelName: 'gemma4:e4b',
    createdAt: 1
  };
}

test('enqueueRequest marks later items as queued when active or pending work exists', () => {
  let state = createRequestQueueState();
  state = enqueueRequest(state, request('req_1'));
  assert.equal(state.pendingRequests[0].wasQueued, false);

  const promoted = promoteNextRequest(state);
  state = promoted.state;
  assert.equal(promoted.nextRequest.id, 'req_1');

  state = enqueueRequest(state, request('req_2'));
  assert.equal(state.pendingRequests[0].wasQueued, true);
});

test('pauseQueue prevents promotion until resumed', () => {
  let state = createRequestQueueState();
  state = enqueueRequest(state, request('req_1'));
  state = enqueueRequest(state, request('req_2'));
  state = pauseQueue(state);

  let promoted = promoteNextRequest(state);
  assert.equal(promoted.nextRequest, undefined);
  assert.equal(promoted.state.pendingRequests.length, 2);

  state = resumeQueue(promoted.state);
  promoted = promoteNextRequest(state);
  assert.equal(promoted.nextRequest.id, 'req_1');
  assert.equal(promoted.state.pendingRequests.length, 1);
});

test('cancelPendingRequest and clearPendingRequests only affect waiting items', () => {
  let state = createRequestQueueState();
  state = enqueueRequest(state, request('req_1'));
  state = enqueueRequest(state, request('req_2'));
  state = enqueueRequest(state, request('req_3'));

  let promoted = promoteNextRequest(state);
  state = promoted.state;
  assert.equal(state.activeRequest.id, 'req_1');

  state = cancelPendingRequest(state, 'req_2');
  assert.deepEqual(state.pendingRequests.map(item => item.id), ['req_3']);
  assert.equal(state.activeRequest.id, 'req_1');

  state = clearPendingRequests(state);
  assert.deepEqual(state.pendingRequests, []);
  assert.equal(state.activeRequest.id, 'req_1');
});

test('movePendingRequest reorders waiting items without touching the active request', () => {
  let state = createRequestQueueState();
  state = enqueueRequest(state, request('req_1'));
  state = enqueueRequest(state, request('req_2'));
  state = enqueueRequest(state, request('req_3'));
  state = enqueueRequest(state, request('req_4'));

  state = promoteNextRequest(state).state;
  assert.equal(state.activeRequest.id, 'req_1');
  assert.deepEqual(state.pendingRequests.map(item => item.id), ['req_2', 'req_3', 'req_4']);

  state = movePendingRequest(state, 'req_4', 'up');
  assert.deepEqual(state.pendingRequests.map(item => item.id), ['req_2', 'req_4', 'req_3']);

  state = movePendingRequest(state, 'req_2', 'down');
  assert.deepEqual(state.pendingRequests.map(item => item.id), ['req_4', 'req_2', 'req_3']);
  assert.equal(state.activeRequest.id, 'req_1');
});

test('finishActiveRequest and resetQueueState cleanly release queue state', () => {
  let state = createRequestQueueState();
  state = enqueueRequest(state, request('req_1'));
  state = enqueueRequest(state, request('req_2'));
  state = promoteNextRequest(state).state;
  state = pauseQueue(state);

  state = finishActiveRequest(state);
  assert.equal(state.activeRequest, undefined);
  assert.equal(state.paused, true);
  assert.equal(state.pendingRequests.length, 1);

  state = resetQueueState();
  assert.deepEqual(state, {
    activeRequest: undefined,
    pendingRequests: [],
    paused: false
  });
});
