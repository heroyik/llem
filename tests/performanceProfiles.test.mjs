import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildModelProfile,
  isLargeLocal26BModel,
  parseParameterSizeBillions,
  resolvePerformancePreset
} = require('../out-test/performanceProfiles.js');

test('parseParameterSizeBillions reads Ollama-style parameter sizes', () => {
  assert.equal(parseParameterSizeBillions('25.2B'), 25.2);
  assert.equal(parseParameterSizeBillions('8.0B'), 8);
  assert.equal(parseParameterSizeBillions(undefined), undefined);
});

test('auto preset classifies 26B-class models from name or metadata', () => {
  assert.equal(resolvePerformancePreset('auto', 'gemma6:26b'), 'large-local-26b');
  assert.equal(
    isLargeLocal26BModel('0xIbra/supergemma4-26b-uncensored-gguf-v2:Q4_K_M', '25.2B'),
    true
  );
  assert.equal(resolvePerformancePreset('auto', 'gemma4:e4b', '8.0B'), 'balanced');
});

test('buildModelProfile applies 26B Ollama tuning and balanced overrides', () => {
  const large = buildModelProfile({
    modelName: 'gemma6:26b',
    requestedPreset: 'auto'
  });
  const balanced = buildModelProfile({
    modelName: 'gemma6:26b',
    requestedPreset: 'balanced'
  });

  assert.equal(large.resolvedPreset, 'large-local-26b');
  assert.equal(large.requestTuning.repeatPenalty, 1.25);
  assert.ok(large.requestTuning.numCtx >= 4096);
  assert.ok(large.contextBudget.totalPromptChars > 0);
  assert.ok(large.contextBudget.totalPromptChars <= Math.floor(large.requestTuning.numCtx * 0.85));

  assert.equal(balanced.resolvedPreset, 'balanced');
  assert.equal(balanced.requestTuning.repeatPenalty, 1.15);
  assert.equal(balanced.requestTuning.initialPredict, -1);
  assert.equal(balanced.requestTuning.followupPredict, -1);
  assert.ok(balanced.requestTuning.numCtx >= 8192);
});
