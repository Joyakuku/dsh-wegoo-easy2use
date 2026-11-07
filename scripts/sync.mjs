#!/usr/bin/env node
/**
 * sync.mjs — 把仓库里的改动同步到 DSH profile 的安装副本。
 *
 * 为什么需要它：DSH 读插件图标（以及其它包内文件）时会解析 realpath，
 * 软链指到 profile 之外会被拒绝，所以插件必须以**实体目录**装在
 *   <DSH_HOME>/profiles/<profile>/node_modules/<包名>
 * 里。于是「改源码」和「跑起来的代码」是两份，需要显式同步。
 *
 * 用法：
 *   node scripts/sync.mjs            # 同步到默认 profile（desktop）
 *   node scripts/sync.mjs --profile other
 *   node scripts/sync.mjs --dry-run
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const NAME = PKG.name;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const profileArg = args.indexOf('--profile');
const profile = profileArg >= 0 ? args[profileArg + 1] : (process.env.DSH_PROFILE || 'desktop');

const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const target = path.join(dshHome, 'profiles', profile, 'node_modules', NAME);

/** 同步哪些内容：运行时要用的 + 文档；跳过 git、依赖和运行时数据。 */
const SKIP_TOP = new Set(['.git', 'node_modules', 'data', '.github', 'scripts']);
const INCLUDE = ['src', 'skills', 'docs', 'test', 'package.json', 'dsh.plugin.json', 'cordis.patch.yml', 'icon.svg', 'icon.png', 'README.md'];

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dst);
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dst);
    }
  }
}

function countFiles(dir) {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countFiles(path.join(dir, entry.name));
    else n += 1;
  }
  return n;
}

if (!fs.existsSync(target)) {
  console.error(`目标不存在：${target}`);
  console.error('先确认插件已装进该 profile（npm 依赖或插件管理器安装）。');
  process.exit(1);
}
const stat = fs.lstatSync(target);
if (stat.isSymbolicLink()) {
  console.error(`目标仍是符号链接：${target}`);
  console.error('DSH 读不到 profile 之外的文件（图标会退化成默认占位）。');
  console.error('先删掉它，把仓库内容复制成实体目录：');
  console.error(`  rm "${target}" && mkdir -p "${target}" && tar -cf - --exclude=.git --exclude=node_modules . | (cd "${target}" && tar -xf -)`);
  process.exit(1);
}

let count = 0;
for (const name of INCLUDE) {
  const src = path.join(ROOT, name);
  if (!fs.existsSync(src)) continue;
  const dst = path.join(target, name);
  if (dryRun) {
    console.log(`would copy ${name}`);
    continue;
  }
  if (fs.statSync(src).isDirectory()) {
    copyDir(src, dst);
    count += countFiles(src);
  } else {
    fs.copyFileSync(src, dst);
    count += 1;
  }
}

console.log(`${dryRun ? '[dry-run] ' : ''}已同步 ${count} 个文件 → ${target}`);
console.log('运行时数据（data/）保持不动。改完重启 DSH 生效；只改客户端代码可用页面重载。');
