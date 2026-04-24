## QwenTrace — Qwen Code Agent 网络请求可视化方案

### 一、Qwen Code Agent ↔ AI 通信架构全景

Qwen Code 的 Agent 和 AI 之间的通信遵循一个清晰的分层管道架构，从用户输入到 HTTP 请求共经历 **8 层**：

```
┌──────────────────────────────────────────────────────────────────┐
│  Layer 1: GeminiClient (client.ts)       — 编排层              │
│  系统提示词、IDE 上下文、Memory、Hook、循环检测、压缩            │
├──────────────────────────────────────────────────────────────────┤
│  Layer 2: Turn (turn.ts)                 — 流事件处理层         │
│  将 API 原始 stream 转换为类型化事件 (Content/ToolCall/Thought)  │
├──────────────────────────────────────────────────────────────────┤
│  Layer 3: GeminiChat (geminiChat.ts)     — 会话管理层           │
│  重试逻辑、速率限制、MAX_TOKENS 升级、输出恢复                   │
├──────────────────────────────────────────────────────────────────┤
│  Layer 4: ContentGenerator (interface)   — 抽象接口层           │
│  定义 generateContent / generateContentStream / countTokens      │
├──────────────────────────────────────────────────────────────────┤
│  Layer 5: LoggingContentGenerator        — 日志装饰器层         │
│  记录 ApiRequest / ApiResponse / ApiError telemetry 事件         │
├──────────────────────────────────────────────────────────────────┤
│  Layer 6: QwenContentGenerator           — 凭证管理层           │
│  OAuth token 自动刷新、动态 endpoint、401/403 重试               │
├──────────────────────────────────────────────────────────────────┤
│  Layer 7: ContentGenerationPipeline      — HTTP 请求管道层      │
│  Gemini→OpenAI 格式转换、请求构建、SSE 流处理、chunk 合并        │
├──────────────────────────────────────────────────────────────────┤
│  Layer 8: Provider (DashScope/Default)   — 提供商适配层         │
│  构建 OpenAI SDK client、自定义 headers、cache control           │
└──────────────────────────────────────────────────────────────────┘
                            │
                            ▼
              HTTP POST (SSE Streaming)
        https://dashscope.aliyuncs.com/v1/chat/completions
```

### 二、请求数据流详解

#### 2.1 请求方向 (Outbound)

```
用户消息 (text/parts)
  → GeminiClient.sendMessageStream()
    ├── 拼接系统提示词 (system instruction + user memory)
    ├── 注入 IDE 上下文 (active file, cursor, selection)
    ├── 注入自动记忆 (relevant auto memory)
    ├── 注入 subagent/plan mode 提示
    └── 传入 Turn.run(model, request, signal)

  → Turn.run()
    └── GeminiChat.sendMessageStream(model, params, prompt_id)
          └── makeApiCallAndProcessStream()

  → LoggingContentGenerator.generateContentStream(req, promptId)
    ├── 记录 ApiRequestEvent (model, prompt_id, request_text)
    └── 委托给 wrapped generator

  → QwenContentGenerator.generateContentStream(req, promptId)
    ├── executeWithCredentialManagement()
    │   ├── SharedTokenManager.getValidCredentials()
    │   │   └── OAuth token 获取/刷新
    │   ├── pipeline.client.apiKey = token
    │   └── pipeline.client.baseURL = endpoint
    └── 委托给 super (OpenAIContentGenerator)

  → ContentGenerationPipeline.executeStream(req, promptId)
    ├── createRequestContext() — 确定 model, modalities
    ├── buildRequest()
    │   ├── OpenAIContentConverter.convertGeminiRequestToOpenAI()
    │   │   └── Gemini Content[] → OpenAI ChatCompletionMessageParam[]
    │   ├── buildGenerateContentConfig() — temperature, max_tokens, top_p 等
    │   ├── convertGeminiToolsToOpenAI() — 工具声明转换
    │   ├── provider.buildRequest() — DashScope 特定增强
    │   │   ├── addDashScopeCacheControl() — 缓存控制
    │   │   ├── applyOutputTokenLimit() — token 限制
    │   │   ├── buildMetadata(sessionId, promptId, channel)
    │   │   └── extra_body 注入
    │   └── stream: true, stream_options: { include_usage: true }
    └── this.client.chat.completions.create(openaiRequest, { signal })
        └── HTTP POST → DashScope API (SSE)
```

