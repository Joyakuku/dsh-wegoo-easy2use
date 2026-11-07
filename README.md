# dsh-wegoo-easy2use

<img src="docs/wordmark.png" width="420" alt="Wegoo" />

wegoo（New-API 内核）的 DeepSeek Harness 插件：**图像 / 视频生成 + 逐次费用结算 + 预算闸门**。

生成的图与视频落在 `<插件目录>/data/output/<日期>/`，花费实时汇总到右上角悬浮结算窗。

## 快速开始

1. 装插件、重启 DSH（安装方式见文末）
2. 打开插件详情页 → 填两个 API Key → 点「刷新」拉模型列表 → 选默认模型 → 保存
3. 对话里让它出图：**每次生成前都会弹确认卡片，点「确认生成」才真的发请求**

## 三道闸门

花钱的动作按这个顺序过三关，任何一关不过都不会产生上游请求：

| 顺序 | 关卡 | 说明 |
|---|---|---|
| 1 | 技能触发（软） | 模型按 `wegoo-visual` 技能描述做语义判断，决定这次任务该不该生成 |
| 2 | 确认卡片（硬） | 宿主 `userQuestions` 弹选项卡，报价写明金额；点「取消」= 零请求零费用 |
| 3 | 预算闸门（硬） | 单次 / 总额 / 每分钟三条限额，超限直接拒绝；**只统计图像与视频** |

技能是**软约束**（模型自行判断），真正拦住花钱的是第 2、3 关。

子智能体（Codex / Claude Code）的花费**不进入闸门**：它们异步跑，工具层拦不住，占额度只会
让正常出图被莫名拒绝。这类花费照常记进账本和面板（`AGENT` 胶囊），但不占生成额度。

## 触发方式（技能）

插件自带技能 `wegoo-visual`，随插件分发：

- 源文件：`<插件目录>/skills/wegoo-visual/SKILL.md`
- 首次运行装到 `~/.dsh/skills/wegoo-visual/SKILL.md`；已存在则不覆盖，以你的修改为准
- 技能根目录被实时监听，改完**不用重启**

触发由**模型按描述做语义判断**，不需要你说出固定字眼。描述里同时写「适用于什么任务」和
「不适用于什么任务」，后者能让模型在画流程图、做 UI 截图时主动不用生成。

设置面板里每组开关左边的「触发描述」按钮直接编辑这段描述，保存写入 SKILL.md 的
`description` 字段。

## 配置

读取时以 `settings`（宿主设置服务，初值取自组合配置）为底，再叠加 `data/config.json` —— **文件优先**，因为面板和 `wegoo_config` 都写这个文件。

两条写入路径：

1. 插件详情页的表单 —— 走 `/dsh-wegoo` 路由，写 `data/config.json`，**下一次工具调用生效**
2. 对话里调 `wegoo_config`

| 字段 | 默认 | 说明 |
|---|---|---|
| `baseUrl` | `https://ai.wegoo.site` | 中继地址 |
| `image.enabled` | `false` | 允许调用图像 API |
| `image.apiKey` | 空 | 图像分组 Key（Image Lite / Image Plus 是独立分组） |
| `image.defaultModel` | 空 | 留空取该 key 扫到的第一个固定价模型 |
| `image.maxUsdPerCall` | `0.5` | 图像单次绝对上限 |
| `video.enabled` | `false` | 允许调用视频 API |
| `video.apiKey` | 空 | 视频分组 Key（Video Plus） |
| `video.defaultModel` | 空 | 留空取该 key 扫到的第一个模型 |
| `video.maxUsdPerCall` | `1.5` | 视频单次绝对上限 |
| `limits.perCallUsd` | `0.1` | 单次上限，与上面两个取较小者 |
| `limits.totalUsd` | `1.0` | 总额上限 |
| `limits.totalScope` | `day` | `day` / `session` / `all` |
| `limits.perMinute` | `6` | 每分钟最多调用次数 |
| `tracking.enabled` | `true` | 是否把子智能体花费记进面板（只影响显示，不参与闸门） |
| `outputDir` | 空 | 留空用 `<插件目录>/data/output` |

