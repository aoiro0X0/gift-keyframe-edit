#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

export const MISSING_EDIT_TARGET_FOLLOW_UP =
  '当前会话里没有可继续编辑的图片，请回复某张图或重新发送图片。';

const CONTEXT_EDIT_HINTS = [
  '上一张',
  '上张',
  '刚刚那张',
  '刚才那张',
  '这张继续',
  '继续改',
  '继续编辑',
  '继续修改',
  '接着改',
  '在上张图上',
  '在上一张图上',
  '基于这张',
  '保留主体',
  '去掉背景',
  '换背景',
  '改背景',
  '抠图',
  'replace background',
  'change background',
  'swap background',
  'continue editing',
  'edit this',
  'edit the previous',
];

async function ensureExistingFile(pathValue, label) {
  if (!pathValue) {
    return null;
  }

  const resolvedPath = resolve(pathValue);
  await access(resolvedPath);
  return resolvedPath;
}

export function isContextualEditTask(task) {
  if (typeof task !== 'string') {
    return false;
  }

  const normalizedTask = task.trim().toLowerCase();
  if (!normalizedTask) {
    return false;
  }

  return CONTEXT_EDIT_HINTS.some((pattern) => normalizedTask.includes(pattern.toLowerCase()));
}

export function resolveThreadStatePath(env = process.env) {
  if (typeof env.BANANA_THREAD_STATE_PATH === 'string' && env.BANANA_THREAD_STATE_PATH.trim()) {
    return resolve(env.BANANA_THREAD_STATE_PATH.trim());
  }

  return resolve(homedir(), '.openclaw', 'state', 'banana-thread-images.json');
}

export async function readThreadImageState(env = process.env) {
  const statePath = resolveThreadStatePath(env);
  try {
    const content = await readFile(statePath, 'utf8');
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

export async function writeThreadImageState(state, env = process.env) {
  const statePath = resolveThreadStatePath(env);
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function getThreadLastImage(threadId, { env = process.env } = {}) {
  if (!threadId) {
    return null;
  }

  const state = await readThreadImageState(env);
  return state[threadId] ?? null;
}

export async function recordThreadLastImage({
  threadId,
  outputFile,
  task,
  messageId = null,
  mediaId = null,
  env = process.env,
}) {
  if (!threadId || !outputFile) {
    return null;
  }

  const state = await readThreadImageState(env);
  state[threadId] = {
    outputFile: resolve(outputFile),
    task: typeof task === 'string' ? task : '',
    savedAt: new Date().toISOString(),
    messageId,
    mediaId,
  };
  await writeThreadImageState(state, env);
  return state[threadId];
}

export async function maybePersistThreadLastImage({
  threadId,
  result,
  task,
  messageId = null,
  mediaId = null,
  env = process.env,
}) {
  if (!threadId || !result || result.error || !Array.isArray(result.output_files) || !result.output_files[0]) {
    return false;
  }

  await recordThreadLastImage({
    threadId,
    outputFile: result.output_files[0],
    task,
    messageId,
    mediaId,
    env,
  });
  return true;
}

export async function resolveImageContext({
  task,
  inputImagePath,
  replyTargetImagePath,
  continueLastImage = false,
  threadId,
  env = process.env,
}) {
  const replyTarget = await ensureExistingFile(replyTargetImagePath, 'Reply target image');
  if (replyTarget) {
    return {
      inputImagePath: replyTarget,
      source: 'reply_target',
      followUpQuestion: null,
    };
  }

  const explicitAttachment = await ensureExistingFile(inputImagePath, 'Input image');
  if (explicitAttachment) {
    return {
      inputImagePath: explicitAttachment,
      source: 'explicit_attachment',
      followUpQuestion: null,
    };
  }

  const needsContextImage = Boolean(continueLastImage) || isContextualEditTask(task);
  if (!needsContextImage) {
    return {
      inputImagePath: null,
      source: 'none',
      followUpQuestion: null,
    };
  }

  const threadImage = await getThreadLastImage(threadId, { env });
  if (threadImage?.outputFile) {
    try {
      const resolvedThreadImage = await ensureExistingFile(threadImage.outputFile, 'Thread last image');
      if (resolvedThreadImage) {
        return {
          inputImagePath: resolvedThreadImage,
          source: 'thread_last_image',
          followUpQuestion: null,
        };
      }
    } catch {
      // Fall through to the follow-up question if the stored file no longer exists.
    }
  }

  return {
    inputImagePath: null,
    source: 'none',
    followUpQuestion: MISSING_EDIT_TARGET_FOLLOW_UP,
  };
}
