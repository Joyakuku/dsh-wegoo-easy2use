/**
 * client.mjs — 浏览器侧入口的契约检查。
 *
 * 重点盯住一个曾经踩过的坑：`plugins.detail.actions` 是**列表插槽**，
 * DSH 会在每一个插件的详情页上都渲染它。注册进去的组件必须自己判断
 * 「这是不是我的页面」，否则所有插件详情页都会冒出 wegoo 的设置表单。
 *
 * 这个测试用最小 DOM/React 桩把 client.js 跑起来，直接调用注册的组件，
 * 断言它只在自己的 package 名下渲染。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'src', 'client.js'), 'utf8');

/** 最小元素桩：只提供 client.js 真正会碰到的属性与方法。 */
function fakeEl() {
  const el = {
    style: {},
    innerHTML: '',
    textContent: '',
    className: '',
    isConnected: true,
    childElementCount: 0,
    offsetWidth: 0,
    appendChild() {},
    addEventListener() {},
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    closest: () => null,
  };
  return el;
}

const registrations = [];
let captured = null;

const windowStub = {
  innerWidth: 1280,
  innerHeight: 800,
  addEventListener() {},
  __ModuleLoader__: {
    load({ id, factory }) {
      captured = { id, module: factory(() => React) };
    },
  },
};

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (v) => [v, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
};

globalThis.window = windowStub;
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'node-test' },
  configurable: true,
  writable: true,
});
globalThis.document = {
  baseURI: 'http://localhost/',
  getElementById: () => null,
  createElement: fakeEl,
  head: { appendChild() {} },
  body: { appendChild() {}, childElementCount: 0 },
  documentElement: { clientWidth: 1280 },
};
globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });

// client.js 是一个 IIFE，读取 window.__ModuleLoader__ 后自行注册。
new Function(source)();

assert.ok(captured, 'client.js 必须调用 __ModuleLoader__.load');
assert.equal(captured.id, 'dsh-wegoo-easy2use', `模块 id 必须是包名，实际：${captured.id}`);
assert.equal(typeof captured.module.apply, 'function', '必须导出 apply');
assert.ok(Array.isArray(captured.module.inject), '必须导出 inject');

const ctx = {
  slots: {
    inject(_name, register) {
      register();
    },
    register(config, component) {
      registrations.push({ config, component });
      return () => {};
    },
  },
};

captured.module.apply(ctx);
assert.equal(registrations.length, 1, 'apply 应当只注册一个详情页插槽');
const { config, component } = registrations[0];
assert.equal(config.name, 'plugins.detail.actions');
assert.equal(typeof component, 'function');

// 关键断言：别人的插件详情页，必须什么都不渲染。
assert.equal(
  component({ subject: { pkg: { name: 'ds-harness-remote' } } }),
  null,
  '其他插件的详情页不能渲染 wegoo 面板',
);
// 自己的页面才渲染
const own = component({ subject: { pkg: { name: 'dsh-wegoo-easy2use' } } });
assert.ok(own && own.type, '自己的详情页必须渲染面板');

// 没有 subject 时也不能崩，且不渲染
assert.equal(component({}), null, '缺少 subject 时应当安静地不渲染');
assert.equal(component(), null, '无参数时应当安静地不渲染');

console.log('client 契约检查通过：面板只在 dsh-wegoo-easy2use 的详情页渲染');
process.exit(0);
