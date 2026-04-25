# QwenTrace

Network request visualizer for Qwen Code Agent — like Charles Proxy, but for AI.

QwenTrace captures all HTTP traffic between Qwen Code and AI models (DashScope, OpenAI-compatible endpoints) and displays them in a real-time web dashboard.

![License](https://img.shields.io/badge/license-MIT-blue)

[中文文档](./README_CN.md)

## How It Works

QwenTrace uses a **fetch hook** approach — it patches `globalThis.fetch` via Node.js `--import` before any application code runs. This lets it transparently intercept all outgoing requests without MITM proxies or certificates.

```
Qwen Code ──fetch()──► Hook (register.mjs) ──► Real fetch()
                           │
                           ▼
                    QwenTrace Server ──WebSocket──► Dashboard
```

The hook uses `ReadableStream.tee()` to split SSE streams, so the original caller sees a completely normal response while QwenTrace captures every chunk in the background.

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

### Wrap mode (recommended)

Launches Qwen Code with the hook automatically injected:

```bash
npx tsx src/server/index.ts -- qwen
```

You can also pass flags:

```bash
npx tsx src/server/index.ts --port 8080 -- qwen --some-flag
```

### Manual injection

Start the server and inject the hook yourself in a separate terminal:

```bash
# Terminal 1: start server
npx tsx src/server/index.ts --no-open

# Terminal 2: run Qwen Code with hook
NODE_OPTIONS="--import /path/to/QwenTrace/src/hook/register.mjs" QWENTRACE_PORT=7890 qwen
```

### Development mode

For working on QwenTrace itself (with Vite HMR):

```bash
npm run dev
```

This starts the backend server and Vite dev server concurrently. Dashboard is at `http://localhost:5173`.

## What It Captures

- **Request**: URL, method, full JSON body (model, messages, tools, parameters)
- **Response**: status, SSE stream chunks in real-time
- **Assembled output**: full text, tool calls (with incremental argument assembly), thinking text
- **Timing**: TTFB, total duration, per-chunk delta timing
- **Token usage**: prompt tokens, completion tokens, total tokens, cached tokens
- **Agent role**: which Qwen Code agent emitted the call (see below)

> Headers are deliberately **not** captured — Qwen Code's pipeline never reads
> response headers, request headers contain only SDK metadata plus a bearer
> token (a security risk in shared exports), and stripping them keeps the UI
> focused on the AI conversation itself.

## Agent Role Detection

A single `chat/completions` user turn in Qwen Code typically fans out into
several backend calls — the main interactive agent, an automated memory
selector, one or two memory-extraction subagents, plus session services
(title, recap, compression). Without context every row in the sidebar
looks the same.

QwenTrace identifies the originating agent for every trace by matching the
system prompt against the known constants in qwen-code source. Currently
recognized roles:

- **Main agent** — the interactive CLI agent that responds to your input
- **Memory selector / extractor / dream** — the three managed-memory subagents
- **Session recap / title** — short-lived utilities for the session UI
- **Context compressor** — runs when the chat history overflows
- **Built-in subagents** — `general-purpose`, `Explore`, `statusline-setup`, agent architect

Each role gets a colored chip in the sidebar and a prominent identity card at
the top of the detail panel. Anything that doesn't match a known signature
is shown as `Unknown` (likely a custom subagent or MCP server).

## Dashboard

The dashboard is a dark-themed (Catppuccin Mocha) single-page app with:

- **Sidebar**: scrollable request list showing role chip, model, status, duration, token count, and streaming state
- **Detail panel** with 5 tabs:
  - **Overview** — agent role identity card, URL, model, status, timing, token usage grid
  - **Request** — formatted JSON body with message/tool count badges
  - **Pretty** — human-rendered view: assembled text, thinking, tool calls
  - **Raw** — completely unprocessed response body (raw SSE stream or full JSON)
  - **Timing** — proportional TTFB vs streaming bar, token generation rate

## Architecture

```
src/
├── hook/
│   └── register.mjs      # fetch interceptor (loaded via --import)
├── server/
│   └── index.ts           # Express + WebSocket server, CLI entry, TraceStore
├── web/
│   ├── main.tsx           # React entry
│   ├── App.tsx            # Layout + header
│   ├── App.css            # Global styles (Catppuccin Mocha)
│   ├── hooks/
│   │   └── useTraces.ts   # WebSocket hook with auto-reconnect
│   ├── utils/
│   │   └── agentRole.ts   # Qwen Code agent role detection (system prompt → role)
│   └── components/
│       ├── Sidebar.tsx    # Request list with role chips
│       └── DetailPanel.tsx # 5-tab detail view
└── types.ts               # Shared types (TraceEntry, TraceEvent, etc.)
```

Data flows through 6 event types: `request` → `response-start` → `sse-chunk` (×N) → `complete`. The server assembles SSE chunks into a coherent `AssembledResponse` with full text, tool calls, and usage stats. WebSocket broadcasts keep the dashboard in sync in real-time.

## Traced Endpoints

The hook intercepts requests matching these URL patterns:

- `/chat/completions`
- `/v1/completions`
- `/v1/embeddings`
- `/v1/models`

It skips its own reporting calls to `127.0.0.1:${QWENTRACE_PORT}`.

## Tech Stack

- **Hook**: ESM module, zero dependencies, pure `globalThis.fetch` patching
- **Server**: Express + ws (WebSocket), in-memory TraceStore
- **Frontend**: React 18 + Vite + TypeScript
- **Styling**: Catppuccin Mocha dark theme, hand-written CSS

## License

MIT
