/**
 * specs.js — 工具定义（不含 execute）。
 *
 * 宿主的 ValueSchemaSpec 只认这些类型：
 *   string / number / integer / boolean / null / array(items) / object(properties) / json / oneOf
 * 不支持 minimum / maximum / pattern / format 这类注解，取值范围一律写进 description，
 * 由 execute 兜底校验。
 */

import { resolveLimits, DEFAULT_LIMITS } from './ledger.js';

export const MODELS_TOOL = 'wegoo_models';
export const IMAGE_TOOL = 'wegoo_image';
export const VIDEO_TOOL = 'wegoo_video';
export const USAGE_TOOL = 'wegoo_usage';

/** 把生效限额写进工具描述，模型一眼能看到闸门在哪。 */
export function limitsHint(limits = DEFAULT_LIMITS) {
  return `限额：单次 ≤ $${limits.perCallUsd}，总额 ≤ $${limits.totalUsd}（按 ${limits.totalScope}），每分钟 ≤ ${limits.perMinute} 次。超限会被直接拒绝，不会产生任何请求。`;
}

export function modelsSpec() {
  return {
    name: MODELS_TOOL,
    description: [
      'List the wegoo models this plugin can actually call, with their price.',
      '',
      'Models are discovered by scanning each configured API Key — wegoo scopes /v1/models per',
      'key group, so two keys can see completely different catalogues. Call this before',
      `${IMAGE_TOOL} or ${VIDEO_TOOL} if you are unsure what is available.`,
      '',
      'Costs nothing: it only reads /v1/models and /api/pricing.',
    ].join('\n'),
    parameters: {
      kind: {
        type: 'string',
        enum: ['image', 'video', 'all'],
        description: 'Which capability to scan. Default all.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true, description: 'Human-readable model table.' },
        },
      },
      render(args, value) {
        return [{ type: 'text', text: value.text }];
      },
    },
  };
}

export function imageSpec(limits) {
  return {
    name: IMAGE_TOOL,
    description: [
      'Generate an image through the wegoo relay and save it to the workspace.',
      'Pass `image` to EDIT an existing picture (image-to-image) instead of generating from text.',
      '',
      'Pricing is a FIXED price per call, so the quote is exact: it is checked against the',
      'budget before anything is sent, and the call is refused outright if it would exceed it.',
      '',
      limitsHint(limits),
    ].join('\n'),
    parameters: {
      prompt: { type: 'string', required: true, description: 'Image description.' },
      model: { type: 'string', description: `Model id. Defaults to the configured one, else the first fixed-price model the key can see.` },
      size: { type: 'string', description: "e.g. '1024x1024'. Passed through to the relay." },
      n: { type: 'integer', description: 'How many images (1-4). Default 1.' },
      image: {
        type: 'string',
        description: 'Reference image to edit (local path, https URL, or data: URL). When given, the call goes to /v1/images/edits (image-to-image) instead of generating from text only.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true, description: 'Quote, settlement and file path.' },
          images: { type: 'array', items: { type: 'json' }, description: 'Saved image attachments.' },
        },
      },
      render(args, value) {
        return [
          ...(value.images || []).map((attachment) => ({ type: 'image', attachment })),
          { type: 'text', text: value.text },
        ];
      },
    },
  };
}

export function videoSpec(limits) {
  return {
    name: VIDEO_TOOL,
    description: [
      'Generate a video through the wegoo relay: create a task, poll it, download the result.',
      '',
      'Pricing is per token, so the quote is a RANGE, not a single number. The estimate comes from',
      'calibration data recorded from earlier runs; when a model has no calibration yet the tool',
      'refuses rather than guessing. A protection cap aborts the run if the accumulated cost',
      'crosses the remaining budget.',
      '',
      limitsHint(limits),
    ].join('\n'),
    parameters: {
      prompt: { type: 'string', required: true, description: 'Video description.' },
      model: { type: 'string', description: 'Model id. Defaults to the configured one, else the first model the key can see.' },
      duration: { type: 'integer', description: 'Seconds (e.g. 5, 10). Relay default when omitted.' },
      resolution: { type: 'string', description: "e.g. '720p'." },
      image: {
        type: 'string',
        description: 'Reference image for image-to-video models: an https URL or a data: URL. Required by sd2.0-* and wan3-*; grok-imagine-video works without one.',
      },
      waitSec: { type: 'integer', description: 'Max seconds to wait for completion (default 300). The task keeps running after a timeout; call again with the same taskId to resume.' },
      taskId: { type: 'string', description: 'Resume polling an existing task instead of creating a new one.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true, description: 'Task state, quote and settlement.' },
        },
      },
      render(args, value) {
        return [{ type: 'text', text: value.text }];
      },
    },
  };
}

export function usageSpec() {
  return {
    name: USAGE_TOOL,
    description: [
      'Show the wegoo cost ledger: per-request rows from the relay plus the local settlement log.',
      '',
      'The relay books every upstream request under /api/log/token with a `quota` field',
      '(500000 quota = 1 USD). That is the only authoritative per-request cost — the',
      'OpenAI-style /v1/dashboard/billing/usage endpoint ignores its date range and cannot',
      'attribute a call.',
    ].join('\n'),
    parameters: {
      since: { type: 'string', description: "Window: '30m' / '12h' / '7d' / 'today' / ISO timestamp. Default 24h." },
      limit: { type: 'integer', description: 'Rows to show (default 20).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true, description: 'Cost table.' },
        },
      },
      render(args, value) {
        return [{ type: 'text', text: value.text }];
      },
    },
  };
}

export const CONFIG_TOOL = 'wegoo_config';

export function configSpec() {
  return {
    name: CONFIG_TOOL,
    description: [
      'Read or change this plugin\'s own settings (API keys, the image/video enable switches,',
      'and the budget limits) without restarting.',
      '',
      'Values are stored in <plugin dir>/data/config.json and override the composition config; every',
      'tool call re-reads that file, so a saved change applies to the next call.',
      '',
      'Shape: { image: { enabled, apiKey, defaultModel, maxUsdPerCall },',
      '         video: { ... same ... },',
      '         limits: { perCallUsd, totalUsd, totalScope, perMinute },',
      '         tracking: { enabled, codexKey, claudeKey },',
      '         outputDir }',
    ].join('\n'),
    parameters: {
      action: {
        type: 'string',
        enum: ['get', 'set', 'reset'],
        description: 'get = show effective config (keys masked); set = deep-merge `patch`; reset = clear overrides.',
      },
      patch: {
        type: 'json',
        description: 'For action=set: the partial config to merge, e.g. {"image":{"enabled":true,"apiKey":"sk-..."}}.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true, description: 'Effective config, keys masked.' },
        },
      },
      render(args, value) {
        return [{ type: 'text', text: value.text }];
      },
    },
  };
}

/** 供 execute 复用的生效限额快照。 */
export function snapshotLimits(config) {
  return resolveLimits(config);
}
