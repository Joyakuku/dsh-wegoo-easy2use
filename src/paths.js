/**
 * paths.js — 插件数据目录的唯一出处，其余模块一律从这里取路径。
 *
 *   默认      <插件根>/data/
 *   覆盖      WEGOO_DATA_DIR=<目录>（测试靠它隔离）
 *   旧版位置  ~/.dsh/wegoo/
 *
 * 迁移规则（只在第一次解析数据目录时检查一次）：
 *   - 设了 WEGOO_DATA_DIR → 不迁移（避免把真实 key 拷进临时目录）
 *   - 旧目录存在且新目录不存在 → 整体拷贝过来；旧目录原样保留，不删除
 *   - 先拷到同级临时目录再 rename，拷到一半失败不会留下半成品的 data/
 *
 * 插件在 profile 里是 file: 依赖（符号链接），Node 解析 import.meta.url 时会落到真实路径，
 * 所以 data/ 始终在仓库目录里，而不是 node_modules 下。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MIGRATION_MARKER = '.migrated-from-legacy.json';

/** 旧版数据目录。每次现算，跟随当前 HOME。 */
export function legacyDir() {
  return path.join(os.homedir(), '.dsh', 'wegoo');
}

function overrideDir() {
  const raw = String(process.env.WEGOO_DATA_DIR || '').trim();
  return raw ? path.resolve(raw) : '';
}

const checked = new Set();
let migration = null;

/** 当前数据目录。第一次解析默认目录时顺带做一次旧目录迁移。 */
export function dataDir() {
  const override = overrideDir();
  const dir = override || path.join(PLUGIN_ROOT, 'data');
  if (!checked.has(dir)) {
    checked.add(dir);
    migration = override
      ? { migrated: false, reason: 'override', to: dir }
      : migrateLegacy({ from: legacyDir(), to: dir });
  }
  return dir;
}

/** 最近一次迁移检查的结果（给诊断日志用）。 */
export function migrationStatus() {
  return migration;
}

/**
 * 把旧目录整体拷到新目录。只在「旧的在、新的不在」时动手，绝不删除旧目录。
 * 显式传 from / to，方便测试在临时目录里验证。
 */
export function migrateLegacy({ from, to }) {
  if (!from || !to) return { migrated: false, reason: 'bad-args' };
  if (fs.existsSync(to)) return { migrated: false, reason: 'target-exists', to };
  if (!fs.existsSync(from)) return { migrated: false, reason: 'no-legacy', from };
  const staging = `${to}.migrating-${process.pid}-${Date.now().toString(36)}`;
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, staging, { recursive: true, preserveTimestamps: true });
    fs.writeFileSync(
      path.join(staging, MIGRATION_MARKER),
      `${JSON.stringify({ from, at: new Date().toISOString(), note: '一次性拷贝；旧目录保留未删' }, null, 2)}\n`,
      'utf8',
    );
    fs.renameSync(staging, to);
    return { migrated: true, from, to };
  } catch (err) {
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* ignore */ }
    return { migrated: false, reason: 'error', from, to, error: String(err?.message || err) };
  }
}

export function dataFile(...parts) {
  return path.join(dataDir(), ...parts);
}

export const configPath = () => dataFile('config.json');
export const ledgerPath = () => dataFile('ledger.jsonl');
export const limitsPath = () => dataFile('limits.json');
export const ratesPath = () => dataFile('rates.json');
export const calibrationPath = () => dataFile('calibration.json');
export const pingLogPath = () => dataFile('client-ping.log');
export const outputDir = () => dataFile('output');

/** 插件自带技能文件（随包分发）。 */
export function skillSourceFile() {
  return path.join(PLUGIN_ROOT, 'skills', 'wegoo-visual', 'SKILL.md');
}

/** 技能安装位置：DSH 的用户级技能根目录。 */
export function skillInstallFile() {
  return path.join(os.homedir(), '.dsh', 'skills', 'wegoo-visual', 'SKILL.md');
}

/** 写文件前确保父目录存在。 */
export function ensureParent(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
}
