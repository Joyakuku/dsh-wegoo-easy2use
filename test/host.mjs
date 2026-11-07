/**
 * host.mjs — 不用真宿主，模拟一个最小 ctx 跑一遍 apply()。
 * 数据目录用 WEGOO_DATA_DIR 指到临时目录（设了它就不会迁移），避免读到/拷走你的真实配置。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wegoo-host-'));
const dataRoot = path.join(tmp, 'data');
process.env.WEGOO_DATA_DIR = dataRoot;
process.env.USERPROFILE = tmp;
process.env.HOME = tmp;

// 仓库自己的 data/ 不能被测试碰到：跑之前不存在的话，跑完也必须不存在。
const repoData = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const repoDataExisted = fs.existsSync(repoData);

const { apply, name, inject, Config } = await import('../src/index.js');
const L = await import('../src/ledger.js');

const registered = [];
const subscriptions = [];
const routes = [];
const ctx = {
  tools: { register(def) { registered.push(def); return () => {}; } },
  attachments: { async saveImage() { return { fake: true }; } },
  on(event, handler) {
    subscriptions.push({ event, handler });
    return () => {};
  },
  // 只模拟 webServer；settings / userQuestions 不回调，插件应当自己兜底。
  inject(deps, cb) {
    if (!deps.includes('webServer')) return;
    cb({
      webServer: { register(route) { routes.push(route); return () => {}; } },
      effect(fn) { fn(); },
    });
  },
};

/** 按浏览器的信封格式打一次插件路由。 */
async function rpc(method, payload) {
  const route = routes.find((r) => r.path === '/dsh-wegoo');
  assert.ok(route, '必须注册 /dsh-wegoo 前缀路由');
  const body = JSON.stringify({ type: 'client-request', rpcId: `t-${method}`, method, payload });
  const req = {
    method: 'POST',
    url: `/dsh-wegoo/${method}`,
    async *[Symbol.asyncIterator]() { yield Buffer.from(body); },
  };
  let status = 0;
  let text = '';
  const res = {
    writeHead(code) { status = code; },
    end(chunk) { text = chunk ? String(chunk) : ''; },
  };
  await route.handler(req, res);
  assert.equal(status, 200);
  const reply = JSON.parse(text);
  assert.equal(reply.rpcId, `t-${method}`);
  assert.equal(reply.result.ok, true, JSON.stringify(reply.result.error));
  return reply.result.value;
}

/** 和宿主一样：id 是原型上的 getter，Object.keys 看不到。 */
class FakeSession {
  constructor(header) { this.header = header; }
  get id() { return this.header.id; }
}

const config = {
  baseUrl: 'https://ai.wegoo.site',
  image: { enabled: false, apiKey: '', defaultModel: '', maxUsdPerCall: 0.5 },
  video: { enabled: false, apiKey: '', defaultModel: '', maxUsdPerCall: 1.5 },
  limits: { perCallUsd: 0.1, totalUsd: 1.0, totalScope: 'day', perMinute: 6 },
  outputDir: '',
};

const dispose = apply(ctx, config);

assert.equal(name, 'dsh-wegoo-easy2use');
assert.ok(inject.includes('tools'));
assert.ok(Config, 'Config 必须导出，否则设置页没有输入框');
assert.equal(typeof dispose, 'function', 'apply 必须返回 disposer');

const names = registered.map((t) => t.name).sort();
console.log('注册工具:', names.join(', '));
assert.deepEqual(names, [
  'wegoo_config', 'wegoo_image', 'wegoo_models', 'wegoo_usage', 'wegoo_video',
]);

for (const tool of registered) {
  assert.ok(tool.description && tool.description.length > 20, `${tool.name} 缺描述`);
  assert.equal(tool.parameters?.type, 'object', `${tool.name} 参数必须是 object schema`);
  assert.equal(typeof tool.execute, 'function', `${tool.name} 缺 execute`);
  assert.equal(typeof tool.output?.render, 'function', `${tool.name} 缺 output.render`);
}

// 临时 HOME 下没有任何 key，wegoo_models 必须明说未启用
const models = registered.find((t) => t.name === 'wegoo_models');
const out = await models.execute({ kind: 'all' });
assert.equal(typeof out.text, 'string');
assert.ok(out.text.includes('未启用'), `应提示未启用，实际：${out.text}`);
console.log('wegoo_models:', out.text.replace(/\n/g, ' | '));

// 未启用时，wegoo_image 必须拒绝（fail-closed）
const image = registered.find((t) => t.name === 'wegoo_image');
await assert.rejects(() => image.execute({ prompt: 'x' }), /未启用/);
console.log('wegoo_image 未启用时正确拒绝');

// 配置工具：临时 HOME 下写的是临时文件
const cfgTool = registered.find((t) => t.name === 'wegoo_config');
await cfgTool.execute({ action: 'set', patch: { image: { enabled: true, apiKey: 'sk-test' } } });
const after = await cfgTool.execute({ action: 'get' });
assert.ok(!after.text.includes('sk-test'), 'get 不应回显明文 key（应打码）');
await cfgTool.execute({ action: 'reset' });
console.log('wegoo_config set/get/reset 正常');

