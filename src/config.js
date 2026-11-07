/**
 * config.js — 设置页字段。
 *
 * 这些字段会被 DSH 的设置页直接渲染成输入框（含开关），
 * 所以「允许使用图像/视频 API」和「单次/总额限额」都以配置项形式留在这里，
 * 插件本身不再自带表单。
 */

import fs from 'node:fs';
import z from '@deepseek-ai/schemastery';

import * as P from './paths.js';

const SCOPES = ['day', 'session', 'all'];

export const Config = z.object({
  baseUrl: z.string().default('https://ai.wegoo.site').description('wegoo 中继地址'),

  image: z.object({
    enabled: z.boolean().default(false).description('允许调用图像生成 API'),
    apiKey: z.string().default('').description('图像分组的 API Key（sk-...）'),
    defaultModel: z.string().default('').description('默认图像模型；留空时用该 key 扫描到的第一个固定价模型'),
    maxUsdPerCall: z.number().default(0.5).description('图像单次绝对上限（USD），与全局单次上限取较小者'),
  }).description('图像能力'),

  video: z.object({
    enabled: z.boolean().default(false).description('允许调用视频生成 API'),
    apiKey: z.string().default('').description('视频分组的 API Key（sk-...）'),
    defaultModel: z.string().default('').description('默认视频模型；留空时用该 key 扫描到的第一个模型'),
    maxUsdPerCall: z.number().default(1.5).description('视频单次绝对上限（USD），与全局单次上限取较小者'),
  }).description('视频能力'),

  limits: z.object({
    perCallUsd: z.number().default(0.1).description('单次调用金额上限（USD）'),
    totalUsd: z.number().default(1.0).description('总额上限（USD）'),
    totalScope: z.union(SCOPES).default('day').description('总额上限的统计范围：day / session / all'),
    perMinute: z.number().default(6).description('每分钟最多调用次数'),
  }).description('限额（改动后统计基线重置）'),

  tracking: z.object({
    enabled: z.boolean().default(true).description('把子智能体（Codex / Claude Code）的花费也记进面板'),
    codexKey: z.string().default('').description('Codex 子智能体用的 Key；留空则读 ~/.codex/config.toml'),
    claudeKey: z.string().default('').description('Claude Code 子智能体用的 Key；留空则读 ~/.claude/settings.json'),
  }).description('子智能体结算'),

  outputDir: z.string().default('').description('生成文件落盘目录；留空时用插件目录下的 data/output'),
});

export function resolveOutputDir(config) {
  const raw = String(config?.outputDir || '').trim();
  if (raw) return raw;
  return P.outputDir();
}

// ---------------------------------------------------------------- 运行时覆盖

/** 用户可编辑的运行时配置（<插件目录>/data/config.json）。优先级高于组合配置，改完立即生效。 */
export function configPath() {
  return P.configPath();
}

export function readOverride() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

export function writeOverride(value) {
  const file = P.ensureParent(configPath());
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return file;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 深合并：override 覆盖 base，数组整体替换。 */
export function mergeConfig(base, override) {
  if (!isPlainObject(override)) return override === undefined ? base : override;
  const out = { ...(isPlainObject(base) ? base : {}) };
  for (const [key, value] of Object.entries(override)) {
    out[key] = isPlainObject(value) ? mergeConfig(out[key], value) : value;
  }
  return out;
}

export function readEffectiveConfig(base) {
  return mergeConfig(base, readOverride());
}

const SECRET_FIELDS = new Set(['apiKey', 'codexKey', 'claudeKey']);

function maskValue(v) {
  const s = String(v || '');
  if (!s) return '';
  return s.length <= 10 ? '***' : `${s.slice(0, 6)}…${s.slice(-4)}`;
}

/** 展示用：把 key 打码，其余原样。 */
export function maskSecrets(node) {
  if (Array.isArray(node)) return node.map(maskSecrets);
  if (!isPlainObject(node)) return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    out[k] = SECRET_FIELDS.has(k) ? maskValue(v) : maskSecrets(v);
  }
  return out;
}