#### 2.2 实际 HTTP 请求长什么样

```http
POST https://dashscope.aliyuncs.com/v1/chat/completions HTTP/1.1
Content-Type: application/json
Authorization: Bearer <oauth_access_token>
User-Agent: QwenCode/0.15.1 (darwin; arm64)
X-DashScope-CacheControl: enable
X-DashScope-UserAgent: QwenCode/0.15.1 (darwin; arm64)
X-DashScope-AuthType: qwen-oauth

{
  "model": "qwen3-coder",
  "stream": true,
  "stream_options": { "include_usage": true },
  "messages": [
    {
      "role": "system",
      "content": [{ "type": "text", "text": "You are Qwen Code...", "cache_control": { "type": "ephemeral" } }]
    },
    { "role": "user", "content": "帮我写一个 hello world" },
    { "role": "assistant", "content": "...", "tool_calls": [...] },
    { "role": "tool", "tool_call_id": "xxx", "content": "..." },
    ...
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "Read",
        "description": "Read a file...",
        "parameters": { ... }
      }
    },
    // ... 更多工具
    { ..., "cache_control": { "type": "ephemeral" } }  // 最后一个工具带缓存控制
  ],
  "max_tokens": 8192,
  "temperature": 1.0,
  "metadata": {
    "sessionId": "session-abc-123",
    "promptId": "prompt-xyz-456",
    "channel": "cli"
  }
}
```

#### 2.3 响应方向 (Inbound - SSE Streaming)

```
HTTP SSE Stream (每个 chunk 是一个 OpenAI ChatCompletionChunk)
  │
  ▼
ContentGenerationPipeline.processStreamWithLogging()
  ├── 逐 chunk 处理:
  │   ├── 检测 finish_reason="error_finish" → StreamContentError
  │   ├── OpenAIContentConverter.convertOpenAIChunkToGemini(chunk)
  │   ├── 过滤空 response
  │   ├── chunk 合并 (finishReason + usageMetadata 可能分开到达)
  │   └── yield GenerateContentResponse
  │
  ▼
LoggingContentGenerator.loggingStreamWrapper()
  ├── 收集所有 responses (用于日志)
  ├── 记录 responseId, modelVersion, usageMetadata
  ├── yield response → 上层
  └── 结束时: logApiResponse() / logApiError()
  │
  ▼
GeminiChat.sendMessageStream()
  ├── yield StreamEvent { type: CHUNK, value: response }
  ├── 检查 finishReason:
  │   ├── MAX_TOKENS → 升级到 64K 重试
  │   ├── 无效流 → 重试 (独立预算)
  │   └── 速率限制 → 等待 60s 重试
  └── 更新 history
  │
  ▼
Turn.run()
  ├── 解析思考链 → yield Thought event
  ├── 解析文本 → yield Content event
  ├── 解析函数调用 → yield ToolCallRequest event
  ├── 解析引用 → yield Citation event
  └── finishReason → yield Finished event (含 usageMetadata)
  │
  ▼
GeminiClient.sendMessageStream()
  ├── 循环检测 (LoopDetectionService)
  ├── Arena 状态更新
  ├── NextSpeaker 检查 (是否需要 model 继续)
  ├── Stop Hook 执行
  └── yield → UI/CLI 渲染
```

#### 2.4 SSE 原始响应示例

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1714000000,"model":"qwen3-coder","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}],"usage":null}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1714000000,"model":"qwen3-coder","choices":[{"index":0,"delta":{"content":"我来"},"finish_reason":null}],"usage":null}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1714000000,"model":"qwen3-coder","choices":[{"index":0,"delta":{"content":"帮你写"},"finish_reason":null}],"usage":null}

... (更多 chunks)

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1714000000,"model":"qwen3-coder","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":null}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1714000000,"model":"qwen3-coder","choices":[],"usage":{"prompt_tokens":1234,"completion_tokens":567,"total_tokens":1801}}

