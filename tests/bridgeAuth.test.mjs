import test from 'node:test';
import assert from 'node:assert/strict';
import { isBridgeRequestAuthorized } from '../out-test/bridgeAuth.js';

test('isBridgeRequestAuthorized allows requests when no token is configured', () => {
  assert.equal(isBridgeRequestAuthorized({}, ''), true);
  assert.equal(isBridgeRequestAuthorized({ authorization: 'Bearer nope' }, '   '), true);
});

test('isBridgeRequestAuthorized accepts bearer and x-llem-token headers', () => {
  assert.equal(isBridgeRequestAuthorized({ authorization: 'Bearer secret-token' }, 'secret-token'), true);
  assert.equal(isBridgeRequestAuthorized({ authorization: 'bearer secret-token' }, 'secret-token'), true);
  assert.equal(isBridgeRequestAuthorized({ 'x-llem-token': 'secret-token' }, 'secret-token'), true);
});

test('isBridgeRequestAuthorized rejects missing or mismatched tokens', () => {
  assert.equal(isBridgeRequestAuthorized({}, 'secret-token'), false);
  assert.equal(isBridgeRequestAuthorized({ authorization: 'Token secret-token' }, 'secret-token'), false);
  assert.equal(isBridgeRequestAuthorized({ authorization: 'Bearer secret-token-extra' }, 'secret-token'), false);
  assert.equal(isBridgeRequestAuthorized({ 'x-llem-token': 'SECRET-TOKEN' }, 'secret-token'), false);
});
