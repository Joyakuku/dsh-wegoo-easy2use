/**
 * index.js — 插件入口。
 *
 * 四个工具：
 *   wegoo_models  扫 key，列出这个 key 真正能调的模型与单价（零成本）
 *   wegoo_image   固定价出图；报价先过预算闸门，超限直接拒绝，零请求
 *   wegoo_video   按 token 计费，出任务 → 轮询 → 落盘 → 结算
 *   wegoo_usage   账本与逐条请求日志（真实金额只有 /api/log/token 有）
 *   wegoo_panel   生成右上角结算面板（滚动窗口）
 *
 * 没有审批通道：权限为 never 时全放行，闸门只有限额，一律 fail-closed。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Relay } from './relay.js';
import { Catalog, formatModelTable, quotaToUsd } from './catalog.js';
import * as L from './ledger.js';
import * as P from './paths.js';
import * as S from './specs.js';
import { createSessionTracker, describeExec } from './session.js';
import { Config, resolveOutputDir, readEffectiveConfig, readOverride, writeOverride, configPath, maskSecrets, mergeConfig } from './config.js';
import { renderPanel } from './panel.js';
import { estimateImageUsd, estimateTrafficUsd, estimateVideoUsd, learnFromRows, RECONCILE_TOLERANCE } from './rates.js';

let defineTool;
try {
  ({ defineTool } = await import('@deepseek-ai/dsh-tools'));
} catch {
  const override = process.env.DSH_TOOLS_PATH;
  if (override) {
    const { pathToFileURL } = await import('node:url');
    const mod = await import(pathToFileURL(override).href);
    defineTool = mod?.defineTool;
  }
}
if (typeof defineTool !== 'function') {
  throw new Error('dsh-wegoo-easy2use: 无法解析 @deepseek-ai/dsh-tools（可设 DSH_TOOLS_PATH）');
}

export const name = 'dsh-wegoo-easy2use';
export const inject = ['tools', 'attachments'];
export { Config };

// ---------------------------------------------------------------- helpers

function relayOf(config) {
  return new Relay({ baseUrl: config?.baseUrl });
}

function catalogOf(config) {
  if (!apply.__catalog) apply.__catalog = new Catalog({ relay: relayOf(config) });
  return apply.__catalog;
}

function requireCapability(config, kind) {
  const cap = config?.[kind] || {};
  if (!cap.enabled) {
    throw new Error(
      `wegoo ${kind} 未启用。到「设置 → 插件 → dsh-wegoo-easy2use」把「允许调用${kind === 'image' ? '图像' : '视频'}生成 API」打开并填入 API Key。`,
    );
  }
  if (!cap.apiKey) {
    throw new Error(
      `wegoo ${kind} 已启用但没有 API Key。到设置页填入该分组的 Key（Image Lite / Image Plus / Video Plus 各是独立分组）。`,
    );
  }
  return cap;
}

async function pickModel({ config, kind }) {
  const cap = config?.[kind] || {};
  const scan = await catalogOf(config).scan(cap.apiKey);
  if (!scan.ok) throw new Error(`wegoo ${kind} 扫描模型失败：${scan.reason}`);
  if (scan.models.length === 0) {
    throw new Error(`wegoo ${kind} 的 API Key 下没有任何可用模型（分组未开通？）`);
  }
  if (cap.defaultModel) {
    const hit = scan.models.find((m) => m.id === cap.defaultModel);
    if (!hit) {
      throw new Error(
        `默认模型 ${cap.defaultModel} 不在该 key 可见范围内。可用：${scan.models.map((m) => m.id).join(', ')}`,
      );
    }
    return hit;
  }
  if (kind === 'image') {
    return scan.models.find((m) => Number.isFinite(m.fixedUsd) && m.fixedUsd > 0) || scan.models[0];
  }
  return scan.models[0];
}

/** 结算窗口起点（unix 秒）。用时间戳而不是日志 id：relay 的 id 顺序不可靠。 */
function logSince(skewSec = 20) {
  return Math.floor(Date.now() / 1000) - skewSec;
}

async function settleSince(relay, key, fromId) {
  const payload = await relay.logs(key);
  const rows = (Array.isArray(payload?.data) ? payload.data : [])
    .filter((r) => (Number(r.created_at) || 0) >= fromId);
  const quota = rows.reduce((s, r) => s + (Number(r.quota) || 0), 0);
  return { rows, quota, usd: quotaToUsd(quota), requests: rows.length };
}

function gate({ config, quoteUsd, capabilityCapUsd, sessionId }) {
  const limits = L.resolveLimits(config);
  const baseline = L.syncBaseline(limits);
  const entries = L.readEntries();
  const verdict = L.checkBudget({
    limits,
    entries,
    quoteUsd,
    baselineAt: baseline.baselineAt,
    capabilityCapUsd,
    sessionId,
  });
  if (!verdict.ok) {
    const err = new Error(
      `wegoo 预算拦截（${verdict.reason}）：${verdict.message}；已花 $${verdict.spent.toFixed(4)} / 上限 $${verdict.limit.toFixed(4)}，本次报价 $${verdict.quote[0].toFixed(4)}~$${verdict.quote[1].toFixed(4)}。`
      + ' 提高设置页里的限额后重试。',
    );
    err.blocked = L.blockedPayload(verdict);
    throw err;
  }
  return { limits, baseline, verdict };
}

