# QwenTrace

Qwen Code Agent 网络请求可视化工具 — AI 版 Charles Proxy。

QwenTrace 捕获 Qwen Code 与 AI 模型（DashScope、OpenAI 兼容接口）之间的所有 HTTP 流量，并在实时 Web 面板中可视化展示。

![License](https://img.shields.io/badge/license-MIT-blue)

## 原理

QwenTrace 采用 **fetch hook** 方案 — 通过 Node.js 的 `--import` 在应用代码执行前 patch `globalThis.fetch`，透明拦截所有请求，无需 MITM 代理或证书。

```
Qwen Code ──fetch()──► Hook (register.mjs) ──► 真正的 fetch()
                           │
                           ▼
                    QwenTrace Server ──WebSocket──► Dashboard
```

Hook 利用 `ReadableStream.tee()` 分流 SSE 流，调用方看到的是完全正常的 Response，QwenTrace 在后台静默捕获每一个 chunk。

## 快速开始

```bash
# 安装依赖
npm install

# 构建前端
npx vite build

# 启动 QwenTrace 并自动注入 Qwen Code
npx tsx src/server/index.ts -- qwen
```

打开 `http://localhost:7890` 即可看到面板。

## 使用方式

### 包裹模式（推荐）

一条命令启动 QwenTrace 并自动给 Qwen Code 注入 hook：

```bash
npx tsx src/server/index.ts -- qwen
```

也可以传额外参数：

```bash
npx tsx src/server/index.ts --port 8080 -- qwen --some-flag
```

### 手动注入

分两个终端，分别启动 server 和 Qwen Code：

```bash
# 终端 1：启动 server
npx tsx src/server/index.ts --no-open

# 终端 2：带 hook 运行 Qwen Code
NODE_OPTIONS="--import /path/to/QwenTrace/src/hook/register.mjs" QWENTRACE_PORT=7890 qwen
```

### 开发模式

改 QwenTrace 本身代码时用（带 Vite 热更新）：

```bash
npm run dev
```

后端 server 和 Vite dev server 同时启动，面板地址 `http://localhost:5173`。

## 抓取内容

- **请求**：URL、方法、完整 JSON body（model、messages、tools、参数）
- **响应**：状态码、SSE 流 chunk 实时捕获
- **组装结果**：完整文本、tool calls（增量拼接 arguments）、thinking 文本
- **耗时**：TTFB、总时长、每个 chunk 的间隔时间
- **Token 用量**：prompt tokens、completion tokens、total tokens、cached tokens
- **Agent 角色**：识别每个请求来自哪个 Qwen Code agent（见下文）

> 故意**不**抓 headers — Qwen Code 的 pipeline 从来不读 response headers，
> request headers 里只有 SDK 元信息和一个 bearer token（导出时是安全隐患），
> 去掉它们能让 UI 更聚焦在 AI 对话本身。

## Agent 角色识别

Qwen Code 里你发一句话，背后通常会触发好几个请求 — 主对话 agent、
memory 筛选 subagent、1~2 轮 memory extraction subagent、还有 session
title / recap / compression 等基础设施服务。如果不区分，sidebar 里每行
看起来都一样。

QwenTrace 通过匹配 system prompt 与 qwen-code 源码里的固定常量，自动识
别每条 trace 的发起方。当前支持的角色：

- **Main agent** — 真正回应你输入的主对话 agent
- **Memory selector / extractor / dream** — 三个 managed memory 子代理
- **Session recap / title** — 会话相关的短任务服务
- **Context compressor** — 上下文超限时触发的压缩任务
- **内置 subagent** — `general-purpose`、`Explore`、`statusline-setup`、agent architect

每个角色在侧边栏对应一个色块徽章，详情页顶部还有一张身份卡。识别不到
的会显示为 `Unknown`（一般是自定义 subagent 或 MCP server）。

## 面板

暗色主题（Catppuccin Mocha）单页应用：

- **侧边栏**：请求列表，显示角色徽章、模型名、状态码、耗时、token 数、流式状态
- **详情面板** 5 个 Tab：
  - **Overview** — Agent 角色身份卡、URL、模型、状态、耗时、token 用量
  - **Request** — 格式化 JSON body、message/tool 数量标签
  - **Pretty** — 人类视角渲染：组装后的文本、thinking、tool calls
  - **Raw** — 完全未处理的响应原文（原始 SSE 流或完整 JSON）
  - **Timing** — TTFB vs 流式传输比例条、token 生成速率

## 目录结构

```
src/
├── hook/
│   └── register.mjs      # fetch 拦截器（通过 --import 加载）
├── server/
│   └── index.ts           # Express + WebSocket server、CLI 入口、TraceStore
├── web/
│   ├── main.tsx           # React 入口
│   ├── App.tsx            # 布局 + 顶栏
│   ├── App.css            # 全局样式（Catppuccin Mocha）
│   ├── hooks/
│   │   └── useTraces.ts   # WebSocket hook，自动重连
│   ├── utils/
│   │   └── agentRole.ts   # Qwen Code agent 角色识别（system prompt → role）
│   └── components/
│       ├── Sidebar.tsx    # 请求列表（带角色徽章）
│       └── DetailPanel.tsx # 5 Tab 详情视图
└── types.ts               # 共享类型（TraceEntry、TraceEvent 等）
```

数据流经 6 种事件：`request` → `response-start` → `sse-chunk`（×N） → `complete`。Server 将 SSE chunks 组装为完整的 `AssembledResponse`（文本、tool calls、usage），通过 WebSocket 实时广播到面板。

## 拦截的接口

Hook 匹配以下 URL 模式：

- `/chat/completions`
- `/v1/completions`
- `/v1/embeddings`
- `/v1/models`

自动跳过自身的上报请求（`127.0.0.1:${QWENTRACE_PORT}`）。

## 技术栈

- **Hook**：ESM 模块，零依赖，纯 `globalThis.fetch` patch
- **Server**：Express + ws（WebSocket），内存 TraceStore
- **前端**：React 18 + Vite + TypeScript
- **样式**：Catppuccin Mocha 暗色主题，手写 CSS

## License

MIT
