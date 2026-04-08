import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildPayload,
  buildPromptText,
  buildWorkflowRequest,
  extractImageItems,
  helpText,
  invokeApi,
  runWorkflow,
} from '../scripts/banana-image.mjs';

test('buildWorkflowRequest accepts GEMINI_API_KEY from env', async () => {
  const request = await buildWorkflowRequest({
    task: 'Create a banana ad image',
    env: {
      GEMINI_API_KEY: 'gemini-key',
    },
  });

  assert.equal(request.apiKey, 'gemini-key');
});

test('buildPayload emits Vertex AI generateContent payload for image generation', async () => {
  const payload = await buildPayload({
    task: 'Create a banana ad image',
    mode: 'txt2img',
    model: 'google/gemini-3-pro-image-preview',
    apiVersion: 'v1',
    inputImagePath: null,
    maskPath: null,
    referenceImagePaths: [],
    size: null,
    steps: null,
    seed: 7,
  });

  assert.deepEqual(payload, {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: 'Create a banana ad image',
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      seed: 7,
    },
  });
});

test('buildPayload sends input image before text for edit requests', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'banana-edit-payload-'));
  const inputPath = join(tempDir, 'input.png');

  try {
    await writeFile(inputPath, 'fake-image');

    const payload = await buildPayload({
      task: 'Replace the cat head with a dog head while keeping everything else the same',
      mode: 'img2img',
      model: 'google/gemini-3-pro-image-preview',
      apiVersion: 'v1',
      inputImagePath: inputPath,
      maskPath: null,
      referenceImagePaths: [],
      size: null,
      steps: null,
      seed: null,
    });

    assert.equal(payload.contents[0].parts[0].inlineData?.mimeType, 'image/png');
    assert.equal(typeof payload.contents[0].parts[1].text, 'string');
    assert.equal(payload.contents[0].parts[1].text.includes('Replace the cat head with a dog head'), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('invokeApi uses Vertex AI generateContent endpoint derived from provider and model', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() {
        return { candidates: [] };
      },
    };
  };

  await invokeApi({
    task: 'Create a banana ad image',
    apiKey: 'test-key',
    mode: 'txt2img',
    model: 'google/gemini-3-pro-image-preview',
    apiVersion: 'v1',
    inputImagePath: null,
    maskPath: null,
    referenceImagePaths: [],
    size: null,
    steps: null,
    seed: null,
  }, {
    fetchImpl,
  });

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://zenmux.ai/api/vertex-ai/v1/publishers/google/models/gemini-3-pro-image-preview:generateContent',
  );
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
});

test('extractImageItems reads inline image data from Vertex AI candidate parts', () => {
  const items = extractImageItems({
    candidates: [
      {
        content: {
          parts: [
            { text: 'Done' },
            {
              inlineData: {
                mimeType: 'image/png',
                data: 'ZmFrZQ==',
              },
            },
          ],
        },
      },
    ],
  });

  assert.deepEqual(items, [
    {
      inlineData: {
        mimeType: 'image/png',
        data: 'ZmFrZQ==',
      },
    },
  ]);
});

test('buildPromptText uses edit-first wording for background replacement', () => {
  const text = buildPromptText({
    task: 'Replace background with a clean green studio backdrop',
    mode: 'background-replace',
    inputImagePath: 'C:/mock/input.png',
    maskPath: null,
    referenceImagePaths: [],
  });

  assert.equal(text.includes('Edit the provided image.'), true);
  assert.equal(text.includes('Only replace the background according to this instruction:'), true);
});

test('runWorkflow exposes OpenClaw-compatible media URLs for generated images', async () => {
  const outputDir = await mkdtemp(join(tmpdir(), 'banana-media-'));
  const mediaDir = await mkdtemp(join(tmpdir(), 'banana-host-media-'));

  try {
    const result = await runWorkflow({
      task: 'Create a banana ad image',
      apiKey: 'test-key',
      mode: 'txt2img',
      model: 'google/gemini-3-pro-image-preview',
      apiVersion: 'v1',
      inputImagePath: null,
      maskPath: null,
      referenceImagePaths: [],
      size: null,
      steps: null,
      seed: null,
      outputDir,
      openClawMediaDir: mediaDir,
    }, {
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: 'image/png',
                        data: Buffer.from('fake-image').toString('base64'),
                      },
                    },
                  ],
                },
              },
            ],
          };
        },
      }),
    });

    assert.equal(result.error, null);
    assert.equal(result.output_files.length, 1);
    assert.notEqual(result.mediaUrl, result.output_files[0]);
    assert.deepEqual(result.media, {
      mediaUrls: [result.mediaUrl],
      mediaUrl: result.mediaUrl,
    });
    assert.deepEqual(result.mediaUrls, [result.mediaUrl]);
    assert.equal(result.mediaUrl.startsWith(mediaDir), true);
    await access(result.mediaUrl);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
    await rm(mediaDir, { recursive: true, force: true });
  }
});

test('helpText does not advertise design-document creation in the keyframe edit skill', () => {
  const text = helpText();
  assert.equal(text.includes('--create-design-doc'), false);
});