function stampDir(config) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const dir = path.join(resolveOutputDir(config), `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeName(prefix, ext) {
  return `${prefix}-${Date.now().toString(36)}.${ext}`;
}

const calibrationPath = P.calibrationPath;

/** 追加一行观测日志（data/client-ping.log）。失败静默，不影响主流程。 */
function appendPing(payload) {
  try {
    fs.appendFileSync(
      P.ensureParent(P.pingLogPath()),
      `${new Date().toISOString()} ${JSON.stringify(payload || {})}\n`,
      'utf8',
    );
  } catch {
    /* 观测通道失败不影响主流程 */
  }
}

/** 子智能体的 key：优先用配置，留空则回落到本机 CLI 自己的配置。 */
function readCodexKeyFromCli() {
  try {
    const file = path.join(os.homedir(), '.codex', 'config.toml');
    const m = /experimental_bearer_token\s*=\s*"([^"]+)"/.exec(fs.readFileSync(file, 'utf8'));
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

function readClaudeKeyFromCli() {
  try {
    const file = path.join(os.homedir(), '.claude', 'settings.json');
    const env = JSON.parse(fs.readFileSync(file, 'utf8'))?.env || {};
    const key = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || '';
    return typeof key === 'string' && key.startsWith('sk-') ? key : '';
  } catch {
    return '';
  }
}

function subagentKey(config, source) {
  const tracking = config?.tracking || {};
  if (source === 'codex') return String(tracking.codexKey || '') || readCodexKeyFromCli();
  return String(tracking.claudeKey || '') || readClaudeKeyFromCli();
}

function readCalibration() {
  try {
    return JSON.parse(fs.readFileSync(calibrationPath(), 'utf8'));
  } catch {
    return {};
  }
}

/** 事前估算已入账；后台等 relay 落账，偏差超过 2% 才覆盖。 */
function reconcileLater({ relay, key, fromId, entry, estimatedUsd }) {
  void (async () => {
    for (let i = 0; i < 5; i += 1) {
      const actual = await settleSince(relay, key, fromId);
      if (actual.rows.length > 0) learnFromRows(actual.rows);
      if (actual.usd > 0) {
        const drift = estimatedUsd > 0 ? Math.abs(actual.usd - estimatedUsd) / estimatedUsd : 1;
        const patch = { requests: actual.requests, estimated: false };
        if (drift > RECONCILE_TOLERANCE) {
          patch.settledUsd = actual.usd;
          patch.note = `事后校准（前估 $${estimatedUsd.toFixed(4)}，偏差 ${(drift * 100).toFixed(1)}%）`;
        }
        L.updateEntryById(entry.id, patch);
        return;
      }
      await sleep(1500);
    }
  })().catch(() => {});
}

function record({ kind, label, quoteUsd, settledUsd, requests, note, extra, sessionId }) {
  return L.appendEntry({
    id: L.newId(kind === 'image' ? 'img' : kind === 'video' ? 'vid' : 'sub'),
    at: Date.now(),
    sessionId: typeof sessionId === 'string' && sessionId ? sessionId : null,
    kind,
    label,
    quoteUsd,
    settledUsd,
    requests,
    note,
    ...extra,
  });
}

// ---------------------------------------------------------------- tools

export function apply(ctx, config) {
  const relay = relayOf(config);
  const catalog = new Catalog({ relay });
  apply.__catalog = catalog;

  // 随插件分发的技能：插件目录里带一份模板，首次运行时装到用户技能根目录。
  // 已存在就不覆盖——用户改过的描述优先。
  const installSkill = () => {
    try {
      const src = P.skillSourceFile();
      const dst = P.skillInstallFile();
      if (!fs.existsSync(dst)) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, fs.readFileSync(src));
        return { installed: true, path: dst };
      }
      return { installed: false, path: dst };
    } catch (e) {
      return { installed: false, path: null, error: String(e?.message || e) };
    }
  };
  const skillInstall = installSkill();

  const readSkill = () => {
    const file = P.skillInstallFile();
    if (!fs.existsSync(file)) return { path: file, description: '', body: '' };
    const raw = fs.readFileSync(file, 'utf8');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!m) return { path: file, description: '', body: raw };
    const line = m[1].match(/^description:\s*(.*)$/m);
    let desc = line ? line[1].trim() : '';
    if ((desc.startsWith('"') && desc.endsWith('"')) || (desc.startsWith("'") && desc.endsWith("'"))) {
      desc = desc.slice(1, -1);
    }
    return { path: file, description: desc, body: m[2] };
  };

  const writeSkillDescription = (description) => {
    const desc = String(description || '').replace(/\s+/g, ' ').trim();
    if (!desc) throw new Error('触发描述不能为空');
    const file = P.skillInstallFile();
    const current = readSkill();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `---\nname: wegoo-visual\ndescription: "${desc.replace(/"/g, '\\"')}"\n---\n${current.body || '\n'}`,
      'utf8',
    );
    return { path: file, description: desc, body: current.body };
  };

  // 数据目录：第一次解析时顺带做旧目录（~/.dsh/wegoo）→ <插件>/data 的一次性拷贝迁移。
  const dataDir = P.dataDir();
  const migration = P.migrationStatus();
  if (migration?.migrated || migration?.reason === 'error') {
    appendPing({ stage: 'data-dir', dir: dataDir, migration });
  }

  // 「本次会话」：工具执行时优先从 exec 取会话 id，取不到再用 session/event 里记下的最近会话。
  const tracker = createSessionTracker();
  const loggedFields = new Set();
  const sessionOf = (exec) => {
    const hit = tracker.fromExec(exec);
    const field = hit.field || 'none';
    if (!loggedFields.has(field)) {
      // 每种命中方式只记一次宿主给的真实结构（字段名和类型，不含值），用来核对取 id 的字段。
      loggedFields.add(field);
      appendPing({ stage: 'exec-shape', field, rolledUp: Boolean(hit.raw && hit.raw !== hit.id), ...describeExec(exec) });
    }
    return hit.id || null;
  };

  // 配置来源优先级：settings 命名空间（插件详情页面板写的就是它）
  // > <插件目录>/data/config.json（手改 / wegoo_config）> 组合配置。
  let settingsGet = null;
  const getConfig = () => mergeConfig(
    settingsGet ? settingsGet() : config,
    readOverride(),
  );
  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['settings'], (sctx) => {
        const scope = sctx.settings.register('wegoo', Config, { base: config });
        settingsGet = () => scope.get();
        scope.watch(() => catalog.invalidate());
      });
    }
  } catch {
    /* 没有 settings 服务：只用文件层 */
  }

  // 宿主自带的询问通道（ctx.userQuestions）：每次生成前强制人工确认。
  let userQuestions = null;
  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['userQuestions'], (qctx) => { userQuestions = qctx.userQuestions; });
    }
  } catch {
    /* 没有就 fail-closed：下面会拒绝生成 */
  }

  /** 参考图可以是本地路径、http(s) URL 或 data: URL。 */
  async function readImageSource(relay, input) {
    const raw = String(input || '').trim();
    const dataUrl = raw.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (dataUrl) {
      return {
        buffer: Buffer.from(dataUrl[2], 'base64'),
        mimeType: dataUrl[1],
        filename: `image.${dataUrl[1].split('/')[1] || 'png'}`,
      };
    }
    if (/^https?:\/\//i.test(raw)) {
      const dl = await relay.download(raw);
      return { buffer: dl.data, mimeType: dl.mediaType.startsWith('image/') ? dl.mediaType : 'image/png', filename: 'image.png' };
    }
    if (!fs.existsSync(raw)) throw new Error(`参考图不存在：${raw}`);
    const ext = path.extname(raw).slice(1).toLowerCase() || 'png';
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
    return { buffer: fs.readFileSync(raw), mimeType: mime, filename: path.basename(raw) };
  }

  async function confirmSpend({ exec, title, detail, estimateUsd, exact }) {
    if (!userQuestions) {
      throw new Error('无法发起确认：宿主未提供 userQuestions 服务。为避免擅自花钱，本次生成已取消。');
    }
    const priceText = exact
      ? `$${Number(estimateUsd).toFixed(4)}（固定价）`
      : `$${Number(estimateUsd).toFixed(4)}（上限）`;
    const answer = await userQuestions.ask({
      questions: [{
        id: 'wegoo-confirm',
        header: '确认生成',
        question: `${title}\n${detail}\n预计花费 ${priceText}。是否执行？`,
        options: [
          { label: '确认生成', description: `预计 ${priceText}` },
          { label: '取消', description: '不产生任何费用' },
        ],
      }],
      ...(exec?.agent !== undefined ? { agent: exec.agent } : {}),
      ...(exec?.signal !== undefined ? { signal: exec.signal } : {}),
    });
    const selected = (answer?.answers?.[0]?.selected) || [];
    if (!selected.some((s) => String(s).includes('确认'))) {
      throw new Error('用户取消了本次生成（未产生任何费用）。');
    }
  }

  // 浏览器面板的数据通路：插件路由（和 ds-harness-remote 同一种信封）。
  // 0.2.2-rc.1 既没有 settingsScope 客户端服务，connection.rpc.call 也会 405，
  // 所以直接注册 webServer 前缀路由，浏览器 POST 过来。
  const RPC_PREFIX = '/dsh-wegoo';
  const redactConfig = () => {
    const cfg = getConfig();
    return {
      ...cfg,
      image: { ...(cfg.image || {}), apiKey: '' },
      video: { ...(cfg.video || {}), apiKey: '' },
      imageKeySet: Boolean(cfg?.image?.apiKey),
      videoKeySet: Boolean(cfg?.video?.apiKey),
      codexKeySet: Boolean(cfg?.tracking?.codexKey),
      claudeKeySet: Boolean(cfg?.tracking?.claudeKey),
    };
  };
  const dispatchConfig = async (endpoint, payload) => {
    if (endpoint === 'get') return redactConfig();
    if (endpoint === 'models') {
      const kind = payload?.kind === 'video' ? 'video' : 'image';
      const saved = getConfig()?.[kind] || {};
      const key = String(payload?.apiKey || '').trim() || saved.apiKey || '';
      if (!key) throw new Error('请先填写 API Key');
      const scan = await catalog.scan(key);
      if (!scan.ok) throw new Error(scan.reason);
      return {
        kind,
        models: scan.models.map((m) => ({
          id: m.id,
          priceLabel: m.priceLabel,
          fixedUsd: m.fixedUsd,
        })),
      };
    }
    if (endpoint === 'ledger') {
      const limits = L.resolveLimits(getConfig());
      const baseline = L.syncBaseline(limits);
      const all = L.readEntries();
      const requested = ['day', 'session', 'all'].includes(payload?.scope) ? payload.scope : limits.totalScope;
      const sessionId = tracker.current();
      // session 口径严格按对话：还不知道当前对话时就是空，不拿别的对话凑数。
      const scoped = requested === 'session'
        ? (sessionId ? all.filter((e) => e.sessionId === sessionId) : [])
        : L.entriesInScope(all, requested, { baselineAt: baseline.baselineAt });
      const spent = scoped.reduce((s, e) => s + Number(e.settledUsd || 0), 0);
      return {
        spent,
        limit: limits.totalUsd,
        perCallUsd: limits.perCallUsd,
        perMinute: limits.perMinute,
        scope: requested,
        sessionId,
        remaining: Math.max(0, limits.totalUsd - spent),
        now: Date.now(),
        entries: scoped.slice(-12).reverse().map((e) => ({
          id: String(e.id || `${e.at || 0}_${e.kind || 'x'}_${e.label || ''}`),
          at: e.at || 0,
          kind: e.kind || 'image',
          label: e.label || '',
          quoteUsd: Array.isArray(e.quoteUsd) ? e.quoteUsd : null,
          settledUsd: Number.isFinite(Number(e.settledUsd)) ? Number(e.settledUsd) : null,
          requests: e.requests ?? null,
        })),
      };
    }
    if (endpoint === 'ping') {
      appendPing(payload);
      return { ok: true };
    }
    if (endpoint === 'skill') {
      const action = payload?.action || 'get';
      if (action === 'get') return { ...readSkill(), install: skillInstall };
      if (action === 'set') return { ...writeSkillDescription(payload?.description), install: skillInstall };
      throw new Error(`unknown skill action: ${action}`);
    }
    if (endpoint === 'set') {
      const patch = payload?.patch;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new Error('patch 必须是对象');
      }
      const clean = JSON.parse(JSON.stringify(patch));
      // 空字符串的 key 表示「不修改」，不要把已存的 key 冲掉。
      if (clean.image && clean.image.apiKey === '') delete clean.image.apiKey;
      if (clean.video && clean.video.apiKey === '') delete clean.video.apiKey;
      writeOverride(mergeConfig(readOverride(), clean));
      catalog.invalidate();
      return redactConfig();
    }
    throw new Error(`unknown endpoint: ${endpoint}`);
  };
  const configRoute = async (req, res) => {
    const reply = (body) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    let rpcId = 'unknown';
    try {
      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end();
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      if (typeof body?.rpcId === 'string') rpcId = body.rpcId;
      const pathname = new URL(req.url || '/', 'http://dsh.internal').pathname;
      const endpoint = pathname.slice(RPC_PREFIX.length).replace(/^\/+|\/+$/g, '');
      if (!endpoint || endpoint.includes('/')) throw new Error(`unknown route: ${pathname}`);
      const value = await dispatchConfig(endpoint, body?.payload || {});
      reply({ type: 'server-response', rpcId, result: { ok: true, value } });
    } catch (err) {
      reply({
        type: 'server-response',
        rpcId,
        result: { ok: false, error: { code: 'WEGOO_FAILED', message: String(err?.message || err) } },
      });
    }
  };
  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['webServer'], (wctx) => {
        const webServer = wctx.webServer;
        if (!webServer || typeof webServer.register !== 'function') return;
        wctx.effect(() => webServer.register({ kind: 'prefix', path: RPC_PREFIX, handler: configRoute }));
      });
    }
  } catch {
    /* 没有 webServer：面板读不到数据，命令行/文件路径仍然可用 */
  }

  const modelsTool = defineTool({
    ...S.modelsSpec(),
    async execute(args) {
      const config = getConfig();
      const kind = args?.kind || 'all';
      const parts = [];
      if (kind === 'image' || kind === 'all') {
        const cap = config?.image || {};
        parts.push(
          cap.enabled
            ? formatModelTable('图像', await catalog.scan(cap.apiKey))
            : '【图像】未启用（设置页打开「允许调用图像生成 API」）',
        );
      }
      if (kind === 'video' || kind === 'all') {
        const cap = config?.video || {};
        parts.push(
          cap.enabled
            ? formatModelTable('视频', await catalog.scan(cap.apiKey))
            : '【视频】未启用（设置页打开「允许调用视频生成 API」）',
        );
      }
      return { text: parts.join('\n\n') };
    },
  });

  const imageTool = defineTool({
    ...S.imageSpec(S.snapshotLimits(config)),
    timeoutMs: 240_000,
    async execute(args, exec) {
      const config = getConfig();
      const sessionId = sessionOf(exec);
      const cap = requireCapability(config, 'image');
      const model = await pickModel({ config, kind: 'image' });

      if (!Number.isFinite(model.fixedUsd) || model.fixedUsd <= 0) {
        throw new Error(
          `模型 ${model.id} 不是固定价（${model.priceLabel}），图像工具只接受固定价模型。换一个：${model.id} 之外请用 wegoo_models 查看。`,
        );
      }

      const n = Math.max(1, Math.min(4, Number(args?.n) || 1));
      const unit = model.fixedUsd;
      const quoteUsd = [unit * n, unit * n];

      await confirmSpend({
        exec,
        title: `图像生成 · ${model.id}`,
        detail: `${n} 张${args?.size ? ` · ${args.size}` : ''}${args?.image ? ' · 图生图（编辑）' : ''}`,
        estimateUsd: quoteUsd[0],
        exact: true,
      });

      gate({ config, quoteUsd, capabilityCapUsd: cap.maxUsdPerCall, sessionId });

      const startId = logSince();
      const body = { model: model.id, prompt: args.prompt, n };
      if (args?.size) body.size = args.size;

      let payload;
      if (args?.image) {
        const src = await readImageSource(relay, args.image);
        payload = await relay.editImage(cap.apiKey, {
          model: model.id,
          prompt: args.prompt,
          size: args?.size,
          n,
          imageBuffer: src.buffer,
          filename: src.filename,
          mimeType: src.mimeType,
        });
      } else {
        payload = await relay.generateImage(cap.apiKey, body);
      }
      const items = Array.isArray(payload?.data) ? payload.data : [];
      if (items.length === 0) throw new Error('wegoo 图像接口没有返回任何结果');

      const dir = stampDir(config);
      const images = [];
      const files = [];
      for (const [i, item] of items.entries()) {
        let data;
        let mediaType = 'image/png';
        if (item?.b64_json) {
          data = Buffer.from(item.b64_json, 'base64');
        } else if (item?.url) {
          const dl = await relay.download(item.url);
          data = dl.data;
          mediaType = dl.mediaType.startsWith('image/') ? dl.mediaType : 'image/png';
        } else {
          continue;
        }
        const file = path.join(dir, safeName(`img-${i + 1}`, mediaType.includes('jpeg') ? 'jpg' : 'png'));
        fs.writeFileSync(file, data);
        files.push(file);
        try {
          images.push(await ctx.attachments.saveImage({ data, mediaType, name: path.basename(file) }));
        } catch {
          /* 附件失败不影响落盘 */
        }
      }

      const pre = estimateImageUsd({ fixedUsd: model.fixedUsd, count: files.length, size: args?.size, quality: args?.quality });
      const entry = record({
        kind: 'image',
        label: `${model.id}${items.length > 1 ? ` ×${items.length}` : ''}`,
        quoteUsd,
        settledUsd: pre.usd,
        requests: items.length,
        note: '事前推算',
        extra: { estimated: true },
        sessionId,
      });
      reconcileLater({ relay, key: cap.apiKey, fromId: startId, entry, estimatedUsd: pre.usd });

      const lines = [
        `已生成 ${files.length} 张图`,
        `模型 ${model.id} · 报价 $${quoteUsd[0].toFixed(4)} · 结算 $${pre.usd.toFixed(4)}${model.fixedUsd ? '' : '（估算）'}`,
        ...files.map((f) => `文件 ${f}`),
      ];
      if (pre.usd === 0) lines.push('注意：事前估算为 0，可能是免费额度或渠道异常，请复核。');
      return { text: lines.join('\n'), images };
    },
  });

  const videoTool = defineTool({
    ...S.videoSpec(S.snapshotLimits(config)),
    timeoutMs: 900_000,
    async execute(args, exec) {
      const config = getConfig();
      const sessionId = sessionOf(exec);
      const cap = requireCapability(config, 'video');
      const model = await pickModel({ config, kind: 'video' });

      if (args?.taskId) {
        return pollAndFinish({ ctx, relay, config, cap, model, taskId: args.taskId, args, sessionId });
      }

      const cal = readCalibration();
      const key = `${model.id}|${args?.duration ?? ''}|${args?.resolution ?? ''}`;
      const fit = cal[key];
      if (!fit || !Array.isArray(fit.rangeUsd)) {
        throw new Error(
          `视频模型 ${model.id} 在 duration=${args?.duration ?? '默认'} / resolution=${args?.resolution ?? '默认'} 下还没有校准数据，无法报价（按量计费，不能瞎猜）。\n`
          + `先跑一次该配置并回填 ${calibrationPath()}：{"${key}": {"rangeUsd": [下限, 上限], "samples": 1}}\n`
          + `随后本次调用才会有报价与保护中止线。`,
        );
      }

      const quoteUsd = fit.rangeUsd;
      const { verdict } = gate({ config, quoteUsd, capabilityCapUsd: cap.maxUsdPerCall, sessionId });

      await confirmSpend({
        exec,
        title: `视频生成 · ${model.id}`,
        detail: `时长 ${args?.duration ?? '默认'}s${args?.resolution ? ` · ${args.resolution}` : ''}${args?.image ? ' · 带参考图' : ''}`,
        estimateUsd: quoteUsd[1],
        exact: false,
      });

      const startId = logSince();
      const body = { model: model.id, prompt: args.prompt };
      if (args?.duration) body.duration = args.duration;
      if (args?.resolution) body.resolution = args.resolution;
      if (args?.image) body.image = args.image;

      const created = await relay.createVideo(cap.apiKey, body);
      const taskId = extractTaskId(created);
      if (!taskId) {
        throw new Error(`wegoo 视频接口没有返回任务 id：${JSON.stringify(created).slice(0, 300)}`);
      }

      return pollAndFinish({
        ctx, relay, config, cap, model, taskId, args,
        quoteUsd, capUsd: verdict.capUsd, startId, sessionId,
      });
    },
  });

  const usageTool = defineTool({
    ...S.usageSpec(),
    timeoutMs: 120_000,
    async execute(args, exec) {
      const config = getConfig();
      const sessionId = sessionOf(exec);
      const limit = Math.max(1, Math.min(200, Number(args?.limit) || 20));
      const cutoff = parseSince(args?.since || '24h');
      const parts = [];

      for (const [kind, cap] of [['图像', config?.image], ['视频', config?.video]]) {
        if (!cap?.enabled || !cap.apiKey) {
          parts.push(`【${kind}】未启用`);
          continue;
        }
        try {
          const payload = await relay.logs(cap.apiKey);
          const rows = (Array.isArray(payload?.data) ? payload.data : [])
            .filter((r) => Number(r.created_at || 0) * 1000 >= cutoff)
            .sort((a, b) => Number(a.created_at) - Number(b.created_at));
          const total = rows.reduce((s, r) => s + quotaToUsd(r.quota), 0);
          parts.push(
            [`【${kind}】${rows.length} 请求 · $${total.toFixed(4)}`]
              .concat(rows.slice(-limit).map((r) => (
                `  ${fmtClock(r.created_at)} ${String(r.model_name || '?').padEnd(24)} ${String(r.prompt_tokens || 0).padStart(7)} → ${String(r.completion_tokens || 0).padStart(6)}  $${quotaToUsd(r.quota).toFixed(4)}`
              )))
              .join('\n'),
          );
        } catch (err) {
          parts.push(`【${kind}】读取失败：${err.message}`);
        }
      }

      const led = L.readEntries();
      const limits = L.resolveLimits(config);
      const baseline = L.syncBaseline(limits);
      const spent = L.spentUsd(led, limits.totalScope, baseline.baselineAt, sessionId);
      parts.push(
        `【本地面板账本】${led.length} 条 · ${({ day: '今日', session: '本次', all: '累计' })[limits.totalScope]} $${spent.toFixed(4)} / $${limits.totalUsd.toFixed(4)}`
        + `（单次 ≤ $${limits.perCallUsd} · ${limits.perMinute}/分）`,
      );
      return { text: parts.join('\n\n') };
    },
  });

  const panelTool = defineTool({
    ...S.panelSpec(),
    timeoutMs: 120_000,
    async execute(args, exec) {
      const config = getConfig();
      const sessionId = sessionOf(exec);
      const limit = Math.max(1, Math.min(2000, Number(args?.limit) || 200));
      const limits = L.resolveLimits(config);
      const baseline = L.syncBaseline(limits);
      const all = L.readEntries();
      const entries = all.slice(-limit);
      const spent = L.spentUsd(all, limits.totalScope, baseline.baselineAt, sessionId);

      const html = renderPanel({
        entries,
        limits,
        spent,
        baselineAt: baseline.baselineAt,
        reset: baseline.reset,
        generatedAt: Date.now(),
      });
      const file = P.ensureParent(P.panelPath());
      fs.writeFileSync(file, html, 'utf8');

      return {
        text: [
          `面板已生成：${file}`,
          `共 ${entries.length} 条记录 · ${({ day: '今日', session: '本次', all: '累计' })[limits.totalScope]} $${spent.toFixed(4)} / $${limits.totalUsd.toFixed(4)}`,
          '在文件预览里打开即可；每次调用 wegoo_panel 会重新生成。',
        ].join('\n'),
      };
    },
  });

  const configTool = defineTool({
    ...S.configSpec(),
    async execute(args) {
      const action = args?.action || 'get';
      if (action === 'reset') {
        writeOverride({});
        return { text: `已清空覆盖配置，回到组合默认。\n文件：${configPath()}` };
      }
      if (action === 'set') {
        const patch = args?.patch;
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
          throw new Error('action=set 需要一个 patch 对象，例如 {"image":{"enabled":true}}');
        }
        writeOverride(mergeConfig(readOverride(), patch));
      }
      const effective = getConfig();
      return {
        text: [
          `配置文件：${configPath()}`,
          '（key 已打码；保存后下一次调用立即生效，无需重启）',
          '',
          JSON.stringify(maskSecrets(effective), null, 2),
        ].join('\n'),
      };
    },
  });

  // 子智能体结算：在 tool/call 记游标、tool/result 结算差额。
  // 子智能体的 token 不进父会话，但一定进 relay 日志，这是唯一能精确归因的方式。
  const pendingSubagents = new Map();
  // 子智能体结算回填：每 30 秒重新读一次 relay 日志，金额变了就更新同一条账本记录。
  // 连续 4 次（2 分钟）没有变化就定稿——长时间运行的子智能体也能记准。
  const subagentSettlers = new Map();

  async function sweepSubagentSettlers() {
    for (const [entryId, st] of [...subagentSettlers]) {
      try {
        const settled = await settleSince(relay, st.key, st.from);
        const changed = settled.usd !== st.lastUsd || settled.requests !== st.lastReq;
        if (changed) {
          st.lastUsd = settled.usd;
          st.lastReq = settled.requests;
          st.stable = 0;
          L.updateEntryById(entryId, {
            settledUsd: settled.usd,
            requests: settled.requests,
            label: `${st.source} · ${settled.requests} 请求`,
            provisional: true,
            note: '结算中…',
          });
          continue;
        }
        st.stable += 1;
        if (st.stable >= 4) {
          L.updateEntryById(entryId, {
            settledUsd: settled.usd,
            requests: settled.requests,
            label: `${st.source} · ${settled.requests} 请求`,
            provisional: false,
            note: settled.usd === 0 ? '零计费' : undefined,
          });
          subagentSettlers.delete(entryId);
        }
      } catch {
        /* 单次读取失败不影响其他条目 */
      }
    }
  }

  const settlerTimer = setInterval(() => { void sweepSubagentSettlers(); }, 30_000);
  if (typeof settlerTimer.unref === 'function') settlerTimer.unref();

  const subagentDispose = ctx.on('session/event', (session, event) => {
    // 先记「当前会话」，再看结算开关：面板的 session 口径不依赖子智能体结算是否开启。
    let sessionId = null;
    try { sessionId = tracker.observe(session); } catch { /* ignore */ }
    try {
      if ((config?.tracking?.enabled ?? true) === false) return;

      if (event?.type === 'tool/call') {
        const data = event.data || {};
        const source = data.name === 'subagent_codex' ? 'codex'
          : data.name === 'subagent_claude_code' ? 'claude'
            : null;
        if (!source) return;
        const key = subagentKey(config, source);
        if (!key) return;
        pendingSubagents.set(data.callId, {
          source,
          key,
          at: Date.now(),
          from: logSince(),
          sessionId,
        });
        return;
      }

      if (event?.type === 'tool/result') {
        // callId 在 message.source.callId，不在 content 块上（session/src/invariant.ts）。
        const callId = event.data?.message?.source?.callId
          ?? (Array.isArray(event.data?.message?.content) ? event.data.message.content[0]?.callId : undefined);
        const rec = callId ? pendingSubagents.get(callId) : undefined;
        if (!rec) return;
        pendingSubagents.delete(callId);
        void (async () => {
          const fromId = await rec.from;
          // tool/result 对异步产品只代表「已启动」，真实花费会在之后陆续产生：
          // 先落一条临时条目，再交给 sweepSubagentSettlers 周期回填。
          const settled = await settleSince(relay, rec.key, fromId);
          const entry = record({
            kind: 'subagent',
            label: `${rec.source} · ${settled.requests} 请求`,
            settledUsd: settled.usd,
            requests: settled.requests,
            note: '结算中…',
            extra: { source: rec.source, provisional: true },
            sessionId: rec.sessionId,
          });
          subagentSettlers.set(entry.id, {
            key: rec.key,
            from: fromId,
            source: rec.source,
            lastUsd: settled.usd,
            lastReq: settled.requests,
            stable: 0,
          });
        })().catch(() => {
          /* 结算失败不影响主流程 */
        });
      }
    } catch {
      /* 同上 */
    }
  }, { global: true });

  const disposers = [modelsTool, imageTool, videoTool, usageTool, panelTool, configTool]
    .map((tool) => ctx.tools.register(tool));
  disposers.push(subagentDispose);
  disposers.push(() => clearInterval(settlerTimer));

  return () => {
    for (const d of disposers) {
      try { d?.(); } catch { /* ignore */ }
    }
  };
}

