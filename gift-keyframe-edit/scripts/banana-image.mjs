#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { access, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import readline from 'node:readline/promises';
import { routeModel } from './model-router.mjs';
import { maybePersistThreadLastImage, resolveImageContext } from './image-context.mjs';

export const DEFAULT_BASE_URL = 'https://zenmux.ai/api/vertex-ai';
export const DEFAULT_MODEL = 'google/gemini-3-pro-image-preview';
export const DEFAULT_API_VERSION = 'v1';
export const DEFAULT_OPENCLAW_MEDIA_SUBDIR = ['.openclaw', 'media', 'tool-image-generation'];
export const API_KEY_ENV_NAMES = ['ZENMUX_API_KEY', 'GEMINI_API_KEY'];
export const BASE_URL_ENV_NAMES = ['ZENMUX_BASE_URL', 'GOOGLE_GEMINI_BASE_URL'];
export const MODEL_ENV_NAMES = ['OPENCLAW_BANANA_MODEL', 'ZENMUX_IMAGE_MODEL'];
export const MISSING_API_KEY_FOLLOW_UP = '请提供图像生成 API Key（ZENMUX_API_KEY 或 GEMINI_API_KEY）。你可以在 https://zenmux.ai 或 https://aistudio.google.com/apikey 获取。获取后请告诉我，我帮你配置好。';

const CN_BACKGROUND_WORD = '背景';
const CN_BACKGROUND_REPLACE_VERBS = ['换', '替换', '抠图'];
const EN_BACKGROUND_REPLACE_PATTERNS = [
  'replace background',
  'background replace',
  'background replacement',
  'change background',
  'swap background',
];

export function isBackgroundReplaceTask(task) {
  const normalizedTask = task.toLowerCase();
  const hasChinesePattern = normalizedTask.includes(CN_BACKGROUND_WORD)
    && CN_BACKGROUND_REPLACE_VERBS.some((verb) => normalizedTask.includes(verb));
  const hasEnglishPattern = EN_BACKGROUND_REPLACE_PATTERNS.some((pattern) => normalizedTask.includes(pattern));
  return hasChinesePattern || hasEnglishPattern;
}

export function classifyMode(task, { inputImagePath, maskPath } = {}) {
  if (inputImagePath && isBackgroundReplaceTask(task)) {
    return 'background-replace';
  }
  if (inputImagePath && maskPath) {
    return 'inpaint';
  }
  if (inputImagePath) {
    return 'img2img';
  }
  return 'txt2img';
}