data: [DONE]
```

### 三、QwenTrace 需要捕获的关键数据

#### 3.1 每个请求需记录

| 分类 | 字段 | 来源 |
|------|------|------|
| **基本信息** | URL, Method, 请求时间 | HTTP 层 |
| **请求头** | Authorization, User-Agent, X-DashScope-* | Provider.buildHeaders() |
| **请求体** | model, messages, tools, stream, max_tokens, temperature | Pipeline.buildRequest() |
| **元数据** | sessionId, promptId, channel | DashScope.buildMetadata() |
| **响应状态** | HTTP status, response_id | HTTP 响应头 + 首个 chunk |
| **流式数据** | 每个 SSE chunk 的内容和时间戳 | SSE stream |
| **最终内容** | 完整文本、函数调用、思考链 | 汇聚后的 response |
| **Token 用量** | prompt_tokens, completion_tokens, cached, thoughts, total | usageMetadata |
| **计时** | 请求发出时间, TTFB, 每个 chunk 时间, 总耗时 | 各层时间戳 |
| **重试信息** | 重试原因, 重试次数, 延迟时间 | GeminiChat retry logic |
| **错误信息** | 错误类型, HTTP 状态码, 错误消息 | ErrorHandler |
| **凭证事件** | token 刷新, endpoint 切换 | QwenContentGenerator |

#### 3.2 一次完整对话中的请求序列

```
[用户输入 "帮我读取 foo.ts 文件"]

  Request #1: POST /v1/chat/completions  (主请求)
    → 响应: assistant 调用 Read 工具 (function_call)

  Request #2: POST /v1/chat/completions  (tool result 回传)
    → 响应: assistant 输出文件内容分析

  [可选] Request #3: POST /v1/chat/completions  (nextSpeaker 检查)
    → 判断是否需要 model 继续

  [可选] Request #4: POST /v1/chat/completions  (压缩请求)
    → 当 context 超过阈值时触发

  [可选] Request #5: POST /v1/chat/completions  (auto-title)
    → 为会话生成标题
```

### 四、QwenTrace 实现方案

#### 方案 A: HTTP 代理方式（最接近 Charles）⭐ 推荐

**核心思路**: 在 Qwen Code 和 DashScope API 之间插入一个本地 HTTP 代理，拦截、记录并转发所有请求。

```
Qwen Code Agent
      │
      │  HTTP/HTTPS
      ▼
┌─────────────────────┐
│     QwenTrace        │
│   (Local Proxy)      │
│                      │
│  ┌────────────────┐  │
│  │ Request Logger │  │     ┌──────────────────┐
│  │ SSE Assembler  │──────→│  Web Dashboard   │
│  │ Stats Tracker  │  │     │  (React UI)      │
│  └────────────────┘  │     │  模仿 Charles UI  │
│                      │     └──────────────────┘
└──────────┬───────────┘
           │
           │  HTTP/HTTPS (forwarded)
           ▼
    DashScope API
```

**实现步骤**:

1. **启动代理服务器** (Node.js `http-proxy` 或 `http-mitm-proxy`)
   - 监听本地端口 (如 `http://localhost:9090`)
   - 对 HTTPS 请求做 MITM (自签证书)

2. **配置 Qwen Code 走代理**
   - Qwen Code 的 OpenAI SDK client 支持 proxy 配置
   - 在 `settings.json` 中设置 `"proxy": "http://localhost:9090"`
   - 或通过环境变量 `HTTPS_PROXY=http://localhost:9090`

3. **请求拦截与记录**
   - 拦截 request: 记录 URL, headers, body (完整 JSON)
   - 拦截 SSE response: 逐 chunk 记录 (带时间戳)
   - 计算 TTFB (第一个 chunk 的时间差)

4. **Web Dashboard 实时展示**
   - 通过 WebSocket 推送实时数据到前端
   - 左侧: 请求列表 (模仿 Charles 的 Structure/Sequence 视图)
   - 右侧: 请求/响应详情
   - 流式文本实时滚动显示

**优势**: 零侵入，不修改 Qwen Code 一行代码；捕获真实 HTTP 流量。

**挑战**: HTTPS 需要 MITM 证书管理；SSE 流式数据的实时解析。

#### 方案 B: Node.js HTTP Hook 方式

**核心思路**: 通过 monkey-patch Node.js 的 `http`/`https`/`fetch` 模块来拦截请求。

```javascript
// 在 Qwen Code 启动前注入:
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const requestId = generateId();
  recorder.recordRequest(requestId, url, options);
  const response = await originalFetch(url, options);
  // 对 SSE 流进行 tee 处理
  const [stream1, stream2] = response.body.tee();
  recorder.recordResponseStream(requestId, stream1);
  return new Response(stream2, response);
};
```