// ---------------------------------------------------------------- video poll

function extractTaskId(payload) {
  return payload?.id || payload?.task_id || payload?.data?.id || payload?.data?.task_id || null;
}

const DONE = new Set(['succeeded', 'success', 'completed', 'done', 'finished']);
const FAILED = new Set(['failed', 'error', 'cancelled', 'canceled']);

async function pollAndFinish({ ctx, relay, config, cap, model, taskId, args, quoteUsd, capUsd, startId, sessionId }) {
  const waitSec = Math.max(30, Math.min(1800, Number(args?.waitSec) || 300));
  const deadline = Date.now() + waitSec * 1000;
  const fromId = startId ?? logSince();
  const dir = stampDir(config);

  let delay = 2000;
  let last = null;
  while (Date.now() < deadline) {
    await sleep(delay);
    delay = Math.min(30_000, Math.round(delay * 1.6));

    last = await relay.getVideo(cap.apiKey, taskId);
    const status = String(last?.status || last?.data?.status || '').toLowerCase();

    // 监看式闸门：按量计费，跑着跑着就可能越过剩余额度。
    const live = await settleSince(relay, cap.apiKey, fromId);
    if (capUsd !== undefined && live.usd > capUsd) {
      record({
        kind: 'video', label: `${model.id} · ${taskId}`, quoteUsd: quoteUsd || [0, 0],
        settledUsd: live.usd, requests: live.requests, note: '超上限中止',
        extra: { taskId }, sessionId,
      });
      throw new Error(`wegoo 视频超出保护上限 $${capUsd.toFixed(4)}，已中止（任务 ${taskId} 可能仍在继续，请到面板确认）。`);
    }

    if (FAILED.has(status)) {
      record({
        kind: 'video', label: `${model.id} · ${taskId}`, quoteUsd: quoteUsd || [0, 0],
        settledUsd: live.usd, requests: live.requests,
        note: live.usd > 0 ? '失败但已计费' : '失败未计费', extra: { taskId }, sessionId,
      });
      throw new Error(`wegoo 视频任务失败（${status}）：${JSON.stringify(last).slice(0, 300)}`);
    }
    if (DONE.has(status)) {
      // wegoo 的完成响应里没有 url，产物在 /v1/videos/{id}/content 这个二进制端点。
      const dl = await relay.videoContent(cap.apiKey, taskId);
      const file = path.join(dir, safeName('video', 'mp4'));
      fs.writeFileSync(file, dl.data);
      const pre = estimateVideoUsd({
        model: model.id,
        seconds: args?.duration,
        resolution: args?.resolution,
        fallbackMidUsd: quoteUsd ? (quoteUsd[0] + quoteUsd[1]) / 2 : 0,
      });
      const traffic = estimateTrafficUsd(dl.data.length);
      const total = pre.usd + traffic.usd;
      const entry = record({
        kind: 'video', label: `${model.id} · 1 条`, quoteUsd: quoteUsd || [0, 0],
        settledUsd: total, requests: 1,
        note: pre.source === 'table' ? '事前推算（按秒单价）' : '事前推算（表外模型，按校准中值）',
        extra: { taskId, estimated: true }, sessionId,
      });
      reconcileLater({ relay, key: cap.apiKey, fromId, entry, estimatedUsd: total });
      return {
        text: [
          '已生成视频',
          `模型 ${model.id} · 任务 ${taskId}`,
          `报价 $${(quoteUsd || [0, 0])[0].toFixed(4)}~$${(quoteUsd || [0, 0])[1].toFixed(4)} · 结算 $${total.toFixed(4)}`,
          `文件 ${file}`,
        ].join('\n'),
      };
    }
  }

  const live = await settleSince(relay, cap.apiKey, fromId);
  record({
    kind: 'video', label: `${model.id} · ${taskId}`, quoteUsd: quoteUsd || [0, 0],
    settledUsd: live.usd, requests: live.requests, note: '等待超时，任务仍在继续',
    extra: { taskId }, sessionId,
  });
  return {
    text: [
      `等待 ${waitSec}s 仍未完成，任务继续在上游运行。`,
      `taskId ${taskId}`,
      `已发生 $${live.usd.toFixed(4)}`,
      `稍后用 wegoo_video 传 taskId=${taskId} 继续等待并结算。`,
    ].join('\n'),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------- misc

function fmtClock(seconds) {
  const d = new Date(Number(seconds) * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function parseSince(text) {
  const t = String(text || '').trim().toLowerCase();
  if (t === 'today' || t === 'd') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  const m = /^(\d+(?:\.\d+)?)([mhd])$/.exec(t);
  if (m) {
    const n = Number(m[1]);
    const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
    return Date.now() - n * unit;
  }
  const parsed = Date.parse(t);
  return Number.isFinite(parsed) ? parsed : Date.now() - 86_400_000;
}
