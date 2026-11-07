/**
 * panel.js — 结算面板（滚动窗口）。
 *
 * 这是整个插件里唯一自建的前端。它是一个自包含的 HTML 文件：
 * 无外部依赖、无网络请求，打开即用，刷新时重新读盘生成。
 *
 * 三类调用（子智能体 / 图像 / 视频）共用同一份流水，按时间倒序，
 * 每条显示「报价 → 结算」与偏差，顶部是额度尺。
 */

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `$${n.toFixed(4)}`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function clock(ts) {
  const d = new Date(ts);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const KIND_LABEL = { subagent: 'subagent', image: 'image', video: 'video' };

function row(entry) {
  const state = entry.state || 'done';
  const dot = state === 'running' ? '●' : state === 'failed' ? '✕' : state === 'aborted' ? '⊘' : '✓';
  const cls = state === 'running' ? 'run' : state === 'failed' ? 'fail' : state === 'aborted' ? 'off' : 'ok';

  const quote = Array.isArray(entry.quoteUsd)
    ? (entry.quoteUsd[0] === entry.quoteUsd[1]
      ? `报价 ${money(entry.quoteUsd[0])}`
      : `预估 ${money(entry.quoteUsd[0])}~${money(entry.quoteUsd[1])}`)
    : '无报价';

  const settled = Number.isFinite(Number(entry.settledUsd)) ? money(entry.settledUsd) : '结算中…';

  let delta = '';
  if (Number.isFinite(Number(entry.settledUsd)) && Array.isArray(entry.quoteUsd)) {
    const d = Number(entry.settledUsd) - entry.quoteUsd[1];
    if (Math.abs(d) >= 0.0001) delta = `　${d > 0 ? '+' : '−'}${money(Math.abs(d))}`;
  }

  return `<div class="row ${cls}">
    <div class="dot">${dot}</div>
    <div class="body">
      <div class="line1"><span class="time">${clock(entry.at)}</span>
        <span class="kind k-${esc(entry.kind)}">${esc(KIND_LABEL[entry.kind] || entry.kind)}</span>
        <span class="label">${esc(entry.label || '')}</span>
        <span class="amount">${settled}${delta}</span></div>
      <div class="line2">${esc(quote)}${entry.requests ? ` · ${entry.requests} 请求` : ''}${entry.note ? ` · ${esc(entry.note)}` : ''}</div>
    </div>
  </div>`;
}

export function renderPanel({ entries, limits, spent, baselineAt, reset, generatedAt }) {
  const sorted = [...entries].sort((a, b) => (b.at || 0) - (a.at || 0));
  const ratio = limits.totalUsd > 0 ? Math.min(1, spent / limits.totalUsd) : 0;
  const over = spent >= limits.totalUsd;

  const blocks = [];
  let currentDay = null;
  for (const e of sorted) {
    const dk = dayKey(e.at || Date.now());
    if (dk !== currentDay) {
      if (currentDay !== null) {
        const daySum = sorted
          .filter((x) => dayKey(x.at || 0) === currentDay)
          .reduce((s, x) => s + Number(x.settledUsd || 0), 0);
        blocks.push(`<div class="daysep">${currentDay} 小计 ${money(daySum)}</div>`);
      }
      currentDay = dk;
    }
    blocks.push(row(e));
  }
  if (currentDay !== null) {
    const daySum = sorted
      .filter((x) => dayKey(x.at || 0) === currentDay)
      .reduce((s, x) => s + Number(x.settledUsd || 0), 0);
    blocks.push(`<div class="daysep">${currentDay} 小计 ${money(daySum)}</div>`);
  }

  const scopeLabel = { day: '今日', session: '本次', all: '累计' }[limits.totalScope] || '今日';

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>wegoo 结算</title>
<style>
  :root { color-scheme: light dark; --fg:#1c1c1e; --muted:#8a8a8e; --line:#e5e5ea; --bg:#fff; --card:#f7f7f9; --ok:#2e9e5b; --fail:#d4373f; --run:#0a84ff; }
  @media (prefers-color-scheme: dark) { :root { --fg:#f2f2f7; --muted:#8e8e93; --line:#2c2c2e; --bg:#1c1c1e; --card:#242426; --ok:#32d74b; --fail:#ff453a; --run:#0a84ff; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:13px/1.5 -apple-system,"Segoe UI",system-ui,sans-serif; }
  header { position:sticky; top:0; background:var(--bg); border-bottom:1px solid var(--line); padding:12px 14px 10px; }
  .hrow { display:flex; align-items:baseline; justify-content:space-between; gap:8px; }
  .title { font-weight:600; }
  .total { font-variant-numeric:tabular-nums; font-size:16px; font-weight:600; }
  .meter { height:4px; border-radius:2px; background:var(--card); margin:9px 0 6px; overflow:hidden; }
  .meter > i { display:block; height:100%; width:${(ratio * 100).toFixed(1)}%; background:${over ? 'var(--fail)' : 'var(--ok)'}; }
  .sub { color:var(--muted); font-size:11.5px; display:flex; justify-content:space-between; }
  main { padding:6px 0 14px; max-height:none; }
  .row { display:flex; gap:9px; padding:9px 14px; border-bottom:1px solid var(--line); }
  .row:last-child { border-bottom:none; }
  .dot { width:14px; text-align:center; font-size:11px; line-height:20px; }
  .ok .dot { color:var(--ok); } .fail .dot { color:var(--fail); } .run .dot { color:var(--run); } .off .dot { color:var(--muted); }
  .body { flex:1; min-width:0; }
  .line1 { display:flex; align-items:baseline; gap:7px; }
  .time { color:var(--muted); font-size:11.5px; font-variant-numeric:tabular-nums; }
  .kind { font-size:10.5px; padding:1px 5px; border-radius:4px; background:var(--card); color:var(--muted); }
  .label { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .amount { font-variant-numeric:tabular-nums; font-weight:600; }
  .line2 { color:var(--muted); font-size:11.5px; margin-top:1px; }
  .daysep { text-align:center; color:var(--muted); font-size:11px; padding:6px 0; }
  .empty { color:var(--muted); text-align:center; padding:28px 0; }
  footer { position:sticky; bottom:0; background:var(--bg); border-top:1px solid var(--line); color:var(--muted); font-size:11px; padding:7px 14px; }
</style></head>
<body>
<header>
  <div class="hrow"><span class="title">wegoo 结算</span><span class="total">${money(spent)}</span></div>
  <div class="meter"><i></i></div>
  <div class="sub">
    <span>${scopeLabel} ${money(spent)} / ${money(limits.totalUsd)}</span>
    <span>单次 ≤ ${money(limits.perCallUsd)} · ${limits.perMinute}/分</span>
  </div>
  ${over ? '<div class="sub" style="color:var(--fail);margin-top:4px">已达上限，生成调用会被拦截</div>' : ''}
  ${reset ? '<div class="sub" style="margin-top:4px">限额已调整，统计基线已重置</div>' : ''}
</header>
<main>${blocks.length ? blocks.join('') : '<div class="empty">暂无结算记录</div>'}</main>
<footer>生成于 ${clock(generatedAt || Date.now())} · 共 ${sorted.length} 条</footer>
</body></html>`;
}