**实现方式**: 可用 `--require` 预加载脚本注入。

**优势**: 不需要代理和证书；能捕获所有 Node.js HTTP 流量。
**挑战**: 侵入性较强；需要适配不同的 HTTP 客户端库。

#### 方案 C: ContentGenerator 装饰器方式

**核心思路**: 仿照 `LoggingContentGenerator` 的模式，创建一个 `TracingContentGenerator` 装饰器。

```typescript
class TracingContentGenerator implements ContentGenerator {
  constructor(
    private wrapped: ContentGenerator,
    private traceServer: TraceServer, // WebSocket server
  ) {}

  async *generateContentStream(req, promptId) {
    const traceId = this.traceServer.startTrace(req, promptId);
    const stream = await this.wrapped.generateContentStream(req, promptId);
    for await (const chunk of stream) {
      this.traceServer.recordChunk(traceId, chunk);
      yield chunk;
    }
    this.traceServer.endTrace(traceId);
  }
}
```

**优势**: 访问到结构化的 Gemini 格式数据 (不需要自己解析)；最干净的集成方式。
**挑战**: 需要修改 Qwen Code 代码或提供插件机制。

### 五、推荐方案: 方案 A — 本地代理 + Web Dashboard

#### 5.1 技术栈

```
后端 (Proxy + API):
  - Node.js + TypeScript
  - http-proxy / hoxy (HTTP proxy)
  - express (API server for dashboard)
  - ws (WebSocket for实时推送)
  - better-sqlite3 (本地存储请求历史)

前端 (Dashboard):
  - React + TypeScript
  - Tailwind CSS
  - 模仿 Charles 的 UI 布局
  - Recharts (用量/延迟图表)
  - Monaco Editor (JSON 展示)
```

#### 5.2 核心模块设计

```
QwenTrace/
├── src/
│   ├── proxy/
│   │   ├── ProxyServer.ts         # HTTP/HTTPS 代理核心
│   │   ├── SSEInterceptor.ts      # SSE 流拦截与解析
│   │   ├── CertManager.ts         # HTTPS 证书管理
│   │   └── RequestMatcher.ts      # 请求过滤 (只关注 AI API)
│   ├── recorder/
│   │   ├── TraceRecorder.ts       # 请求/响应记录器
│   │   ├── TraceStore.ts          # SQLite 持久化存储
│   │   └── types.ts               # TraceEntry 类型定义
│   ├── analyzer/
│   │   ├── TokenAnalyzer.ts       # Token 用量分析
│   │   ├── LatencyAnalyzer.ts     # 延迟分析 (TTFB, 每 chunk)
│   │   ├── ConversationTracker.ts # 对话流追踪
│   │   └── CostEstimator.ts       # 成本估算
│   ├── server/
│   │   ├── ApiServer.ts           # REST API (历史查询)
│   │   └── WebSocketServer.ts     # 实时推送
│   └── web/                       # React Dashboard
│       ├── components/
│       │   ├── RequestList.tsx     # 左侧请求列表 (Charles Structure)
│       │   ├── RequestDetail.tsx   # 右侧详情面板
│       │   ├── SSEViewer.tsx       # SSE 流实时查看器
│       │   ├── MessageViewer.tsx   # messages[] 可视化
│       │   ├── ToolCallViewer.tsx  # 工具调用可视化
│       │   ├── TokenChart.tsx      # Token 用量图表
│       │   ├── LatencyChart.tsx    # 延迟时序图
│       │   └── ConversationFlow.tsx# 对话流程图
│       └── App.tsx
├── package.json
└── tsconfig.json
```

#### 5.3 TraceEntry 核心数据结构

