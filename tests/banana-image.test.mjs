import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildPayload,
  buildPromptText,
  buildWorkflowRequest,
  encodeFile,
  extractImageItems,
  guessMimeType,
  helpText,
  invokeApi,
  main,
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

test('guessMimeType detects jpeg bytes even when file path has no extension', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'banana-mime-sniff-'));
  const inputPath = join(tempDir, 'upload-image');

  try {
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08]);
    await writeFile(inputPath, jpegBytes);

    assert.equal(guessMimeType(inputPath), 'image/jpeg');

    const encoded = await encodeFile(inputPath);
    assert.equal(encoded.mimeType, 'image/jpeg');
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

test('main handles reply-target edit requests end-to-end', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'banana-main-edit-'));
  const outputDir = join(tempDir, 'output');
  const mediaDir = join(tempDir, 'media');
  const replyPath = join(tempDir, 'reply.png');
  const originalFetch = global.fetch;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const writes = [];
  const errors = [];
  const capturedPayloads = [];

  try {
    await writeFile(replyPath, 'reply-image');

    global.fetch = async (_url, options) => {
      capturedPayloads.push(JSON.parse(options.body));
      return {
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
                        data: Buffer.from('edited-image').toString('base64'),
                      },
                    },
                  ],
                },
              },
            ],
          };
        },
      };
    };

    process.stdout.write = ((chunk, encoding, callback) => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString(encoding));
      if (typeof callback === 'function') {
        callback();
      }
      return true;
    });
    process.stderr.write = ((chunk, encoding, callback) => {
      errors.push(typeof chunk === 'string' ? chunk : chunk.toString(encoding));
      if (typeof callback === 'function') {
        callback();
      }
      return true;
    });

    const exitCode = await main([
      '--task', '其他保持不变，把小猫的头换成狗头',
      '--reply-target-image-path', replyPath,
      '--thread-id', 'thread-reply-edit',
      '--api-key', 'test-key',
      '--output-dir', outputDir,
      '--base-url', 'https://zenmux.ai/api/vertex-ai',
    ]);

    assert.equal(exitCode, 0);
    assert.deepEqual(errors, []);
    assert.equal(capturedPayloads.length, 1);
    assert.equal(capturedPayloads[0].contents[0].parts[0].inlineData?.mimeType, 'image/png');
    assert.equal(typeof capturedPayloads[0].contents[0].parts[1].text, 'string');

    const parsed = JSON.parse(writes.join(''));
    assert.equal(parsed.error, null);
    assert.equal(parsed.image_context_source, 'reply_target');
    assert.equal(parsed.model_routing.modelId, 'google/gemini-3-pro-image-preview');
    assert.equal(parsed.output_files.length, 1);
    assert.equal(parsed.mediaUrl.includes('image-1---'), true);
    await access(parsed.output_files[0]);
  } finally {
    global.fetch = originalFetch;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('main handles explicit uploaded image edit requests end-to-end', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'banana-main-upload-edit-'));
  const outputDir = join(tempDir, 'output');
  const mediaDir = join(tempDir, 'media');
  const uploadPath = join(tempDir, 'upload-image');
  const originalFetch = global.fetch;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const writes = [];
  const errors = [];
  const capturedPayloads = [];

  try {
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08]);
    await writeFile(uploadPath, jpegBytes);

    global.fetch = async (_url, options) => {
      capturedPayloads.push(JSON.parse(options.body));
      return {
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
                        data: Buffer.from('edited-upload-image').toString('base64'),
                      },
                    },
                  ],
                },
              },
            ],
          };
        },
      };
    };

    process.stdout.write = ((chunk, encoding, callback) => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString(encoding));
      if (typeof callback === 'function') {
        callback();
      }
      return true;
    });
    process.stderr.write = ((chunk, encoding, callback) => {
      errors.push(typeof chunk === 'string' ? chunk : chunk.toString(encoding));
      if (typeof callback === 'function') {
        callback();
      }
      return true;
    });

    const exitCode = await main([
      '--task', '把这张图里的猫耳朵改成狗耳朵',
      '--input-image-path', uploadPath,
      '--thread-id', 'thread-upload-edit',
      '--api-key', 'test-key',
      '--output-dir', outputDir,
      '--base-url', 'https://zenmux.ai/api/vertex-ai',
    ]);

    assert.equal(exitCode, 0);
    assert.deepEqual(errors, []);
    assert.equal(capturedPayloads.length, 1);
    assert.equal(capturedPayloads[0].contents[0].parts[0].inlineData?.mimeType, 'image/jpeg');
    assert.equal(typeof capturedPayloads[0].contents[0].parts[1].text, 'string');

    const parsed = JSON.parse(writes.join(''));
    assert.equal(parsed.error, null);
    assert.equal(parsed.image_context_source, 'explicit_attachment');
    assert.equal(parsed.model_routing.modelId, 'google/gemini-3-pro-image-preview');
    assert.equal(parsed.output_files.length, 1);
    await access(parsed.output_files[0]);
  } finally {
    global.fetch = originalFetch;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    await rm(tempDir, { recursive: true, force: true });
  }
});
