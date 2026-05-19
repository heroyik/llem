import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  RAPID_MLX_TEXT_SAMPLING_DEFAULTS,
  buildRapidMlxTextSamplingProfile,
  normalizeRapidMlxTextSampling
} = require('../out-test/samplingProfiles.js');

test('Rapid-MLX text sampling defaults match the stable anti-repeat profile', () => {
  assert.deepEqual(RAPID_MLX_TEXT_SAMPLING_DEFAULTS, {
    temperature: 0.35,
    topP: 0.85,
    topK: 30,
    repeatPenalty: 1.12,
    maxTokens: 3072
  });
});

test('normalizeRapidMlxTextSampling fills missing values and rounds integer fields', () => {
  assert.deepEqual(normalizeRapidMlxTextSampling({ temperature: 0.5, topK: 30.7, maxTokens: 2048.2 }), {
    temperature: 0.5,
    topP: 0.85,
    topK: 31,
    repeatPenalty: 1.12,
    maxTokens: 2048
  });
});

test('buildRapidMlxTextSamplingProfile maps maxTokens to predictTokens for stream requests', () => {
  const profile = buildRapidMlxTextSamplingProfile({
    temperature: 0.25,
    topP: 0.8,
    topK: 24,
    repeatPenalty: 1.18,
    maxTokens: 1536
  });

  assert.deepEqual(profile, {
    profile: 'rapid-mlx-text-safe',
    temperature: 0.25,
    topP: 0.8,
    topK: 24,
    repeatPenalty: 1.18,
    predictTokens: 1536
  });
});