```typescript
interface TraceEntry {
  // 唯一标识
  id: string;
  timestamp: number;

  // 请求信息
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: {
      model: string;
      messages: OpenAIMessage[];
      tools?: OpenAITool[];
      stream: boolean;
      max_tokens?: number;
      temperature?: number;
      metadata?: {
        sessionId?: string;
        promptId?: string;
        channel?: string;
      };
      [key: string]: unknown;  // extra_body 等
    };
  };

  // 响应信息
  response: {
    status: number;
    headers: Record<string, string>;
    // SSE chunks (逐条记录)
    chunks: Array<{
      timestamp: number;       // 到达时间
      deltaMs: number;         // 距上一个 chunk 的毫秒数
      raw: string;             // 原始 SSE data 行
      parsed: {
        id: string;
        delta?: {
          content?: string;
          tool_calls?: ToolCallDelta[];
          role?: string;
        };
        finish_reason?: string;
        usage?: TokenUsage;
      };
    }>;
    // 汇聚后的完整响应
    assembled: {
      fullText: string;
      toolCalls: ToolCall[];
      thinkingText?: string;
      finishReason: string;
      usage: TokenUsage;
    };
  };

  // 计时
  timing: {
    requestStart: number;      // 请求发出时间
    ttfb: number;             // Time To First Byte (ms)
    ttfc: number;             // Time To First Content chunk (ms)
    totalDuration: number;     // 总耗时 (ms)
    chunkCount: number;        // chunk 数量
    avgChunkInterval: number;  // 平均 chunk 间隔 (ms)
  };

  // 分析
  analysis: {
    conversationId: string;    // 关联的会话
    turnIndex: number;         // 第几轮对话
    requestType: 'chat' | 'tool_response' | 'compression' | 'next_speaker' | 'auto_title';
    isRetry: boolean;
    retryReason?: string;
    tokenUsage: TokenUsage;
    estimatedCost?: number;
  };
}

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  thoughtTokens: number;
  toolTokens: number;
  totalTokens: number;
}
```

#### 5.4 Dashboard UI 设计 (模仿 Charles)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  QwenTrace                                        ● Recording  ⏸ ⏹ 🗑  │
├──────────┬──────────────────────────────────────────────────────────────┤
│ Filter   │                                                             │
│ ┌──────┐ │  Overview │ Request │ Response │ SSE Stream │ Timing │ JSON │
│ │🔍    │ │  ─────────────────────────────────────────────────────────── │
│ └──────┘ │                                                             │
│          │  ┌─ Request ─────────────────────────────────────────────┐  │
│ Requests │  │ POST /v1/chat/completions                             │  │
│ ──────── │  │ Model: qwen3-coder                                    │  │
│          │  │ Status: 200  Duration: 3.2s  TTFB: 180ms             │  │
│ #1 chat  │  │ Tokens: 1234→567 (cached: 890)                       │  │
│ 200 3.2s │  └───────────────────────────────────────────────────────┘  │
│ 1.8K tok │                                                             │
│          │  ┌─ Messages (12) ───────────────────────────────────────┐  │
│ #2 tool  │  │                                                       │  │
│ 200 2.1s │  │ ┌ system ──────────────────────────────────────────┐  │  │
│ 2.3K tok │  │ │ You are Qwen Code, a CLI-based AI coding...     │  │  │
│          │  │ └──────────────────────────────────────────────────┘  │  │
│ #3 chat  │  │                                                       │  │
│ 200 5.7s │  │ ┌ user ────────────────────────────────────────────┐  │  │
│ 3.1K tok │  │ │ 帮我读取 foo.ts 文件                              │  │  │
│          │  │ └──────────────────────────────────────────────────┘  │  │
│ #4 title │  │                                                       │  │
│ 200 0.8s │  │ ┌ assistant ───────────────────────────────────────┐  │  │
│ 0.5K tok │  │ │ [tool_call] Read({ file_path: "/path/foo.ts" }) │  │  │
│          │  │ └──────────────────────────────────────────────────┘  │  │
│ ──────── │  │                                                       │  │
│ Summary  │  │ ┌ tool ────────────────────────────────────────────┐  │  │
│ Total: 4 │  │ │ tool_call_id: "call_abc123"                      │  │  │
│ 7.7K tok │  │ │ content: "1→ import React from 'react'..."       │  │  │
│ 11.8s    │  │ └──────────────────────────────────────────────────┘  │  │
│          │  └───────────────────────────────────────────────────────┘  │
│          │                                                             │
│          │  ┌─ Tools (23) ──────────────────────────────────────────┐  │
│          │  │ Read, Write, Edit, Bash, Grep, Glob, ...              │  │
│          │  └───────────────────────────────────────────────────────┘  │
│          │                                                             │
│          │  ┌─ SSE Stream (42 chunks) ──────────────────────────────┐  │
│          │  │ [0ms]    role: assistant                               │  │
│          │  │ [180ms]  "我来"                                        │  │
│          │  │ [210ms]  "帮你"                                        │  │
│          │  │ [235ms]  "读取"                                        │  │
│          │  │ [260ms]  "这个"                                        │  │
│          │  │ ...                                                    │  │
│          │  │ [3150ms] finish_reason: stop                          │  │
│          │  │ [3200ms] usage: { prompt: 1234, completion: 567 }     │  │
│          │  └───────────────────────────────────────────────────────┘  │
│          │                                                             │
│          │  ┌─ Timing ──────────────────────────────────────────────┐  │
│          │  │  ▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░▓▓▓▓▓▓▓▓▓▓▓▓  │  │
│          │  │  ├─ TTFB: 180ms ─┤├──── Streaming: 3020ms ────────┤  │  │
│          │  │                                                       │  │
│          │  │  Chunk Rate: ██████████████░░░  13.9 chunks/sec       │  │
│          │  │  Token Rate: ████████████████░  177 tokens/sec        │  │
│          │  └───────────────────────────────────────────────────────┘  │
└──────────┴──────────────────────────────────────────────────────────────┘
```

#### 5.5 SSE 流拦截核心逻辑

```typescript
// SSEInterceptor.ts — 核心: 不消费流，只旁路记录
class SSEInterceptor {
  intercept(
    proxyRes: IncomingMessage,
    traceEntry: TraceEntry,
    onChunk: (chunk: SSEChunk) => void,
  ): Transform {
    const transform = new Transform({
      transform(chunk, encoding, callback) {
        const data = chunk.toString();
        const lines = data.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') {
              onChunk({ type: 'done', timestamp: Date.now() });
            } else {
              try {
                const parsed = JSON.parse(payload);
                onChunk({
                  type: 'data',
                  timestamp: Date.now(),
                  raw: payload,
                  parsed,
                });
              } catch {
                // 不完整的 chunk，缓冲处理
              }
            }
          }
        }

        // 原样转发 — 不修改数据
        callback(null, chunk);
      },
    });

    return transform;
  }
}
```

#### 5.6 启动方式

```bash
# 启动 QwenTrace
npx qwentrace --port 9090 --dashboard 8080

