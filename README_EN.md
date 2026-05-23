# QwenTrace

Network request visualizer for Qwen Code Agent — like Charles Proxy, but for AI.

QwenTrace captures model requests between Qwen Code and AI models (DashScope and OpenAI-compatible endpoints), then displays request bodies, SSE streams, token usage, timing, and agent roles in a real-time web dashboard.

![License](https://img.shields.io/badge/license-MIT-blue)

[中文](./README.md)

## How It Works

QwenTrace uses a **fetch hook** approach: it patches `globalThis.fetch` via Node.js `--import` before application code runs. This lets it transparently intercept model requests without MITM proxies or certificates.

```
Qwen Code ──fetch()──► Hook (register.mjs) ──► Real fetch()
                           │
                           ▼
                    QwenTrace Server ──WebSocket──► Dashboard
```

The hook uses `ReadableStream.tee()` to split SSE streams. The original caller receives a normal Response, while QwenTrace captures every `data:` chunk in the background.

## Quick Start

```bash
# Install dependencies
npm install

# Build the dashboard
npx vite build

# Run QwenTrace with Qwen Code
npx tsx src/server/index.ts -- qwen
```

Open `http://localhost:7890` to see the dashboard.

## Usage

### Wrap Mode (Recommended)

Launch QwenTrace and automatically inject the hook into Qwen Code:

```bash
npx tsx src/server/index.ts -- qwen
```

You can also pass extra flags:

```bash
npx tsx src/server/index.ts --port 8080 -- qwen --some-flag
```

### Manual Injection

Start the server and run Qwen Code with the hook in a separate terminal:

```bash
# Terminal 1: start server
npx tsx src/server/index.ts --no-open

# Terminal 2: run Qwen Code with hook
NODE_OPTIONS="--import /path/to/QwenTrace/src/hook/register.mjs" QWENTRACE_PORT=7890 qwen
```

### Development Mode

For working on QwenTrace itself with Vite HMR:

```bash
npm run dev
```

This starts the backend server and Vite dev server together. The dashboard is available at `http://localhost:5173`.

## What It Captures

- **Request**: URL, method, full JSON body (model, messages, tools, parameters)
- **Response**: status code and real-time SSE chunks
- **Assembled output**: full text, thinking text, tool calls with incremental argument assembly
- **Timing**: TTFB, total duration, and per-chunk delta timing
- **Token usage**: prompt tokens, completion tokens, total tokens, cached tokens
- **Agent role**: best-effort detection of which Qwen Code agent emitted the call

> QwenTrace deliberately does not capture headers. Request headers usually contain SDK metadata plus a bearer token, which is risky in shared exports; for analyzing AI behavior, the body is usually the useful part.

## Agent Role Detection

A single user turn in Qwen Code often fans out into several backend calls: the main interactive agent, memory selector, memory extraction subagents, and session services such as title, recap, and compression. Without role detection, every row in the sidebar looks the same.

QwenTrace identifies the originating agent for every trace by matching the system prompt against known constants in qwen-code source. Currently recognized roles:

- **Main agent**: the interactive CLI agent that responds to your input
- **Memory selector / extractor / dream**: managed-memory subagents
- **Session recap / title**: short-lived session utilities
- **Context compressor**: runs when chat history overflows
- **Built-in subagents**: `general-purpose`, `Explore`, `statusline-setup`, agent architect
- **Webfetch extract**: lightweight content extraction from fetched web pages

Each role gets a colored role label in the sidebar and an identity card in the detail panel. Anything that does not match a known signature is shown as `Unknown` (usually a custom subagent, MCP server, or newly added upstream role).

## Dashboard

The dashboard is a themeable single-page app (system / light / dark) with:

- **Sidebar**: a scrollable request list with a two-line layout. The first line shows status dot + sequence number + role chip + duration; the second line shows model name + status code + token count. Streaming requests have a pulsing status dot, and the first trace is auto-selected.
- **Detail panel** with 5 tabs:
  - **Overview**: agent role identity card, URL, model, status, timing, token usage
  - **Request**: formatted JSON body with message/tool count badges
  - **Pretty**: human-readable rendering of assembled text, thinking, and tool calls
  - **Raw**: raw response views for Stream, Chunks, and JSONL
  - **Timing**: proportional TTFB vs streaming bar and token generation rate

## Architecture

```
src/
├── hook/
│   └── register.mjs       # fetch interceptor loaded via --import
├── server/
│   └── index.ts           # Express + WebSocket server, CLI entry, TraceStore
├── web/
│   ├── main.tsx           # React entry
│   ├── App.tsx            # Layout + header
│   ├── App.css            # Global styles and CSS custom property theme system
│   ├── hooks/
│   │   └── useTraces.ts   # WebSocket hook with auto-reconnect
│   ├── utils/
│   │   └── agentRole.ts   # Qwen Code agent role detection
│   └── components/
│       ├── Sidebar.tsx    # Request list with role chips
│       └── DetailPanel.tsx # 5-tab detail view
└── types.ts               # Shared types (TraceEntry, TraceEvent, etc.)
```

For streaming requests, the main path is `request` → `response-start` → `sse-chunk` (×N) → `complete`. Non-streaming responses use `response-body`, and failures use `error`. The server assembles SSE chunks into a coherent `AssembledResponse` with text, thinking, tool calls, and usage stats, then broadcasts updates through WebSocket.

## Traced Endpoints

The hook intercepts requests matching these URL patterns:

- `/chat/completions`
- `/v1/completions`
- `/v1/embeddings`
- `/v1/models`

It skips its own reporting calls to `127.0.0.1:${QWENTRACE_PORT}` and `localhost:${QWENTRACE_PORT}`.

## Tech Stack

- **Hook**: ESM module, zero dependencies, pure `globalThis.fetch` patching
- **Server**: Express + ws (WebSocket), in-memory TraceStore
- **Frontend**: React 18 + Vite + TypeScript
- **Styling**: CSS custom properties theme system (dark/light), hand-written CSS

## License

MIT
