import test from 'node:test';
import assert from 'node:assert/strict';

import { routeModel } from '../scripts/model-router.mjs';

test('routeModel chooses a ZenMux-supported Google image model for txt2img by default', () => {
  const result = routeModel({
    modelMode: 'auto',
    intentMode: 'txt2img',
  });

  assert.equal(result.modelId, 'google/gemini-2.5-flash-image');
  assert.equal(result.reason.includes('txt2img'), true);
});

test('routeModel keeps Gemini 3 Pro Image for edit-oriented requests', () => {
  const result = routeModel({
    modelMode: 'auto',
    intentMode: 'img2img',
  });

  assert.equal(result.modelId, 'google/gemini-3-pro-image-preview');
});
