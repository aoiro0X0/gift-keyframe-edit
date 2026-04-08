#!/usr/bin/env node
/**
 * Model Router for openclaw-gift-design
 *
 * Two modes:
 *   auto  - select model based on task type (default)
 *   pick  - use the model specified by user or --model flag
 *
 * Model registry can be extended via BANANA_MODEL_REGISTRY env var (JSON string).
 */

export const DEFAULT_REGISTRY = [
  {
    id: 'google/gemini-3-pro-image-preview',
    tags: ['edit', 'inpaint', 'combine', 'background-replace', 'img2img'],
    provider: 'zenmux',
    description: '擅长图像编辑、局部修改、多参考图特征组合',
  },
  {
    id: 'bytedance/seedream-3',
    tags: ['txt2img', 'creative', 'concept'],
    provider: 'internal',
    description: '擅长从零创意生图，视觉表现力强',
  },
];

// Map intent analyzer mode → preferred tags
const MODE_TAG_PREFERENCE = {
  'txt2img': ['txt2img', 'creative'],
  'img2img': ['edit', 'img2img'],
  'inpaint': ['inpaint', 'edit'],
  'background-replace': ['background-replace', 'edit'],
};

/**
 * Load model registry from env override or use default.
 */
export function loadRegistry(env = process.env) {
  if (env.BANANA_MODEL_REGISTRY) {
    try {
      const parsed = JSON.parse(env.BANANA_MODEL_REGISTRY);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch {
      // Fall through to default
    }
  }
  return DEFAULT_REGISTRY;
}

/**
 * Find a model in the registry by ID (exact or partial match).
 */
export function findModelById(modelId, registry) {
  const normalized = modelId.trim().toLowerCase();
  return (
    registry.find((m) => m.id.toLowerCase() === normalized) ??
    registry.find((m) => m.id.toLowerCase().includes(normalized)) ??
    null
  );
}

/**
 * Select the best model for a given task mode from the registry.
 */
export function selectModelForMode(mode, registry) {
  const preferredTags = MODE_TAG_PREFERENCE[mode] ?? ['edit'];
  for (const tag of preferredTags) {
    const match = registry.find((m) => m.tags.includes(tag));
    if (match) return match;
  }
  // Fallback: first model in registry
  return registry[0] ?? null;
}

/**
 * Route to the appropriate model.
 *
 * @param {object} options
 * @param {'auto'|'pick'} options.modelMode  - routing mode
 * @param {string|null}   options.explicitModel - user-specified model id (for pick mode or override)
 * @param {string}        options.intentMode  - mode from intent analyzer (txt2img|img2img|inpaint|background-replace)
 * @param {string|null}   options.recommendedModel - model suggested by intent analyzer
 * @param {object}        [options.env]
 * @returns {{ modelId: string, reason: string, registry: object[] }}
 */
export function routeModel({
  modelMode = 'auto',
  explicitModel = null,
  intentMode = 'txt2img',
  recommendedModel = null,
  env = process.env,
}) {
  const registry = loadRegistry(env);

  // Explicit override always wins regardless of mode
  if (explicitModel && explicitModel.trim()) {
    const found = findModelById(explicitModel.trim(), registry);
    const modelId = found ? found.id : explicitModel.trim();
    return {
      modelId,
      reason: `用户指定模型: ${modelId}`,
      registry,
    };
  }

  if (modelMode === 'pick') {
    // pick mode without explicit model → fall through to auto
  }

  // Auto mode: trust intent analyzer recommendation first
  if (recommendedModel && recommendedModel.trim()) {
    const found = findModelById(recommendedModel.trim(), registry);
    if (found) {
      return {
        modelId: found.id,
        reason: `意图分析推荐: ${found.id}（${found.description}）`,
        registry,
      };
    }
  }

  // Fall back to mode-based selection
  const selected = selectModelForMode(intentMode, registry);
  if (selected) {
    return {
      modelId: selected.id,
      reason: `按任务类型 ${intentMode} 自动选择: ${selected.id}（${selected.description}）`,
      registry,
    };
  }

  // Last resort default
  return {
    modelId: 'google/gemini-3-pro-image-preview',
    reason: '默认模型',
    registry,
  };
}
