# dsh-model-request-counter

DeepSeek Harness 的模型使用统计插件，以标准 Cordis 插件形式开发（宿主半体 + 浏览器半体）：

- **宿主半体**（`lib/index.js`，经 `cordis.patch.yml` 装载）：注册 `modelRequestCounts` 会话投影，扫描 `$DSH_HOME/sessions` 全部历史会话，提供数据 API。
- **浏览器半体**（`client/index.js`，经 `dsh.client` 声明进入启动图）：Cordis 客户端插件，在设置面板注册「使用统计」分区（React 组件 + 槽位系统），随官方插件一起由 `/plugins` combo 批次加载。

## 安装

```sh
dsh plugin --profile web add D:\deepseek-harness\dsh-model-request-counter
```

> 注意：安装/卸载插件前先停掉正在运行的 `dsh web`，避免 pnpm 写锁文件失败导致 profile 状态损坏。

安装后（重新）启动 `dsh web`：

- 主界面右下角常驻一个 **「今日 N 次 · X tok」** 悬浮入口，点击展开当日各供应商的调用次数与 token 用量卡片（见下）。
- 打开设置面板（左下角设置图标），左侧导航会出现 **「使用统计」** 分区。

## 主界面悬浮入口（shell.overlay）

- 主界面右下角常驻小胶囊，实时显示 **今日请求数与 token 总量**（每分钟自动刷新，悬停有提示）。
- 点击展开用量卡片：
  - 当日汇总：总请求数、tokens 总量（含 ≈万 换算）、成本、日期；
  - 每个供应商一行：调用次数、模型数、成本、tokens 总量（含 ≈万 换算）、输入/输出/缓存命中/缓存创建明细，以及一条与趋势图同色的 token 构成条（蓝=输入、绿=输出、橙=缓存创建、紫=缓存命中）；
  - 「打开完整统计 ↗」打开 `/usage` 独立页面：Web 版在新标签页打开；**桌面版（Electron）在当前窗口打开**（桌面壳对非 http/https 的 `window.open` 一律拒绝，插件检测到 `dsh-app://` 源后原地导航，`/usage` 页左上角有「← 返回」回到主界面）。
- 点击卡片外任意处或按 `Esc` 关闭；数据来自轻量接口 `/api/model-usage/summary`。
- **显示开关**：设置 → 使用统计 → 设置 → 「界面」→「在主界面显示悬浮用量入口」，关闭立即生效（偏好保存在浏览器 localStorage，刷新/重启后保持）。

## 分发给其他人

插件就是一个自包含的文件夹，复制即分发：把 `dsh-model-request-counter` 整个文件夹打包成 zip 发给对方即可（**必须包含 `node_modules`**——pnpm 以 `link:` 软链接方式安装本地目录，不会替它安装依赖，所以 zod 要随文件夹携带）。

对方拿到后三步安装：

```sh
# 1) 解压到任意固定位置（安装后不要移动/删除这个文件夹——profile 里是软链接指向它）
# 2) 停掉正在运行的 dsh web，然后：
dsh plugin --profile web add <解压路径>\dsh-model-request-counter
# 3) 重新启动 dsh web
```

说明：

- **数据完全独立**：插件读取的是对方自己 `$DSH_HOME/sessions` 下的会话记录；定价规则和统计归档也各自保存在对方的 `$DSH_HOME`（`model-usage-pricing.json` / `model-usage-archive.json`），互不影响。
- **升级**：用新版文件覆盖对方机器上的插件文件夹内容，重启 `dsh web` 即可（link 安装指向文件夹本身）。
- **卸载**：`dsh plugin --profile web remove dsh-model-request-counter`。
- 也可以走 **git 仓库**（`dsh plugin --profile web add <git-url>`，本插件无 prepare 构建脚本，无需额外配置）或发布到 npm 后按包名安装；本地文件夹 / tarball / git / registry 四种 pnpm 支持的形式都可以。

## 使用统计分区功能

### 概览卡片
真实消耗 Tokens（输入+输出+缓存）、总请求数、总成本、输入/输出 Tokens、缓存创建、缓存命中、缓存命中率。

### 使用趋势图
按小时堆叠柱状图（蓝=输入、绿=输出、橙=缓存创建、紫=缓存命中）+ 红色成本折线（右轴），悬停查看每小时明细。

### 请求日志
每条模型请求一行：时间、供应商、模型、输入/输出/缓存 tokens、成本、耗时、首字延迟、状态（成功 200 / 失败显示错误码或 HTTP 状态）。重试的失败请求各占一行。

### 按模型汇总
每个 provider/model 的请求数、tokens、成本、平均耗时、平均首字、成功率。

