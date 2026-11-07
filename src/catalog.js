/**
 * catalog.js — 扫 key 得到「这个 key 能调哪些模型」，再与公开价目表 join。
 *
 * 两个事实决定了这里必须扫 key 而不是写死：
 *  1. /v1/models 按 key 的分组过滤；同一账户不同 key 看到的模型完全不同。
 *  2. 价目表有 65 个模型，但某个 key 可能只看见 3 个。
 *
 * 计价两种：
 *  - quota_type === 1：固定价，model_price 就是每次的美元价，报价即结算价。
 *  - quota_type === 0：按 token 计，model_ratio 是倍率；1 USD = 500000 quota。
 */

import { QUOTA_PER_USD } from './rates.js';

const CACHE_TTL_MS = 60 * 60 * 1000;

export function quotaToUsd(quota) {
  return Number(quota || 0) / QUOTA_PER_USD;
}

function normalizePricing(payload) {
  const rows = payload?.data;
  const map = new Map();
  if (!Array.isArray(rows)) return map;
  for (const row of rows) {
    const name = row?.model_name;
    if (!name) continue;
    map.set(name, {
      model: name,
      quotaType: Number(row.quota_type ?? 0),
      modelPriceUsd: Number(row.model_price ?? 0),
      modelRatio: Number(row.model_ratio ?? 0),
      completionRatio: Number(row.completion_ratio ?? 1),
      groups: Array.isArray(row.enable_groups) ? row.enable_groups : [],
    });
  }
  return map;
}

function describePrice(entry) {
  if (!entry) return '价目未知';
  if (entry.quotaType === 1) return `$${entry.modelPriceUsd.toFixed(4)} / 次（固定价）`;
  return `ratio ${entry.modelRatio}（按 token，约 $${(entry.modelRatio * 2).toFixed(2)} / 1M）`;
}

/**
 * 一个 kind（image/video）的目录。
 * 扫到就缓存；没有 key 或 key 无效时返回错误对象而不是抛，方便工具显示原因。
 */
export class Catalog {
  constructor({ relay, ttlMs = CACHE_TTL_MS } = {}) {
    this.relay = relay;
    this.ttlMs = ttlMs;
    this.cache = new Map(); // key -> { at, models }
  }

  async scan(apiKey) {
    if (!apiKey) {
      return { ok: false, reason: '未配置 API Key', models: [] };
    }
    const hit = this.cache.get(apiKey);
    if (hit && Date.now() - hit.at < this.ttlMs) {
      return { ok: true, models: hit.models, cached: true };
    }

    let listed;
    let pricing;
    try {
      [listed, pricing] = await Promise.all([
        this.relay.models(apiKey),
        this.relay.pricing(apiKey).catch(() => ({ data: [] })),
      ]);
    } catch (err) {
      return { ok: false, reason: err.message, models: [] };
    }

    const priceMap = normalizePricing(pricing);
    const models = (listed?.data || [])
      .map((m) => {
        const id = m?.id;
        if (!id) return null;
        const price = priceMap.get(id) || null;
        return {
          id,
          price,
          priceLabel: describePrice(price),
          fixedUsd: price && price.quotaType === 1 ? price.modelPriceUsd : null,
          ratio: price && price.quotaType === 0 ? price.modelRatio : null,
          endpointTypes: Array.isArray(m.supported_endpoint_types) ? m.supported_endpoint_types : [],
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.id.localeCompare(b.id));

    this.cache.set(apiKey, { at: Date.now(), models });
    return { ok: true, models, cached: false };
  }

  invalidate(apiKey) {
    if (apiKey) this.cache.delete(apiKey);
    else this.cache.clear();
  }
}

export function formatModelTable(kind, result) {
  if (!result.ok) return `【${kind}】扫描失败：${result.reason}`;
  if (result.models.length === 0) return `【${kind}】该 key 下没有任何可用模型`;
  const lines = result.models.map(
    (m) => `  ${m.id.padEnd(32)} ${m.priceLabel}`,
  );
  return [`【${kind}】可用模型 ${result.models.length} 个${result.cached ? '（缓存）' : ''}`, ...lines].join('\n');
}