export function resolveFirstEnv(envNames, env = process.env) {
  for (const envName of envNames) {
    const value = env[envName];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function normalizeModelName(model) {
  const trimmed = model.trim();
  if (!trimmed) {
    return DEFAULT_MODEL;
  }
  return trimmed.includes('/') ? trimmed : `google/${trimmed}`;
}

export function isImageCapableModel(model) {
  return model.toLowerCase().includes('image');
}

export function resolveModel(model, env = process.env) {
  if (typeof model === 'string' && model.trim()) {
    return normalizeModelName(model);
  }

  const explicitImageModel = resolveFirstEnv(MODEL_ENV_NAMES, env);
  if (explicitImageModel) {
    return normalizeModelName(explicitImageModel);
  }

  const geminiModel = resolveFirstEnv(['GEMINI_MODEL'], env);
  if (geminiModel && isImageCapableModel(geminiModel)) {
    return normalizeModelName(geminiModel);
  }

  return DEFAULT_MODEL;
}

export function resolveBaseUrl(baseUrl, env = process.env) {
  if (typeof baseUrl === 'string' && baseUrl.trim()) {
    return baseUrl.trim().replace(/\/+$/, '');
  }
  return (resolveFirstEnv(BASE_URL_ENV_NAMES, env) ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
}

export function resolveApiVersion(apiVersion) {
  if (typeof apiVersion === 'string' && apiVersion.trim()) {
    return apiVersion.trim();
  }
  return DEFAULT_API_VERSION;
}

export function resolveOpenClawMediaDir(openClawMediaDir, env = process.env) {
  if (typeof openClawMediaDir === 'string' && openClawMediaDir.trim()) {
    return resolve(openClawMediaDir.trim());
  }

  const explicitEnvDir = resolveFirstEnv(['OPENCLAW_MEDIA_DIR'], env);
  if (explicitEnvDir) {
    return resolve(explicitEnvDir);
  }

  const homeDir = resolveFirstEnv(['USERPROFILE', 'HOME'], env);
  if (homeDir) {
    return resolve(homeDir, ...DEFAULT_OPENCLAW_MEDIA_SUBDIR);
  }

  const homeDrive = env.HOMEDRIVE;
  const homePath = env.HOMEPATH;
  if (typeof homeDrive === 'string' && typeof homePath === 'string' && homeDrive && homePath) {
    return resolve(`${homeDrive}${homePath}`, ...DEFAULT_OPENCLAW_MEDIA_SUBDIR);
  }

  return null;
}

export function readWindowsPersistentEnv(name, { execFileSyncImpl = execFileSync } = {}) {
  const escapedName = String(name).replace(/'/g, "''");
  const powershellArgs = [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
  ];

  for (const target of ['User', 'Machine']) {
    try {
      const output = execFileSyncImpl('powershell.exe', [
        ...powershellArgs,
        `[Environment]::GetEnvironmentVariable('${escapedName}', '${target}')`,
      ], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();

      if (output) {
        return output;
      }
    } catch {
      // Fall through to the next scope or caller-visible null.
    }
  }

  return null;
}

export function resolveApiKeyFromEnv(
  env = process.env,
  {
    platform = process.platform,
    readPersistentEnv = readWindowsPersistentEnv,
  } = {},
) {
  const directValue = resolveFirstEnv(API_KEY_ENV_NAMES, env);
  if (directValue) {
    return directValue;
  }

  if (platform === 'win32' && typeof readPersistentEnv === 'function') {
    for (const envName of API_KEY_ENV_NAMES) {
      const persistentValue = readPersistentEnv(envName);
      if (typeof persistentValue === 'string' && persistentValue.trim()) {
        return persistentValue.trim();
      }
    }
  }

  return null;
}

export async function resolveApiKey(apiKey, { promptForApiKey, env = process.env } = {}) {
  if (apiKey && apiKey.trim()) {
    return apiKey.trim();
  }
  const envApiKey = resolveApiKeyFromEnv(env);
  if (envApiKey) {
    return envApiKey;
  }
  if (!promptForApiKey) {
    throw new Error('API key is required for this request. Set ZENMUX_API_KEY or GEMINI_API_KEY.');
  }
  const prompted = (await promptForApiKey('Enter Banana API key for this request: ')).trim();
  if (!prompted) {
    throw new Error('API key prompt was empty.');
  }
  return prompted;
}

export async function ensureExistingFile(pathValue, label) {
  if (!pathValue) {
    return null;
  }
  const resolvedPath = resolve(pathValue);
  await access(resolvedPath);
  const fileStat = await stat(resolvedPath);
  if (!fileStat.isFile()) {
    throw new Error(`${label} is not a file: ${resolvedPath}`);
  }
  return resolvedPath;
}

export async function buildWorkflowRequest({
  task,
  apiKey,
  inputImagePath,
  maskPath,
  referenceImagePaths = [],
  size,
  steps,
  seed,
  outputDir,
  openClawMediaDir,
  model,
  apiVersion,
  promptForApiKey,
  env = process.env,
}) {
  const resolvedInput = await ensureExistingFile(inputImagePath, 'Input image');
  if (maskPath && !resolvedInput) {
    throw new Error('maskPath requires inputImagePath.');
  }
  const resolvedMask = await ensureExistingFile(maskPath, 'Mask image');
  const resolvedReferences = [];
  for (const referencePath of referenceImagePaths) {
    resolvedReferences.push(await ensureExistingFile(referencePath, 'Reference image'));
  }

  return {
    task: task.trim(),
    apiKey: await resolveApiKey(apiKey, { promptForApiKey, env }),
    mode: classifyMode(task, { inputImagePath: resolvedInput, maskPath: resolvedMask }),
    inputImagePath: resolvedInput,
    maskPath: resolvedMask,
    referenceImagePaths: resolvedReferences,
    size: size ?? null,
    steps: steps ?? null,
    seed: seed ?? null,
    model: resolveModel(model, env),
    apiVersion: resolveApiVersion(apiVersion),
    outputDir: outputDir ? resolve(outputDir) : resolve(process.cwd(), 'output', 'banana'),
    openClawMediaDir: resolveOpenClawMediaDir(openClawMediaDir, env),
  };
}

export function sniffMimeTypeFromBytes(bytes) {
  if (!bytes || bytes.length < 4) {
    return null;
  }

  if (bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a) {
    return 'image/png';
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  if (bytes.length >= 6) {
    const header = Buffer.from(bytes.slice(0, 6)).toString('ascii');
    if (header === 'GIF87a' || header === 'GIF89a') {
      return 'image/gif';
    }
  }

  if (bytes.length >= 12) {
    const riff = Buffer.from(bytes.slice(0, 4)).toString('ascii');
    const webp = Buffer.from(bytes.slice(8, 12)).toString('ascii');
    if (riff === 'RIFF' && webp === 'WEBP') {
      return 'image/webp';
    }
  }

  return null;
}

export function guessMimeType(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.png':
      return 'image/png';
    default: {
      try {
        const detected = sniffMimeTypeFromBytes(readFileSync(filePath));
        if (detected) {
          return detected;
        }
      } catch {
        // Fall back to png when the file cannot be read during mime guessing.
      }
      return 'image/png';
    }
  }
}

export function extensionForMimeType(mimeType) {
  switch ((mimeType ?? '').toLowerCase()) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    default:
      return '.png';
  }
}

export async function encodeFile(filePath) {
  const bytes = await readFile(filePath);
  return {
    path: filePath,
    filename: basename(filePath),
    mimeType: guessMimeType(filePath),
    contentBase64: Buffer.from(bytes).toString('base64'),
  };
}

export function buildPromptText(request) {
  if (request.inputImagePath) {
    if (request.mode === 'background-replace') {
      return [
        'Edit the provided image.',
        'Preserve the main subject, composition, and styling unless explicitly changed.',
        `Only replace the background according to this instruction: ${request.task.trim()}`,
      ].join('\n\n');
    }
    if (request.mode === 'inpaint') {
      return [
        'Edit the provided image.',
        'Use the provided mask image as an edit mask. Only change the masked region and preserve everything else.',
        `Follow this instruction: ${request.task.trim()}`,
      ].join('\n\n');
    }
    return [
      'Edit the provided image.',
      'Preserve the subject and composition unless the instruction explicitly asks to change them.',
      `Follow this instruction: ${request.task.trim()}`,
    ].join('\n\n');
  }

  const parts = [request.task.trim()];
  if (request.referenceImagePaths.length > 0) {
    parts.push('Use the reference images for style and composition guidance.');
  }
  return parts.join('\n\n');
}

export function buildInlineDataPart(file) {
  return {
    inlineData: {
      mimeType: file.mimeType,
      data: file.contentBase64,
    },
  };
}

export async function buildPayload(request) {
  const parts = [];

  // Edit requests work more reliably when the source image comes before the instruction text.
  if (request.inputImagePath) {
    parts.push(buildInlineDataPart(await encodeFile(request.inputImagePath)));
  }
  if (request.inputImagePath) {
    for (const referencePath of request.referenceImagePaths) {
      parts.push(buildInlineDataPart(await encodeFile(referencePath)));
    }
    if (request.maskPath) {
      parts.push(buildInlineDataPart(await encodeFile(request.maskPath)));
    }
    parts.push({ text: buildPromptText(request) });
  } else {
    parts.push({ text: buildPromptText(request) });
    for (const referencePath of request.referenceImagePaths) {
      parts.push(buildInlineDataPart(await encodeFile(referencePath)));
    }
    if (request.maskPath) {
      parts.push(buildInlineDataPart(await encodeFile(request.maskPath)));
    }
  }

  const generationConfig = {
    responseModalities: ['TEXT', 'IMAGE'],
  };
  if (request.seed !== null) {
    generationConfig.seed = request.seed;
  }

  return {
    contents: [
      {
        role: 'user',
        parts,
      },
    ],
    generationConfig,
  };
}

export function uniqueOutputPath(outputDir, preferredName) {
  const filename = basename(preferredName || 'banana-result.png');
  const extension = extname(filename) || '.png';
  const stem = extension ? filename.slice(0, -extension.length) : filename;
  let candidate = resolve(outputDir, filename);
  let index = 2;
  while (existsSync(candidate)) {
    candidate = resolve(outputDir, `${stem}-${index}${extension}`);
    index += 1;
  }
  return candidate;
}

export function extractResponseParts(responsePayload) {
  const parts = [];

  if (Array.isArray(responsePayload.parts)) {
    parts.push(...responsePayload.parts);
  }

  if (Array.isArray(responsePayload.candidates)) {
    for (const candidate of responsePayload.candidates) {
      if (Array.isArray(candidate?.content?.parts)) {
        parts.push(...candidate.content.parts);
      }
    }
  }

  return parts;
}

export function extractImageItems(responsePayload) {
  for (const key of ['images', 'output_files', 'data']) {
    const value = responsePayload[key];
    if (Array.isArray(value)) {
      return value.map((item, index) => {
        if (typeof item === 'string') {
          return {
            filename: `banana-result-${index + 1}.png`,
            b64_json: item,
          };
        }
        return item;
      });
    }
  }

  return extractResponseParts(responsePayload).filter((part) => part.inlineData || part.inline_data);
}

export function extractTextOutput(responsePayload) {
  return extractResponseParts(responsePayload)
    .map((part) => part.text)
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim());
}

export function guessFilename(item, index, mode) {
  if (item.filename) {
    return item.filename;
  }
  if (item.url) {
    try {
      const url = new URL(item.url);
      const name = basename(url.pathname);
      if (name) {
        return name;
      }
    } catch {
      // Fall back to a generated filename if the URL is malformed.
    }
  }

  const inlineMimeType = item.inlineData?.mimeType ?? item.inline_data?.mimeType;
  return `${mode}-${index}${extensionForMimeType(inlineMimeType)}`;
}

export async function imageBytesFromItem(item, { fetchImpl }) {
  const inlineData = item.inlineData ?? item.inline_data;
  if (typeof inlineData?.data === 'string' && inlineData.data.length > 0) {
    return Buffer.from(inlineData.data, 'base64');
  }

  for (const key of ['b64_json', 'contentBase64', 'base64', 'data']) {
    const value = item[key];
    if (typeof value === 'string' && value.length > 0) {
      return Buffer.from(value, 'base64');
    }
  }

  if (typeof item.url === 'string' && item.url.length > 0) {
    const response = await fetchImpl(item.url, {
      headers: { Accept: 'image/*' },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: failed to download output image`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  throw new Error('Image item did not include base64 data or a downloadable URL.');
}

export async function saveImageItems(items, { outputDir, mode, fetchImpl }) {
  await mkdir(outputDir, { recursive: true });
  const outputFiles = [];
  for (const [index, item] of items.entries()) {
    const filename = guessFilename(item, index + 1, mode);
    const destination = uniqueOutputPath(outputDir, filename);
    const bytes = await imageBytesFromItem(item, { fetchImpl });
    await writeFile(destination, bytes);
    outputFiles.push(destination);
  }
  return outputFiles;
}

export function summarizeResponse(responsePayload) {
  return JSON.stringify(responsePayload).slice(0, 400);
}

export function buildRequestSummary(request, responsePayload) {
  return {
    mode: request.mode,
    size: request.size,
    steps: request.steps,
    seed: request.seed,
    model: request.model,
    api_version: request.apiVersion,
    has_input_image: Boolean(request.inputImagePath),
    has_mask_image: Boolean(request.maskPath),
    reference_count: request.referenceImagePaths.length,
    ...(responsePayload.request_summary ?? {}),
  };
}

export function buildReproInfo(request, responsePayload) {
  return {
    prompt: request.task,
    mode: request.mode,
    seed: request.seed,
    size: request.size,
    model: request.model,
    api_version: request.apiVersion,
    ...(responsePayload.repro_info ?? {}),
  };
}

export function buildHostedMediaFilename(filePath, index) {
  const extension = extname(filePath) || '.png';
  return `image-${index}---${randomUUID()}${extension}`;
}

export async function buildOpenClawMedia(outputFiles, { mediaDir } = {}) {
  if (!mediaDir) {
    return {
      mediaUrls: [...outputFiles],
      ...(outputFiles[0] ? { mediaUrl: outputFiles[0] } : {}),
    };
  }

  await mkdir(mediaDir, { recursive: true });
  const mediaUrls = [];
  for (const [index, filePath] of outputFiles.entries()) {
    const hostedPath = resolve(mediaDir, buildHostedMediaFilename(filePath, index + 1));
    await copyFile(filePath, hostedPath);
    mediaUrls.push(hostedPath);
  }

  return {
    mediaUrls,
    ...(mediaUrls[0] ? { mediaUrl: mediaUrls[0] } : {}),
  };
}

export function parseModelRef(modelRef) {
  const normalized = normalizeModelName(modelRef);
  const slashIndex = normalized.indexOf('/');
  return {
    provider: normalized.slice(0, slashIndex),
    model: normalized.slice(slashIndex + 1),
  };
}

export function buildGenerateContentEndpoint(modelRef, apiVersion = DEFAULT_API_VERSION) {
  const { provider, model } = parseModelRef(modelRef);
  return `${apiVersion}/publishers/${encodeURIComponent(provider)}/models/${encodeURIComponent(model)}:generateContent`;
}

export function joinUrl(baseUrl, endpoint) {
  return `${baseUrl.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`;
}

export function formatHttpError(status, url, message) {
  const trimmed = (message || 'request failed').trim();
  if (status === 403) {
    return `HTTP 403: access denied for ${url}. Confirm the API key is valid and has access to this model. Raw response: ${trimmed}`;
  }
  if (status === 404) {
    return `HTTP 404: endpoint not found for ${url}. Confirm the base URL and Vertex AI generateContent path. Raw response: ${trimmed}`;
  }
  return `HTTP ${status}: ${trimmed}`;
}

export async function invokeApi(request, {
  baseUrl = DEFAULT_BASE_URL,
  endpoint,
  apiKeyHeader = 'Authorization',
  apiKeyPrefix = 'Bearer ',
  fetchImpl = fetch,
}) {
  const payload = await buildPayload(request);
  const targetEndpoint = endpoint ? endpoint.replace(/^\/+/, '') : buildGenerateContentEndpoint(request.model, request.apiVersion);
  const targetUrl = joinUrl(resolveBaseUrl(baseUrl), targetEndpoint);
  const response = await fetchImpl(targetUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      [apiKeyHeader]: `${apiKeyPrefix}${request.apiKey}`.trim(),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(formatHttpError(response.status, targetUrl, message));
  }
  return response.json();
}

export async function runWorkflow(request, {
  baseUrl = DEFAULT_BASE_URL,
  endpoint,
  apiKeyHeader = 'Authorization',
  apiKeyPrefix = 'Bearer ',
  fetchImpl = fetch,
}) {
  const result = {
    mode: request.mode,
    output_files: [],
    paths: [],
    media: { mediaUrls: [] },
    mediaUrls: [],
    mediaUrl: null,
    text_output: [],
    request_summary: {},
    repro_info: {},
    raw_response_excerpt: '',
    error: null,
  };

  try {
    const responsePayload = await invokeApi(request, {
      baseUrl,
      endpoint,
      apiKeyHeader,
      apiKeyPrefix,
      fetchImpl,
    });
    result.raw_response_excerpt = summarizeResponse(responsePayload);
    result.text_output = extractTextOutput(responsePayload);

    if (typeof responsePayload.error === 'string' && responsePayload.error.trim()) {
      result.error = responsePayload.error.trim();
      return result;
    }

    const items = extractImageItems(responsePayload);
    if (items.length === 0) {
      result.error = 'API response did not contain any output images.';
      return result;
    }

    result.output_files = await saveImageItems(items, {
      outputDir: request.outputDir,
      mode: request.mode,
      fetchImpl,
    });
    result.paths = [...result.output_files];
    result.media = await buildOpenClawMedia(result.output_files, {
      mediaDir: request.openClawMediaDir,
    });
    result.mediaUrls = result.media.mediaUrls;
    result.mediaUrl = result.media.mediaUrl ?? null;
    result.request_summary = buildRequestSummary(request, responsePayload);
    result.repro_info = buildReproInfo(request, responsePayload);
    return result;
  } catch (error) {
    result.error = error.message;
    return result;
  }
}

export function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      task: { type: 'string' },
      'base-url': { type: 'string' },
      endpoint: { type: 'string' },
      model: { type: 'string' },
      'model-mode': { type: 'string', default: 'auto' },
      'api-version': { type: 'string' },
      'api-key': { type: 'string' },
      'input-image-path': { type: 'string' },
      'reply-target-image-path': { type: 'string' },
      'thread-id': { type: 'string' },
      'continue-last-image': { type: 'boolean', default: false },
      'mask-path': { type: 'string' },
      'reference-image-path': { type: 'string', multiple: true },
      'reference-label': { type: 'string', multiple: true },
      size: { type: 'string' },
      steps: { type: 'string' },
      seed: { type: 'string' },
      'output-dir': { type: 'string' },
      'api-key-header': { type: 'string', default: 'Authorization' },
      'api-key-prefix': { type: 'string', default: 'Bearer ' },
      help: { type: 'boolean', default: false },
    },
  });
  return values;
}

export function helpText() {
  return [
    'Run an OpenClaw banana image generation or editing workflow.',
    '',
    'Defaults:',
    `  base URL: ${DEFAULT_BASE_URL}`,
    `  model: ${DEFAULT_MODEL}`,
    `  api version: ${DEFAULT_API_VERSION}`,
    `  API key envs: ${API_KEY_ENV_NAMES.join(', ')}`,
    `  base URL envs: ${BASE_URL_ENV_NAMES.join(', ')}`,
    `  image model envs: ${MODEL_ENV_NAMES.join(', ')}, GEMINI_MODEL (image models only)`,
    '',
    'Usage:',
    '  node ./scripts/banana-image.mjs --task "Create a gift concept image"',
    '',
    'Core options:',
    '  --task                    Natural-language task description.',
    '  --model                   Image-capable model name.',
    '  --model-mode              Model selection mode: auto or pick.',
    '  --api-key                 One-time API key.',
    '  --input-image-path        Local input image path.',
    '  --reply-target-image-path Reply target image path resolved by the caller.',
    '  --thread-id               Thread/chat identifier for last-image continuation.',
    '  --continue-last-image     Continue editing the latest successful image in the current thread.',
    '  --mask-path               Local mask image path for inpaint.',
    '  --reference-image-path    Repeatable local reference image path.',
    '  --size                    Optional size hint.',
    '  --seed                    Optional numeric seed.',
    '  --output-dir              Output directory. Default: ./output/banana',
    '',
    'Advanced options:',
    '  --base-url                Vertex AI base URL.',
    '  --endpoint                Override the generateContent endpoint path.',
    '  --api-version             API version string. Default: v1',
    '  --api-key-header          Auth header name. Default: Authorization',
    '  --api-key-prefix          Auth header prefix. Default: Bearer',
  ].join('\n');
}

export async function promptForApiKey(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

export function buildMissingApiKeyFollowUp({
  task,
  apiKey,
  env = process.env,
  resolveApiKey = resolveApiKeyFromEnv,
} = {}) {
  const explicitApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  const resolvedApiKey = explicitApiKey || resolveApiKey(env);
  if (resolvedApiKey) {
    return null;
  }

  return {
    status: 'follow_up_required',
    follow_up_question: MISSING_API_KEY_FOLLOW_UP,
    original_task: task,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (args.help) {
    process.stdout.write(`${helpText()}\n`);
    return 0;
  }

  if (!args.task) {
    process.stderr.write('The --task option is required. The Agent performs intent analysis and then calls this script with an optimized prompt.\n');
    return 1;
  }

  const referenceImagePaths = args['reference-image-path'] ?? [];
  const imageContext = await resolveImageContext({
    task: args.task,
    inputImagePath: args['input-image-path'],
    replyTargetImagePath: args['reply-target-image-path'],
    continueLastImage: args['continue-last-image'],
    threadId: args['thread-id'],
    env: process.env,
  });

  if (imageContext.followUpQuestion) {
    process.stdout.write(`${JSON.stringify({
      status: 'follow_up_required',
      follow_up_question: imageContext.followUpQuestion,
      image_context_source: imageContext.source,
      original_task: args.task,
    }, null, 2)}\n`);
    return 0;
  }

  const resolvedInputImagePath = imageContext.inputImagePath;
  const missingApiKeyFollowUp = buildMissingApiKeyFollowUp({
    task: args.task,
    apiKey: args['api-key'],
    env: process.env,
  });
  if (missingApiKeyFollowUp) {
    process.stdout.write(`${JSON.stringify(missingApiKeyFollowUp, null, 2)}\n`);
    return 0;
  }
  const resolvedApiKey = (typeof args['api-key'] === 'string' ? args['api-key'].trim() : '') || resolveApiKeyFromEnv(process.env);

  const { modelId, reason: modelReason } = routeModel({
    modelMode: args['model-mode'] ?? 'auto',
    explicitModel: args.model ?? null,
    intentMode: classifyMode(args.task, {
      inputImagePath: resolvedInputImagePath,
      maskPath: args['mask-path'],
    }),
    recommendedModel: null,
    env: process.env,
  });

  const request = await buildWorkflowRequest({
    task: args.task,
    apiKey: resolvedApiKey,
    inputImagePath: resolvedInputImagePath,
    maskPath: args['mask-path'],
    referenceImagePaths,
    size: args.size,
    steps: args.steps ? Number(args.steps) : null,
    seed: args.seed ? Number(args.seed) : null,
    outputDir: args['output-dir'],
    model: modelId,
    apiVersion: args['api-version'],
    env: process.env,
  });

  const result = await runWorkflow(request, {
    baseUrl: resolveBaseUrl(args['base-url'], process.env),
    endpoint: args.endpoint,
    apiKeyHeader: args['api-key-header'],
    apiKeyPrefix: args['api-key-prefix'],
  });

  result.model_routing = { modelId, reason: modelReason };
  result.image_context_source = imageContext.source;

  await maybePersistThreadLastImage({
    threadId: args['thread-id'],
    result,
    task: args.task,
    env: process.env,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.error ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = await main();
  process.exit(exitCode);
}
