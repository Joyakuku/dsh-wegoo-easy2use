# dsh-wegoo-easy2use

wegoo（New-API 内核）的 DeepSeek Harness 插件：**图像/视频生成 + 逐次费用结算 + 预算闸门**。

## 配置

**插件详情页**里有一块 `wegoo` 配置卡片（图开关、Key、限额），保存后**下一次工具调用生效**，不用重启。

卡片走宿主自己的 settings 服务（`namespace = wegoo`），写入 `$DSH_HOME/settings.yaml`。

命令行/文件两条备用路径：

1. 对话里调 `wegoo_config`（写 `<插件目录>/data/config.json`，优先级高于 settings 之外的最后兜底）
2. 直接编辑 `D:\Code\dsh-wegoo-easy2use\data\config.json`

> 优先级：`settings`（详情页面板）> `config.json`（手动覆盖）> 组合配置。

- 三类花费（子智能体 / 图像 / 视频）共用一份流水，每条带 `sessionId`；`session` 口径只统计当前对话
- 报价先过闸门：超限直接拒绝，**不发任何上游请求**
- 没有审批通道：权限为 `never` 时全放行，靠限额兜底（fail-closed）

## 触发规则

图像 / 视频两组的开关左边有「触发规则」按钮，弹窗里可选：

- **始终允许**（默认）：任何任务都能调用，只受预算闸门和确认弹窗约束
- **仅命中触发词时**：最近一条用户消息里出现任意一个触发词才允许生成，否则工具直接拒绝并说明原因

触发词一行一个（也可用逗号分隔），例如 `产品图`、`logo`、`做 demo`。判定用的是**最近一条用户消息原文**，不是模型自己的判断——所以能否触发由你说的话决定。

命中时，确认弹窗里会显示「命中「xxx」」。

## 数据目录

全部本地数据都在插件目录下的 `data/`（路径统一由 `src/paths.js` 解析）：
`config.json` `ledger.jsonl` `limits.json` `rates.json` `calibration.json` `client-ping.log` `panel.html` `output/`。

- 第一次运行时，如果旧目录 `~/.dsh/wegoo/` 存在而 `data/` 不存在，会**整体拷贝**过来一次（写入 `.migrated-from-legacy.json` 标记），**旧目录保留不删**。
- 设置环境变量 `WEGOO_DATA_DIR=<目录>` 可改用别的目录；此时**不做迁移**（测试靠它隔离，避免把真实 key 拷进临时目录）。
- `data/` 里有 API Key：已写进 `.gitignore`，也不在 `package.json` 的 `files` 里，不会被打包。

## 安装

已经接进 `~/.dsh/profiles/desktop`：

```json
"dependencies": { "dsh-wegoo-easy2use": "file:D:/Code/dsh-wegoo-easy2use" },
"dsh": { "profile": { "bundles": [ ..., "dsh-wegoo-easy2use" ] } }
```

改完**重启 DSH** 生效。

## 设置页字段

| 字段 | 默认 | 说明 |
|---|---|---|
| `baseUrl` | `https://ai.wegoo.site` | 中继地址 |
| `image.enabled` | `false` | **是否允许调用图像 API** |
| `image.apiKey` | 空 | 图像分组的 Key（Image Lite / Image Plus 是独立分组） |
| `image.defaultModel` | 空 | 留空时取该 key 扫到的第一个固定价模型 |
| `image.maxUsdPerCall` | `0.5` | 图像单次绝对上限 |
| `video.enabled` | `false` | **是否允许调用视频 API** |
| `video.apiKey` | 空 | 视频分组的 Key（Video Plus） |
| `video.defaultModel` | 空 | 留空时取该 key 扫到的第一个模型 |
| `video.maxUsdPerCall` | `1.5` | 视频单次绝对上限 |
| `limits.perCallUsd` | `0.1` | 单次上限（与上面两个取较小者） |
| `limits.totalUsd` | `1.0` | 总额上限 |
| `limits.totalScope` | `day` | `day` / `session` / `all` |
| `limits.perMinute` | `6` | 每分钟最多调用次数 |
| `outputDir` | 空 | 留空用 `<插件目录>/data/output` |

> **限额改动后统计基线重置**：fingerprint 一变就把 `baselineAt` 推到当前时刻，
> 总量从新起点算，历史流水保留。

## 工具

| 工具 | 作用 | 花钱 |
|---|---|---|
| `wegoo_models` | 扫两个 key，列出真正能调的模型与单价 | 否 |
| `wegoo_image` | 固定价出图，落盘 + 附件 | 是 |
| `wegoo_video` | 建任务 → 轮询 → 下载 → 结算 | 是 |
| `wegoo_usage` | 逐条请求日志 + 本地账本 | 否 |
| `wegoo_panel` | 生成结算面板 HTML | 否 |

## 费用是怎么算的

**唯一可信来源是 `/api/log/token`**。每个请求带一个 `quota` 字段：

```
1 USD = 500,000 quota
```

调用前后各抓一次日志，按 `id` 取差集求和 —— 这就是精确到单次请求的金额。

> `/v1/dashboard/billing/usage` 不能用：它忽略日期参数，永远返回同一个账户总额。

计价两种：

| `quota_type` | 含义 | 报价 |
|---|---|---|
| `1` | 固定价，`model_price` 即单次美元价 | **精确**（图像） |
| `0` | 按 token，`model_ratio` 倍率 | 需要校准（视频） |

## 视频必须先校准

视频按 token 计费，一次 `5s@720p` 到底多少 token 无法预知。**没有校准数据时工具直接拒绝报价**，不会瞎猜。

跑通一次后回填 `<插件目录>/data/calibration.json`：

```json
{
  "wan3-15|5|720p": { "rangeUsd": [0.28, 0.42], "samples": 1 }
}
```

键的格式是 `模型|时长|分辨率`（缺省用空串）。

## 结算面板

`wegoo_panel` 生成 `<插件目录>/data/panel.html`，是一个自包含页面（无外部依赖）：

- 顶部额度尺 + 作用域小计
- 时间倒序的滚动流水，跨日分组带小计
- 每条显示 `报价 → 结算` 与偏差
- 状态：`●` 运行中 / `✓` 完成 / `✕` 失败 / `⊘` 中止

## 已知限制

- **子智能体只能事后结算**：靠 `tool/call` 记游标、`tool/result` 取差额，调用本身无法在中途拦住；
  同一 key 并发跑多个子智能体时，差额会互相串账（建议每个来源用独立的 key）。
- **配置实时生效依赖 settings 提供方**：已挂载 `@deepseek-ai/dsh-settings-file`，
  改完限额/开关会立即生效；若该提供方没起来，插件回退到启动时的组合配置，需重启。
- **拿不到账户余额**：`sk-` 权限下 `/api/user/self` 返回 401，只能显示累计已花。

## 自检

```bash
node test/smoke.mjs   # 预算 / 账本 / 面板 纯逻辑
node test/host.mjs    # 模拟 ctx 跑 apply()，检查工具契约
```
