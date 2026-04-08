import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  MISSING_EDIT_TARGET_FOLLOW_UP,
  maybePersistThreadLastImage,
  readThreadImageState,
  resolveImageContext,
} from '../scripts/image-context.mjs';

test('resolveImageContext prioritizes reply target over explicit attachment and thread last image', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'banana-context-priority-'));
  const replyPath = join(tempDir, 'reply.png');
  const explicitPath = join(tempDir, 'explicit.png');
  const statePath = join(tempDir, 'thread-state.json');

  try {
    await writeFile(replyPath, 'reply-image');
    await writeFile(explicitPath, 'explicit-image');
    await writeFile(
      statePath,
      JSON.stringify({
        threadA: {
          outputFile: join(tempDir, 'last.png'),
        },
      }),
      'utf8',
    );

    const context = await resolveImageContext({
      task: '去掉背景，换成纯绿底',
      inputImagePath: explicitPath,
      replyTargetImagePath: replyPath,
      threadId: 'threadA',
      env: {
        BANANA_THREAD_STATE_PATH: statePath,
      },
    });

    assert.equal(context.source, 'reply_target');
    assert.equal(context.inputImagePath, replyPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('resolveImageContext falls back to current thread last image for contextual edit requests', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'banana-context-thread-'));
  const lastImagePath = join(tempDir, 'last.png');
  const statePath = join(tempDir, 'thread-state.json');

  try {
    await writeFile(lastImagePath, 'last-image');
    await writeFile(
      statePath,
      JSON.stringify({
        threadB: {
          outputFile: lastImagePath,
          task: '生成毛绒花束',
        },
      }),
      'utf8',
    );

    const context = await resolveImageContext({
      task: '去掉背景，换成纯绿底',
      threadId: 'threadB',
      env: {
        BANANA_THREAD_STATE_PATH: statePath,
      },
    });

    assert.equal(context.source, 'thread_last_image');
    assert.equal(context.inputImagePath, lastImagePath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('resolveImageContext asks for a target image when edit intent has no available context image', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'banana-context-missing-'));
  const statePath = join(tempDir, 'thread-state.json');

  try {
    const context = await resolveImageContext({
      task: '去掉背景，换成纯绿底',
      threadId: 'threadC',
      env: {
        BANANA_THREAD_STATE_PATH: statePath,
      },
    });

    assert.equal(context.source, 'none');
    assert.equal(context.inputImagePath, null);
    assert.equal(context.followUpQuestion, MISSING_EDIT_TARGET_FOLLOW_UP);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('maybePersistThreadLastImage only records successful outputs', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'banana-context-persist-'));
  const statePath = join(tempDir, 'thread-state.json');
  const outputFile = join(tempDir, 'result.png');

  try {
    await writeFile(outputFile, 'result-image');

    const persisted = await maybePersistThreadLastImage({
      threadId: 'threadD',
      task: '生成一个礼物',
      result: {
        error: null,
        output_files: [outputFile],
      },
      env: {
        BANANA_THREAD_STATE_PATH: statePath,
      },
    });

    assert.equal(persisted, true);
    let state = await readThreadImageState({
      BANANA_THREAD_STATE_PATH: statePath,
    });
    assert.equal(state.threadD.outputFile, outputFile);

    const secondPersist = await maybePersistThreadLastImage({
      threadId: 'threadD',
      task: '失败请求',
      result: {
        error: 'boom',
        output_files: [join(tempDir, 'new.png')],
      },
      env: {
        BANANA_THREAD_STATE_PATH: statePath,
      },
    });

    assert.equal(secondPersist, false);
    state = await readThreadImageState({
      BANANA_THREAD_STATE_PATH: statePath,
    });
    assert.equal(state.threadD.outputFile, outputFile);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