统计口径：`day` 以**本地零点**为界，改限额不会把当天已花的钱清零；`session` 按 `sessionId`
只算当前对话（历史条目没有 `sessionId`，不计入任何会话）。

## 工具

| 工具 | 作用 | 花钱 |
|---|---|---|
| `wegoo_models` | 扫两个 key，列出真正能调的模型与单价 | 否 |
| `wegoo_image` | 出图；传 `image` 参数则走图生图 / 图像编辑 | 是 |
| `wegoo_video` | 建任务 → 轮询 → 下载 → 结算 | 是 |
| `wegoo_usage` | 逐条请求日志 + 本地账本 | 否 |
| `wegoo_config` | 读写配置（key 打码） | 否 |

## 费用怎么算

唯一可信来源是 `/api/log/token`，每行带 `quota`：`1 USD = 500,000 quota`。

账单行的 `content` 直接写出计费参数，可以反推单价：

| 类型 | 账单原文 | 规律 |
|---|---|---|
| 视频 | `Action text_to_video, Billing parameters: seconds: 5, resolution: 720p` | 每秒单价 × 秒数 × 分辨率系数 |
| 图像 | `Size 1024x1024, Quality standard, Image count 1` | 档位固定价 × 分组倍率（±1%） |
| 下载 | `Traffic fee for this task download` | 字节数 × 费率 |

**事前估算 + 事后校准**：

1. 调用前按单价表算出金额
2. 成功返回就先用估算值记账 —— 面板立刻是对的
3. 后台查真实流水，偏差 ≤ 5% 保留估算值，> 5% 才覆盖并记下偏差

单价表会**自动学习**：每笔真实账单都会回写 `data/rates.json`，模型再多也会自己收敛。

> `/v1/dashboard/billing/usage` 不能用：它忽略日期参数，永远返回同一个账户总额。

## 视频必须先校准

视频按 token 计费，一次 `5s@720p` 到底多少 token 无法预知。**没有校准数据时工具直接拒绝报价**，
不会瞎猜。跑通一次后回填 `data/calibration.json`：

```json
{ "wan3-15|5|720p": { "rangeUsd": [0.28, 0.42], "samples": 1 } }
```

键格式 `模型|时长|分辨率`（缺省用空串）。已实测：`grok-imagine-video` 5s/720p ≈ **$1.05**。

`sd2.0-*` 与 `wan3-*` 是**图生视频**，必须传 `image` 参考图。

## 结算面板

右上角悬浮窗，每 5 秒刷新一次：

- 折叠态：圆点 + 累计金额，超限变红
- 展开态：主金额、预算条、剩余额度、三档切换（今日 / 本次会话 / 累计）、最近 12 条流水
- 每条显示 `报价 → 结算`，类型用彩色胶囊区分 IMAGE / VIDEO / AGENT

## 数据目录

全部本地数据在插件目录下的 `data/`，路径统一由 `src/paths.js` 解析：

`config.json` `ledger.jsonl` `limits.json` `rates.json` `calibration.json` `client-ping.log` `output/`

- 首次运行时若旧目录 `~/.dsh/wegoo/` 存在而 `data/` 不存在，**整体拷贝一次**并写
  `.migrated-from-legacy.json` 标记，**旧目录保留不删**
- 设 `WEGOO_DATA_DIR=<目录>` 可改用别的目录，此时**不迁移**（测试靠它隔离）
- `data/` 含 API Key：已进 `.gitignore`，也不在 `package.json` 的 `files` 里

## 架构

