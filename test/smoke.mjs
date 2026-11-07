import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 必须在任何 import 之前设好：数据目录走临时目录，且 WEGOO_DATA_DIR 存在时不会做迁移，
// 真实 ~/.dsh/wegoo 里的 key 不会被拷进来。HOME 也指过去，双保险。
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wegoo-smoke-'));
const dataRoot = path.join(tmp, 'data');
process.env.WEGOO_DATA_DIR = dataRoot;
process.env.USERPROFILE = tmp;
process.env.HOME = tmp;

const P = await import('../src/paths.js');
const L = await import('../src/ledger.js');
const { createSessionTracker } = await import('../src/session.js');
const { renderPanel } = await import('../src/panel.js');
const { formatModelTable, quotaToUsd } = await import('../src/catalog.js');
const { estimateVideoUsd, estimateImageUsd, estimateTrafficUsd } = await import('../src/rates.js');

let pass = 0;
function ok(name, fn) {
  fn();
  pass += 1;
  console.log(`  ✓ ${name}`);
}

const limits = { perCallUsd: 0.1, totalUsd: 1.0, totalScope: 'day', perMinute: 6 };
const now = Date.now();
const entries = [
  { at: now - 1000, settledUsd: 0.03 },
  { at: now - 2000, settledUsd: 0.05 },
];

ok('quota → usd', () => {
  assert.equal(quotaToUsd(500000), 1);
  assert.equal(quotaToUsd(938), 0.001876);
});

ok('预算：正常放行', () => {
  const v = L.checkBudget({ limits, entries, quoteUsd: [0.03, 0.03], baselineAt: now - 86400000 });
  assert.equal(v.ok, true);
  assert.equal(v.spent, 0.08);
});

ok('预算：超单次上限拦截', () => {
  const v = L.checkBudget({ limits, entries, quoteUsd: [0.2, 0.2], baselineAt: 0 });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'over_per_call');
});

ok('预算：超总额拦截', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ at: now - i * 300_000, settledUsd: 0.03 }));
  const v = L.checkBudget({
    limits: { ...limits, totalScope: 'all' },
    entries: many,
    quoteUsd: [0.03, 0.03],
    baselineAt: 0,
  });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'over_total');
});

ok('预算：每分钟次数拦截', () => {
  const burst = Array.from({ length: 6 }, (_, i) => ({ at: now - i * 500, settledUsd: 0.0001 }));
  const v = L.checkBudget({ limits, entries: burst, quoteUsd: [0.03, 0.03], baselineAt: 0 });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'rate_limited');
});

ok('预算：上限收紧', () => {
  const big = { perCallUsd: 1, totalUsd: 0.5, totalScope: 'all', perMinute: 60 };
  const v = L.checkBudget({ limits: big, entries, quoteUsd: [0.3, 0.6], baselineAt: 0 });
  assert.equal(v.ok, true);
  assert.equal(v.tightened, true);
  assert.ok(v.capUsd <= 0.5);
});

ok('限额改动触发基线重置', () => {
  const a = L.syncBaseline(limits);
  const b = L.syncBaseline(limits);
  assert.equal(b.reset, false);
  assert.equal(a.baselineAt, b.baselineAt);
  const c = L.syncBaseline({ ...limits, totalUsd: 9.99 });
  assert.equal(c.reset, true);
  assert.ok(c.baselineAt >= a.baselineAt);
});

ok('面板渲染', () => {
  const html = renderPanel({
    entries: [
      { id: 'a', at: now, kind: 'image', label: 'gpt-image-2.5', quoteUsd: [0.03, 0.03], settledUsd: 0.03, requests: 1 },
      { id: 'b', at: now - 5000, kind: 'video', label: 'wan3-15', quoteUsd: [0.28, 0.42], settledUsd: 0.31, requests: 1 },
      { id: 'c', at: now - 9000, kind: 'subagent', label: 'claude-opus-5-5', settledUsd: 0.2841, requests: 3 },
    ],
    limits,
    spent: 0.6241,
    baselineAt: 0,
    reset: false,
    generatedAt: now,
  });
  assert.ok(html.includes('wegoo 结算'));
  assert.ok(html.includes('$0.6241'));
  assert.ok(html.includes('预估 $0.2800~$0.4200'));
  assert.ok(html.includes('subagent'));
});