# 配置 Qwen Code 走代理 (方式一: 环境变量)
HTTPS_PROXY=http://localhost:9090 qwen

# 配置 Qwen Code 走代理 (方式二: settings.json)
# ~/.qwen/settings.json
{
  "proxy": "http://localhost:9090"
}

# 打开 Dashboard
open http://localhost:8080
```

### 六、特色功能设计

#### 6.1 对话流可视化 (Conversation Flow)

```
┌──────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ User │───▶│ Request 1 │───▶│ AI Reply │───▶│ToolCall  │
│ Input│    │ chat/comp │    │ + tool   │    │ Read()   │
└──────┘    └──────────┘    └──────────┘    └────┬─────┘
                                                 │
            ┌──────────┐    ┌──────────┐         │
            │ Request 2 │◀──│ToolResult│◀────────┘
            │ chat/comp │    │ 文件内容  │
            └─────┬────┘    └──────────┘
                  │
            ┌─────▼────┐
            │ AI Reply │
            │ 最终回答  │
            └──────────┘
```

#### 6.2 Token 用量仪表板

- 按对话统计: 每轮对话消耗多少 token
- prompt vs completion 比例
- 缓存命中率 (cached_tokens / prompt_tokens)
- 思考链 token 占比
- 历史趋势图

#### 6.3 延迟分析

- TTFB 直方图
- Token 生成速率 (tokens/sec)
- 每个 chunk 的到达时间瀑布图
- 重试事件时间线

#### 6.4 请求对比 (Diff View)

- 选择两个请求，对比 messages 差异
- 突出新增的 user message 和 tool result
- 显示 context window 增长趋势

### 七、开发路线图

**Phase 1 — MVP (1-2 周)**
- 本地 HTTP 代理 (支持 HTTP，暂不处理 HTTPS MITM)
- 请求/响应记录 (内存存储)
- 简单的 Web UI (请求列表 + JSON 查看)
- SSE chunk 实时展示

**Phase 2 — Charles 体验 (2-3 周)**
- HTTPS MITM 支持 (自签证书)
- SQLite 持久化
- 完整的 Charles 风格 UI
- Messages 可视化 (角色着色、折叠)
- Token 用量图表

**Phase 3 — AI 特色功能 (2-3 周)**
- 对话流程图
- 请求对比 (Diff)
- 延迟瀑布图
- 成本估算
- 导出/分享功能