```
src/index.js     宿主入口：5 个工具、/dsh-wegoo 路由、会话事件、结算回填
src/client.js    浏览器侧：配置面板 + 结算角标（纯 DOM，无构建步骤）
src/relay.js     HTTP 客户端：生成、任务轮询、日志、二进制下载
src/catalog.js   模型目录：/v1/models × /api/pricing
src/rates.js     事前估算 + 单价学习（QUOTA_PER_USD 的唯一定义处）
src/ledger.js    账本、限额判定、读取缓存
src/session.js   会话 id 追踪（本次会话口径）
src/specs.js     工具 schema 与描述
src/config.js    schemastery 配置
src/paths.js     数据目录、技能路径、旧目录迁移
skills/          wegoo-visual 技能（随插件分发）
scripts/sync.mjs 把源码镜像到 profile 的安装副本
test/            smoke / host / client 三套自检
```

性能上做了三件事：账本读取按 `mtime+size` 缓存、角标与面板在数据未变化时不碰 DOM、
`settleSince` 只在有未决子智能体时才请求 relay。

## 开发约定

### 装在哪

插件是 profile 的 npm 依赖，装在 `<DSH_HOME>/profiles/<profile>/node_modules/<包名>`；
源码在 `D:\Code_workspace\dsh_plugin\dsh-wegoo-easy2use`。两者是两份，**改完源码必须同步**。

### 改完怎么生效

| 改的是 | 生效方式 |
|---|---|
| `src/*.js`（宿主侧、面板、角标） | `npm run sync` → **重启 DSH** |
| `skills/wegoo-visual/SKILL.md` | 写进 `~/.dsh/skills/wegoo-visual/` 后**热加载**，不用重启 |
| `README.md`、`docs/` | `npm run sync`（只影响插件详情页的显示） |

### 同步

```bash
npm run sync              # 目录按镜像同步，副本里多出来的文件会被删掉
npm run sync -- --dry-run # 只看会动哪些
```

`data/` 完全不动——账本、API Key、视频校准、单价学习都在里面。

### 自检

```bash
npm run test   # smoke（15 组断言）+ host（模拟 ctx 跑 apply）+ client（样式注入与作用域）
```

`node_modules/` 不入库。克隆后建一次软链，自检才能解析宿主自己的包：

```bash
ln -sfn ~/.dsh/profiles/node_modules/@deepseek-ai node_modules/@deepseek-ai
```

### 版本与发布

- `package.json` 与 `dsh.plugin.json` 的 `version` 两处保持一致
- `npm pack --dry-run` 核对打包内容；`files` 漏了 `docs` 会让 README 图片 404
- 图标是 `icon.svg`（36×36），同时声明在 `package.json` 的 `icon` 字段与 `exports["./icon"]`

### 路由契约

面板不依赖宿主 RPC，走插件自己的 HTTP 前缀路由 `webServer.register({ kind: 'prefix', path: '/dsh-wegoo' })`：

| 端点 | 作用 |
|---|---|
| `get` | 读配置（key 打码） |
| `set` | 写 `data/config.json`，下一次工具调用生效 |
| `models` | 用给定 key 拉模型列表与单价 |
| `ledger` | `spent`（闸门口径，只含图/视频）、`spentAll`（含子智能体） |
| `skill` | 读写 `wegoo-visual` 的 `description` |
| `ping` | 客户端存活上报，写 `client-ping.log` |

请求体 `{ type: 'client-request', rpcId, method, payload }`，
响应 `{ type: 'server-response', rpcId, result: { ok, value | error } }`。

## 已知限制

- **拿不到账户余额**：`sk-` 权限下 `/api/user/self` 返回 401，只能显示累计已花。
- **子智能体花费只是记账**：异步执行、无法在中途拦住，所以不计入预算闸门；账本里仍然可见。
- **技能是软约束**：模型可能该用不用，或不该用却用了；硬拦截只有确认卡片和预算闸门。

## 界面预览

| 结算角标 | 配置表单 | 触发描述 |
|---|---|---|
| ![](docs/ui-pill.png) | ![](docs/settings-form.png) | ![](docs/settings-skill.png) |