### 设置
- **界面**：主界面悬浮入口的显示开关（见上文「主界面悬浮入口」）。
- **成本定价**：按 `provider/model` 精确匹配、`provider/*` 供应商通配、`*` 兜底的定价规则（每百万 tokens 美元数，含缓存读/写价）。保存后立即生效并按新定价重算全部历史成本。规则持久化在 `$DSH_HOME/model-usage-pricing.json`。

分区仅在选中时挂载并取数（设置面板只渲染当前分区），日期切换/刷新/重新扫描按需请求。

## 数据来源与口径

- **自动扫描**：直接读取 `$DSH_HOME/sessions/` 下全部会话记录（zstd JSONL，逐帧解码），覆盖所有历史会话；按文件 mtime 缓存（跨重启持久化），「重新扫描」强制重读磁盘文件。
- **一次请求 = 一条记录**：`assistant/message`（成功/中断/max-tokens）和 `assistant/attempt`（失败重试）各计一条。
- **去重**：fork 出的子会话跳过继承自父会话的前缀，避免重复计数。
- **成本**：默认只内置 DeepSeek 官方模型价格，其他第三方供应商需在设置页配置。
- **归档保留**：会话文件从磁盘删除后，其统计数据自动归档保留（持久化在 `$DSH_HOME/model-usage-archive.json`）——删除会话不丢统计；会话文件版本轮换（如 `session.v1.jsonl` 取代 `session.jsonl`）不会误归档旧版本。工具栏「清除归档」按钮可彻底移除归档数据（不可恢复）；「重新扫描」只重读磁盘文件、不影响归档。

## HTTP 接口（宿主半体提供）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/usage` | 独立统计页面（HTML，不依赖设置面板的直达入口） |
| GET | `/api/model-usage?date=YYYY-MM-DD&rescan=1` | 当日明细 + 全部日期汇总（`rescan=1` 强制重读磁盘） |
| GET | `/api/model-usage?purgeArchive=1` | 清除已归档（磁盘上已删除会话）的统计数据 |
| GET | `/api/model-usage?from=YYYY-MM-DD&to=YYYY-MM-DD` | 日期范围查询 + 按天聚合 |
| GET | `/api/model-usage/summary?date=YYYY-MM-DD` | 当日按供应商汇总（悬浮入口数据源，缺省=今天） |
| GET | `/api/model-usage/counts` | 实时活跃会话请求计数（来自投影 onChanged 推送） |
| GET | `/api/model-usage/export?format=csv|json&date=…&from=…&to=…&scope=log|models` | 数据导出（CSV/JSON） |
| GET/PUT | `/api/model-usage/pricing` | 定价规则读取/保存 |
| **New** | `/static/model-usage-shared.js` | 共享格式化库（被 dashboard.html 加载，与 client 端逻辑同源） |

## Cordis 插件结构

```
├── package.json          # dsh.bundle.patch（宿主层）+ dsh.client（浏览器 roster）
├── cordis.patch.yml      # 宿主行：id model-request-counter
├── lib/
│   ├── index.js          # 宿主 apply(ctx)：投影注册 + onChanged 订阅 + webServer 路由
│   ├── types/index.js    # modelRequestCounts 投影定义
│   ├── types/client.js   # client 侧投影工具函数导出
│   ├── usage-scan.js     # 会话日志磁盘扫描器（zstd 解码 + 事件折叠 + 持久化归档）
│   ├── pricing.js        # 定价规则（默认值 + 文件持久化 + 成本计算）
│   ├── dashboard.html    # /usage 独立页面（加载 shared.js 共享格式化）
│   └── static/
│       └── shared.js     # 纯格式化库（被 dashboard.html 加载，window.__MRC__）
└── client/
    └── index.js          # 浏览器 apply(ctx)：单文件，settings.section 分区 + shell.overlay 悬浮入口
                          # （含单日/范围切换、DailyChart、CSV/JSON 导出）
```

> 说明：DSH 的客户端模块加载器只为每个插件加载**单个入口文件**（`client/index.js`），不支持 `require("包名/子路径")` 解析到插件内兄弟文件。因此浏览器半体的全部实现（样式、格式化、图表、表格、定价编辑器、悬浮胶囊、统计分区）都放在这一个文件里，按 `#region` 分节组织，便于维护。

浏览器半体契约：`window.__ModuleLoader__.load({id, factory})`，factory 内 `require("react")`（shell 静态种子），导出 `{apply, inject: ["slots"]}`；`ctx.slots.inject("settings.section", ...)` 在槽位声明后注册分区（order 20，位于 general=0 / models=10 / plugins=15 之后）；`ctx.slots.inject("shell.overlay", ...)` 注册主界面悬浮入口（ui-layout 的 overlay 层，`position:absolute; inset:0; z-index:20`，子元素恢复 pointer-events）。