ok('模型表格式', () => {
  const text = formatModelTable('图像', {
    ok: true,
    models: [{ id: 'gpt-image-2.5', priceLabel: '$0.0300 / 次（固定价）' }],
  });
  assert.ok(text.includes('gpt-image-2.5'));
  assert.ok(formatModelTable('图像', { ok: false, reason: 'x' }).includes('扫描失败'));
});


ok('事前计费推算（对齐 relay 实测）', () => {
  // 实测：grok 5s/720p = 525000 quota；sd2.5-a = 1750000；图像 ≈15300；流量 741369B = 156
  assert.equal(estimateVideoUsd({ model: 'grok-imagine-video', seconds: 5, resolution: '720p' }).quota, 525000);
  assert.equal(estimateVideoUsd({ model: 'grok-imagine-video-1.5', seconds: 5 }).quota, 525000);
  assert.equal(estimateVideoUsd({ model: 'sd2.5-a', seconds: 5 }).quota, 1750000);
  assert.equal(estimateVideoUsd({ model: 'grok-imagine-video', seconds: 10 }).quota, 1050000);
  assert.ok(Math.abs(estimateImageUsd({ fixedUsd: 0.03, count: 1 }).quota - 15300) <= 30);
  assert.equal(estimateTrafficUsd(741369).quota, 156);
  const fb = estimateVideoUsd({ model: 'no-such-model', seconds: 5, fallbackMidUsd: 1.1 });
  assert.equal(fb.source, 'fallback');
  assert.ok(Math.abs(fb.usd - 1.1) < 1e-9);
});

ok('数据目录：WEGOO_DATA_DIR 覆盖且不迁移', () => {
  assert.equal(P.dataDir(), path.resolve(dataRoot));
  assert.deepEqual(P.migrationStatus(), { migrated: false, reason: 'override', to: path.resolve(dataRoot) });
  for (const file of [P.configPath(), P.ledgerPath(), P.limitsPath(), P.ratesPath(), P.calibrationPath(),
    P.pingLogPath(), P.panelPath(), P.outputDir()]) {
    assert.ok(file.startsWith(path.resolve(dataRoot) + path.sep), `${file} 应在临时数据目录下`);
  }
  // syncBaseline 前面已经跑过：limits.json 必须落在临时目录，不能跑到旧的 ~/.dsh/wegoo
  assert.ok(fs.existsSync(path.join(dataRoot, 'limits.json')));
  assert.ok(!fs.existsSync(path.join(tmp, '.dsh', 'wegoo')));
  L.appendEntry({ id: 'probe', at: now, kind: 'image', settledUsd: 0, sessionId: 'x' });
  assert.ok(fs.readFileSync(path.join(dataRoot, 'ledger.jsonl'), 'utf8').includes('"probe"'));
});

ok('迁移：拷贝旧目录、保留旧目录、只做一次', () => {
  const legacy = path.join(tmp, 'legacy-home', '.dsh', 'wegoo');
  const target = path.join(tmp, 'repo', 'data');
  fs.mkdirSync(path.join(legacy, 'output'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'config.json'), '{"image":{"apiKey":"sk-legacy"}}');
  fs.writeFileSync(path.join(legacy, 'ledger.jsonl'), '{"id":"old"}\n');
  fs.writeFileSync(path.join(legacy, 'output', 'a.png'), 'png');

  assert.equal(P.migrateLegacy({ from: path.join(tmp, 'nope'), to: target }).reason, 'no-legacy');
  assert.ok(!fs.existsSync(target), '没有旧目录时不应建出新目录');

  const first = P.migrateLegacy({ from: legacy, to: target });
  assert.equal(first.migrated, true);
  assert.equal(fs.readFileSync(path.join(target, 'config.json'), 'utf8'), '{"image":{"apiKey":"sk-legacy"}}');
  assert.equal(fs.readFileSync(path.join(target, 'output', 'a.png'), 'utf8'), 'png');
  assert.ok(fs.existsSync(path.join(target, P.MIGRATION_MARKER)), '应写入迁移标记');
  assert.ok(fs.existsSync(path.join(legacy, 'config.json')), '旧目录必须保留');
  assert.ok(!fs.existsSync(path.join(legacy, P.MIGRATION_MARKER)), '标记只写新目录，不动旧目录');
  const leftovers = fs.readdirSync(path.dirname(target)).filter((n) => n.includes('.migrating-'));
  assert.deepEqual(leftovers, [], '不应残留临时目录');

  fs.writeFileSync(path.join(legacy, 'config.json'), '{"changed":true}');
  const second = P.migrateLegacy({ from: legacy, to: target });
  assert.equal(second.migrated, false);
  assert.equal(second.reason, 'target-exists');
  assert.ok(fs.readFileSync(path.join(target, 'config.json'), 'utf8').includes('sk-legacy'), '第二次不应覆盖');
});

