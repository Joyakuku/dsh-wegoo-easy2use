/**
 * rates.js — 事前计费推算 + 单价自动学习。
 *
 * relay 账单行的 `content` 直接写出计费参数，可以反推单价：
 *
 *   视频  "Action text_to_video, Billing parameters: seconds: 5, resolution: 720p"
 *         → quota = 每秒单价(model) × 秒数 × 分辨率系数
 *   图像  "Size 1024x1024, Quality standard, Image count 1"
 *         → quota ≈ 标价 × 分组倍率
 *   下载  "Traffic fee for this task download"
 *         → quota = 字节数 × TRAFFIC_QUOTA_PER_BYTE
 *
 * 每笔真实账单都会回写 <插件目录>/data/rates.json，模型再多也会自己收敛。
 * 1 USD = 500000 quota。
 */

import fs from 'node:fs';

import { ratesPath, ensureParent } from './paths.js';

export const QUOTA_PER_USD = 500000;

/** 冷启动种子（已实测的模型）。没观察到的模型回退到校准区间中值。 */
const SEED_VIDEO = {
  'grok-imagine-video': 105000,
  'grok-imagine-video-1.5': 105000,
  'sd2.5-a': 350000,
  'sd2.5-30': 350000,
  'sd2.5-ad': 350000,
  'sd2.5-sss': 350000,
  'sd2.5-x': 350000,
  'sd2.5-720': 350000,
  'sd2.0-15': 350000,
  'sd2.0-b': 350000,
  'sd2.0-mini': 105000,
  'wan3-15': 105000,
  'wan3-30': 105000,
  'sd-2.0': 105000,
};

/** 分辨率相对 720p 的系数。 */
const RESOLUTION_FACTOR = {
  '480p': 0.45,
  '540p': 0.6,
  '720p': 1,
  '1080p': 1.8,
};

/** 图像没有学习样本时的兜底倍率：标价 × 1.02 ≈ 观测中值。 */
const IMAGE_GROUP_RATIO = 1.02;

const TRAFFIC_QUOTA_PER_BYTE = 156 / 741369;

/** 事前值与真实值超过这个比例才覆盖。 */
export const RECONCILE_TOLERANCE = 0.05;

function readRates() {
  try {
    const raw = JSON.parse(fs.readFileSync(ratesPath(), 'utf8'));
    return {
      video: raw && typeof raw.video === 'object' ? raw.video : {},
      image: raw && typeof raw.image === 'object' ? raw.image : {},
    };
  } catch {
    return { video: {}, image: {} };
  }
}

function writeRates(rates) {
  try {
    fs.writeFileSync(ensureParent(ratesPath()), `${JSON.stringify(rates, null, 2)}\n`, 'utf8');
  } catch {
    /* 学习失败不影响主流程 */
  }
}

/** 从真实账单行里学习单价。返回更新的条目数。 */
export function learnFromRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const rates = readRates();
  const now = Date.now();
  let changed = 0;

  for (const row of rows) {
    const quota = Number(row?.quota) || 0;
    if (quota <= 0) continue;
    const model = String(row?.model_name || '');
    const content = String(row?.content || '');

    const vid = content.match(/Billing parameters:\s*seconds:\s*(\d+(?:\.\d+)?)\s*,\s*resolution:\s*(\w+)/i);
    if (vid && model) {
      const seconds = Number(vid[1]);
      const factor = RESOLUTION_FACTOR[String(vid[2]).toLowerCase()] ?? 1;
      if (seconds > 0 && factor > 0) {
        const perSec = quota / seconds / factor;
        const prev = rates.video[model];
        rates.video[model] = prev
          ? { quotaPerSecond720p: (prev.quotaPerSecond720p * prev.samples + perSec) / (prev.samples + 1), samples: prev.samples + 1, updatedAt: now }
          : { quotaPerSecond720p: perSec, samples: 1, updatedAt: now };
        changed += 1;
      }
      continue;
    }

    const img = content.match(/Size\s+(\S+?),\s*Quality\s+(\w+)\s*,\s*Image count\s+(\d+)/i);
    if (img) {
      const key = `${img[1]}|${String(img[2]).toLowerCase()}`;
      const count = Number(img[3]) || 1;
      const unit = quota / count;
      const prev = rates.image[key];
      rates.image[key] = prev
        ? { quotaPerUnit: (prev.quotaPerUnit * prev.samples + unit) / (prev.samples + 1), samples: prev.samples + 1, updatedAt: now }
        : { quotaPerUnit: unit, samples: 1, updatedAt: now };
      changed += 1;
    }
  }

  if (changed > 0) writeRates(rates);
  return changed;
}

/** 视频事前估价。 */
export function estimateVideoUsd({ model, seconds, resolution, fallbackMidUsd }) {
  const rates = readRates();
  const learned = rates.video[model];
  const perSecond = learned?.quotaPerSecond720p ?? SEED_VIDEO[model];
  const secs = Number(seconds) || 5;
  if (!perSecond) {
    const mid = Number(fallbackMidUsd) || 0;
    return { quota: Math.round(mid * QUOTA_PER_USD), usd: mid, source: 'fallback' };
  }
  const factor = RESOLUTION_FACTOR[String(resolution || '720p')] ?? 1;
  const quota = Math.round(perSecond * secs * factor);
  return { quota, usd: quota / QUOTA_PER_USD, source: learned ? 'learned' : 'table' };
}

/** 图像事前估价：优先用学到的档位单价。 */
export function estimateImageUsd({ fixedUsd, count = 1, size, quality }) {
  const rates = readRates();
  const key = size ? `${size}|${String(quality || 'standard').toLowerCase()}` : null;
  const learned = key ? rates.image[key] : undefined;
  const unit = learned ? learned.quotaPerUnit / QUOTA_PER_USD : (Number(fixedUsd) || 0) * IMAGE_GROUP_RATIO;
  const usd = unit * Math.max(1, Number(count) || 1);
  return { quota: Math.round(usd * QUOTA_PER_USD), usd, source: learned ? 'learned' : 'table' };
}

/** 下载流量费（事前估，按预估体积）。 */
export function estimateTrafficUsd(bytes) {
  const quota = Math.round((Number(bytes) || 0) * TRAFFIC_QUOTA_PER_BYTE);
  return { quota, usd: quota / QUOTA_PER_USD };
}
