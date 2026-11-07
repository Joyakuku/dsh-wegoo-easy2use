/**
 * ledger.js — 本地账本 + 预算闸门。
 *
 * 账本只记「已经结算过」的调用；预算判定读它。
 * 限额来自插件配置（设置页），改动后基线重置：fingerprint 一变就记 baselineAt = now，
 * 之后的总量统计从新起点算，历史流水仍然保留。
 *
 * 没有审批通道，这里是唯一的闸门，所以一律 fail-closed。
 */

import fs from 'node:fs';
import crypto from 'node:crypto';

import { ledgerPath, limitsPath, ensureParent } from './paths.js';

export const DEFAULT_LIMITS = {
  perCallUsd: 0.1,
  totalUsd: 1.0,
  totalScope: 'day',
  perMinute: 6,
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureParent(file);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function newId(prefix = 'e') {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

/** 读全部流水（容错：坏行跳过）。 */
// 面板每 5 秒读一次账本；文件没变就不重复解析整份 JSONL。
let entriesCache = { key: null, value: [] };

export function readEntries() {
  const file = ledgerPath();
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    entriesCache = { key: null, value: [] };
    return entriesCache.value;
  }
  const key = `${stat.mtimeMs}:${stat.size}`;
  if (entriesCache.key === key) return entriesCache.value;
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      /* 坏行忽略 */
    }
  }
  entriesCache = { key, value: out };
  return out;
}

export function appendEntry(entry) {
  fs.appendFileSync(ensureParent(ledgerPath()), `${JSON.stringify(entry)}\n`, 'utf8');
  return entry;
}

/** 按 id 就地更新一条记录（用于事后校准覆盖前估值）。 */
export function updateEntryById(id, patch) {
  const entries = readEntries();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx < 0) return null;
  entries[idx] = { ...entries[idx], ...patch };
  fs.writeFileSync(ensureParent(ledgerPath()), `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf8');
  return entries[idx];
}

/** 配置 → 生效限额（带默认值兜底，任何异常都退回安全默认）。 */
export function resolveLimits(config) {
  const raw = config?.limits || {};
  const num = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback);
  const scope = ['day', 'session', 'all'].includes(raw.totalScope) ? raw.totalScope : DEFAULT_LIMITS.totalScope;
  return {
    perCallUsd: num(raw.perCallUsd, DEFAULT_LIMITS.perCallUsd),
    totalUsd: num(raw.totalUsd, DEFAULT_LIMITS.totalUsd),
    totalScope: scope,
    perMinute: num(raw.perMinute, DEFAULT_LIMITS.perMinute),
  };
}

function fingerprintOf(limits) {
  return crypto
    .createHash('sha1')
    .update(`${limits.perCallUsd}|${limits.totalUsd}|${limits.totalScope}|${limits.perMinute}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * 对齐基线：限额没变就沿用旧基线；一变就把 baselineAt 推到当前时刻。
 * 这就是「限额改动后重置」的落地。
 */
export function syncBaseline(limits) {
  const fingerprint = fingerprintOf(limits);
  const stored = readJson(limitsPath(), null);
  if (stored && stored.fingerprint === fingerprint && Number.isFinite(stored.baselineAt)) {
    return { fingerprint, baselineAt: stored.baselineAt, reset: false };
  }
  const baselineAt = Date.now();
  writeJson(limitsPath(), { fingerprint, baselineAt, limits });
  return { fingerprint, baselineAt, reset: true };
}

function localMidnight(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 按作用域筛流水。
 *   day      本地零点之后
 *   session  有 sessionId 时：只要 entry.sessionId === sessionId 的条目（按对话统计）；
 *            拿不到会话 id 时退回旧口径（限额基线之后），让闸门保持 fail-closed
 *   all      全部
 */
/** 受预算闸门约束的花费类型。子智能体拦不住，也不占用生成额度。 */
export const BUDGET_KINDS = ['image', 'video'];

export function entriesInScope(entries, scope, { baselineAt = 0, sessionId, kinds } = {}) {
  const byKind = kinds ? entries.filter((e) => kinds.includes(e.kind || 'image')) : entries;
  if (scope === 'session' && typeof sessionId === 'string' && sessionId) {
    return byKind.filter((e) => e.sessionId === sessionId);
  }
  const floor = scope === 'day' ? localMidnight() : scope === 'session' ? (Number(baselineAt) || 0) : 0;
  return byKind.filter((e) => (e.at || 0) >= floor);
}

/** 按作用域统计已花。 */
export function spentUsd(entries, scope, baselineAt, sessionId, kinds) {
  let sum = 0;
  for (const e of entriesInScope(entries, scope, { baselineAt, sessionId, kinds })) {
    sum += Number(e.settledUsd || 0);
  }
  return sum;
}

export function countLastMinute(entries, now = Date.now(), kinds) {
  const floor = now - 60_000;
  return entries.filter((e) => (e.at || 0) >= floor && (!kinds || kinds.includes(e.kind || 'image'))).length;
}

/**
 * 预算判定。
 * @param quoteUsd 报价区间 [下限, 上限]；固定价时两端相等。
 * @returns ok / 拦截原因 / 生效上限（视频的保护中止线用它）
 */
export function checkBudget({ limits, entries, quoteUsd, baselineAt, capabilityCapUsd, sessionId }) {
  const [low, high] = quoteUsd;
  const spent = spentUsd(entries, limits.totalScope, baselineAt, sessionId, BUDGET_KINDS);
  const remaining = Math.max(0, limits.totalUsd - spent);
  const perCallCap = Math.min(limits.perCallUsd, Number(capabilityCapUsd) || Infinity);

  const base = { spent, remaining, limit: limits.totalUsd, scope: limits.totalScope, quote: [low, high] };

  if (countLastMinute(entries, Date.now(), BUDGET_KINDS) >= limits.perMinute) {
    return { ok: false, reason: 'rate_limited', message: `每分钟最多 ${limits.perMinute} 次`, ...base };
  }
  if (high > perCallCap) {
    return { ok: false, reason: 'over_per_call', message: `单次上限 $${perCallCap.toFixed(4)}`, ...base };
  }
  if (low > remaining) {
    return { ok: false, reason: 'over_total', message: `剩余额度 $${remaining.toFixed(4)}`, ...base };
  }

  // 下限够、上限可能超：放行，但把保护中止线收到剩余额度。
  const capUsd = Math.min(perCallCap, remaining);
  return { ok: true, ...base, capUsd, tightened: high > remaining };
}

export function blockedPayload(result, hint) {
  return {
    blocked: true,
    reason: result.reason,
    message: result.message,
    scope: result.scope,
    limit: Number(result.limit?.toFixed?.(4) ?? result.limit ?? 0),
    spent: Number(result.spent.toFixed(4)),
    quote: result.quote.map((v) => Number(v.toFixed(4))),
    hint: hint || '提高设置页里的限额，或等待统计窗口重置',
  };
}