ok('本次会话：按 sessionId 过滤', () => {
  const mixed = [
    { at: now - 5000, settledUsd: 0.4, sessionId: 's1' },
    { at: now - 4000, settledUsd: 0.5, sessionId: 's2' },
    { at: now - 3000, settledUsd: 0.3, sessionId: 's1' },
    { at: now - 2000, settledUsd: 0.2 },
  ];
  assert.deepEqual(L.entriesInScope(mixed, 'session', { sessionId: 's1' }).map((e) => e.settledUsd), [0.4, 0.3]);
  assert.ok(Math.abs(L.spentUsd(mixed, 'session', 0, 's2') - 0.5) < 1e-9);
  assert.equal(L.spentUsd(mixed, 'session', 0, 'nobody'), 0);
  // 没有 sessionId 时退回基线口径（fail-closed：宁可多算，不少算）
  assert.ok(Math.abs(L.spentUsd(mixed, 'session', now - 3500) - 0.5) < 1e-9);
  // day / all 口径不受 sessionId 影响
  assert.ok(Math.abs(L.spentUsd(mixed, 'all', 0, 's1') - 1.4) < 1e-9);

  const lim = { perCallUsd: 0.1, totalUsd: 0.75, totalScope: 'session', perMinute: 60 };
  const s1 = L.checkBudget({ limits: lim, entries: mixed, quoteUsd: [0.08, 0.08], baselineAt: 0, sessionId: 's1' });
  assert.equal(s1.ok, false, 's1 已花 0.7，再加 0.08 应超额');
  assert.equal(s1.reason, 'over_total');
  const s2 = L.checkBudget({ limits: lim, entries: mixed, quoteUsd: [0.08, 0.08], baselineAt: 0, sessionId: 's2' });
  assert.equal(s2.ok, true, 's2 只花了 0.5，不应被 s1 的花费拖累');
});

ok('会话追踪：exec 取值顺序与子智能体归并', () => {
  const t = createSessionTracker();
  assert.deepEqual(t.fromExec({}), { id: null, raw: null, field: null });
  assert.equal(t.observe({ id: 'parent', header: {} }), 'parent');
  assert.deepEqual(t.fromExec({}), { id: 'parent', raw: null, field: 'session/event' });
  // 子智能体事件归到父对话，不抢「当前会话」
  assert.equal(t.observe({ id: 'child', header: { origin: 'subagent', parentSession: 'parent' } }), 'parent');
  assert.equal(t.current(), 'parent');
  // 用户 fork 出来的独立对话不归并
  assert.equal(t.observe({ id: 'fork', header: { parentSession: 'parent' } }), 'fork');
  // 优先级：exec.sessionId → exec.session.id → exec.agent.session.id
  assert.equal(t.fromExec({ sessionId: 'a', session: { id: 'b' } }).field, 'exec.sessionId');
  assert.equal(t.fromExec({ session: { id: 'b' }, agent: { session: { id: 'c' } } }).field, 'exec.session.id');
  const real = t.fromExec({ agent: { id: 'child', session: { id: 'child', header: { origin: 'subagent', parentSession: 'parent' } } } });
  assert.deepEqual(real, { id: 'parent', raw: 'child', field: 'exec.agent.session.id' });
});

ok('账本可按 id 更新（异步子智能体回填依赖它）', () => {
  L.appendEntry({ id: 'test-upd', at: Date.now(), kind: 'subagent', label: 'x', settledUsd: 0, requests: 0 });
  const r = L.updateEntryById('test-upd', { settledUsd: 1.5, requests: 3, label: 'x · 3 请求' });
  assert.equal(r.settledUsd, 1.5);
  const back = L.readEntries().find((x) => x.id === 'test-upd');
  assert.equal(back.settledUsd, 1.5);
  assert.equal(back.requests, 3);
  assert.equal(back.label, 'x · 3 请求');
  assert.equal(L.updateEntryById('no-such-id', { settledUsd: 9 }), null, '未知 id 应返回 null');
});

console.log(`\n${pass} 组断言全部通过`);
fs.rmSync(tmp, { recursive: true, force: true });