// 面板工具应当能落盘，而且落在临时数据目录里

const sub = subscriptions.find((s) => s.event === 'session/event');
assert.ok(sub, '必须订阅 session/event 才能结算子智能体');
sub.handler({}, { type: 'tool/call', data: { callId: 'c1', name: 'wegoo_models' } });
sub.handler({}, { type: 'tool/result', data: { message: { content: [{ callId: 'c1' }] } } });
console.log('session/event 订阅正常，无关工具被忽略');

// ── 本次会话口径 ─────────────────────────────────────────────
const now = Date.now();
L.appendEntry({ id: 'a1', at: now - 3000, kind: 'image', label: 'img-a', settledUsd: 0.03, sessionId: 's1' });
L.appendEntry({ id: 'b1', at: now - 2000, kind: 'video', label: 'vid-b', settledUsd: 0.4, sessionId: 's2' });
L.appendEntry({ at: now - 1000, kind: 'image', label: 'img-c', settledUsd: 0.05, sessionId: 's1' });
L.appendEntry({ id: 'old', at: now - 500, kind: 'image', label: 'legacy-row', settledUsd: 0.07 });

// 还没见过任何会话：session 口径为空，不拿别的对话凑数
const before = await rpc('ledger', { scope: 'session' });
assert.equal(before.sessionId, null);
assert.equal(before.entries.length, 0);
assert.equal(before.spent, 0);

sub.handler(new FakeSession({ id: 's1', createdAt: now }), { type: 'noop' });
const s1 = await rpc('ledger', { scope: 'session' });
assert.equal(s1.scope, 'session');
assert.equal(s1.sessionId, 's1');
assert.deepEqual(s1.entries.map((e) => e.label), ['img-c', 'img-a'], '只返回 s1 的条目，新的在前');
assert.ok(s1.entries.every((e) => typeof e.id === 'string' && e.id), '每条都要有稳定 id（角标按 id 做差量更新）');
assert.ok(Math.abs(s1.spent - 0.08) < 1e-9, `s1 应花 0.08，实际 ${s1.spent}`);

// 子智能体会话归到父对话，不把「当前会话」抢走
sub.handler(new FakeSession({ id: 'kid', origin: 'subagent', parentSession: 's1' }), { type: 'noop' });
assert.equal((await rpc('ledger', { scope: 'session' })).sessionId, 's1');

// 切到另一个对话：sessionId 变化，客户端据此整表重绘
sub.handler(new FakeSession({ id: 's2' }), { type: 'noop' });
const s2 = await rpc('ledger', { scope: 'session' });
assert.equal(s2.sessionId, 's2');
assert.deepEqual(s2.entries.map((e) => e.id), ['b1']);

// all 口径不看会话；没有 id 的旧记录也要拿到稳定 id（两次拉取一致）
const all = await rpc('ledger', { scope: 'all' });
assert.deepEqual(all.entries.map((e) => e.label), ['legacy-row', 'img-c', 'vid-b', 'img-a']);
const again = await rpc('ledger', { scope: 'all' });
assert.deepEqual(again.entries.map((e) => e.id), all.entries.map((e) => e.id));
console.log('ledger 接口：session 口径按对话过滤，sessionId 随对话切换');

// ── exec 结构核对：按宿主真实形状给 exec，日志里应记下命中的字段（只记字段名/类型） ──
const usage = registered.find((t) => t.name === 'wegoo_usage');
const exec = {
  token: 't', callId: 'c9', rootCallId: 'c9', name: 'wegoo_usage', signal: new AbortController().signal, arguments: {},
  agent: { id: 's1', session: new FakeSession({ id: 's1', createdAt: now }) },
};
const usageOut = await usage.execute({}, exec);
assert.ok(usageOut.text.includes('本地面板账本'));
const shapes = fs.readFileSync(path.join(dataRoot, 'client-ping.log'), 'utf8')
  .split('\n').filter((l) => l.includes('"exec-shape"'))
  .map((l) => JSON.parse(l.slice(l.indexOf(' ') + 1)));
const hit = shapes.find((s) => s.field === 'exec.agent.session.id');
assert.ok(hit, `应记录命中 exec.agent.session.id，实际：${JSON.stringify(shapes)}`);
assert.equal(hit.idTypes['exec.sessionId'], 'undefined');
assert.equal(hit.idTypes['exec.agent.session.id'], 'string');
assert.ok(!JSON.stringify(shapes).includes('"s1"'), '诊断日志不应记录 id 的值');
console.log('exec 结构:', JSON.stringify({ field: hit.field, execKeys: hit.execKeys, agentKeys: hit.agentKeys, sessionKeys: hit.sessionKeys }));

await rpc('ping', { stage: 'test-ping' });
assert.ok(fs.readFileSync(path.join(dataRoot, 'client-ping.log'), 'utf8').includes('"test-ping"'));

dispose();
if (!repoDataExisted) assert.ok(!fs.existsSync(repoData), '测试不应在仓库里建出 data/');
assert.ok(!fs.existsSync(path.join(tmp, '.dsh', 'wegoo')), '不应再写旧目录');
fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n宿主契约检查全部通过');
