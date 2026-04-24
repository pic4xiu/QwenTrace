// ============================================================
// QwenTrace — Server + CLI entry point
// Starts HTTP/WS server for dashboard, spawns Qwen Code with hook
// ============================================================

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  TraceEvent,
  TraceEntry,
  ParsedSSEChunk,
  AssembledResponse,
  ParsedRequestBody,
  WSMessage,
} from '../types.js';

// ------------------------------------------------------------------
// Config
// ------------------------------------------------------------------

const DEFAULT_PORT = 7890;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const HOOK_PATH = path.resolve(PROJECT_ROOT, 'src', 'hook', 'register.mjs');

// ------------------------------------------------------------------
// In-memory trace store
// ------------------------------------------------------------------

class TraceStore {
  private traces: Map<string, TraceEntry> = new Map();
  private order: string[] = [];

  getAll(): TraceEntry[] {
    return this.order.map((id) => this.traces.get(id)!).filter(Boolean);
  }

  get(id: string): TraceEntry | undefined {
    return this.traces.get(id);
  }

  clear(): void {
    this.traces.clear();
    this.order = [];
  }

  handleEvent(event: TraceEvent): { trace: TraceEntry; isNew: boolean } {
    switch (event.type) {
      case 'request':
        return this.handleRequest(event);
      case 'response-start':
        return this.handleResponseStart(event);
      case 'sse-chunk':
        return this.handleSSEChunk(event);
      case 'response-body':
        return this.handleResponseBody(event);
      case 'complete':
        return this.handleComplete(event);
      case 'error':
        return this.handleError(event);
      default:
        throw new Error(`Unknown event type: ${(event as TraceEvent).type}`);
    }
  }

  private handleRequest(event: TraceEvent & { type: 'request' }): { trace: TraceEntry; isNew: boolean } {
    let parsedBody: ParsedRequestBody | null = null;
    if (event.body) {
      try {
        parsedBody = JSON.parse(event.body);
      } catch { /* not JSON */ }
    }

    const trace: TraceEntry = {
      id: event.traceId,
      startTime: event.timestamp,
      url: event.url,
      method: event.method,
      requestHeaders: event.headers,
      requestBody: parsedBody,
      rawRequestBody: event.body,
      status: 0,
      statusText: '',
      responseHeaders: {},
      isSSE: false,
      chunks: [],
      assembled: null,
      responseBody: null,
      ttfb: 0,
      duration: 0,
      state: 'pending',
    };

    this.traces.set(event.traceId, trace);
    this.order.push(event.traceId);
    return { trace, isNew: true };
  }

  private handleResponseStart(event: TraceEvent & { type: 'response-start' }): { trace: TraceEntry; isNew: boolean } {
    const trace = this.traces.get(event.traceId);
    if (!trace) return this.handleRequest({
      type: 'request', traceId: event.traceId, timestamp: event.timestamp - event.ttfb,
      url: '(unknown)', method: 'POST', headers: {}, body: null,
    });

    trace.status = event.status;
    trace.statusText = event.statusText;
    trace.responseHeaders = event.headers;
    trace.ttfb = event.ttfb;

    const contentType = event.headers['content-type'] || '';
    trace.isSSE = contentType.includes('text/event-stream') || contentType.includes('text/plain');
    if (trace.isSSE || trace.requestBody?.stream) {
      trace.state = 'streaming';
    }

    return { trace, isNew: false };
  }

  private handleSSEChunk(event: TraceEvent & { type: 'sse-chunk' }): { trace: TraceEntry; isNew: boolean } {
    const trace = this.traces.get(event.traceId);
    if (!trace) return { trace: this.createPlaceholder(event.traceId), isNew: true };

    trace.isSSE = true;
    trace.state = 'streaming';

    const prevChunk = trace.chunks[trace.chunks.length - 1];
    const deltaMs = prevChunk ? event.timestamp - prevChunk.timestamp : 0;

    let parsed: ParsedSSEChunk['parsed'] = null;
    if (event.data !== '[DONE]') {
      try {
        const raw = JSON.parse(event.data);
        parsed = {
          id: raw.id,
          model: raw.model,
          delta: raw.choices?.[0]?.delta,
          finish_reason: raw.choices?.[0]?.finish_reason,
          usage: raw.usage,
        };
      } catch { /* not valid JSON */ }
    }

    const chunk: ParsedSSEChunk = {
      timestamp: event.timestamp,
      elapsed: event.elapsed,
      deltaMs,
      raw: event.data,
      parsed,
    };

    trace.chunks.push(chunk);
    trace.assembled = this.assembleResponse(trace.chunks);
    trace.duration = event.elapsed;

    return { trace, isNew: false };
  }

  private handleResponseBody(event: TraceEvent & { type: 'response-body' }): { trace: TraceEntry; isNew: boolean } {
    const trace = this.traces.get(event.traceId);
    if (!trace) return { trace: this.createPlaceholder(event.traceId), isNew: true };

    trace.responseBody = event.body;
    trace.duration = event.duration;

    // Try to parse as JSON for non-streaming responses
    if (event.body) {
      try {
        const parsed = JSON.parse(event.body);
        const choice = parsed.choices?.[0];
        trace.assembled = {
          fullText: choice?.message?.content || '',
          toolCalls: (choice?.message?.tool_calls || []).map((tc: any) => ({
            id: tc.id,
            name: tc.function?.name || '',
            arguments: tc.function?.arguments || '',
          })),
          thinkingText: '',
          finishReason: choice?.finish_reason || '',
          model: parsed.model || '',
          usage: {
            promptTokens: parsed.usage?.prompt_tokens || 0,
            completionTokens: parsed.usage?.completion_tokens || 0,
            totalTokens: parsed.usage?.total_tokens || 0,
            cachedTokens: parsed.usage?.prompt_tokens_details?.cached_tokens || 0,
          },
        };
      } catch { /* not JSON */ }
    }

    return { trace, isNew: false };
  }

  private handleComplete(event: TraceEvent & { type: 'complete' }): { trace: TraceEntry; isNew: boolean } {
    const trace = this.traces.get(event.traceId);
    if (!trace) return { trace: this.createPlaceholder(event.traceId), isNew: true };

    trace.state = event.error ? 'error' : 'complete';
    trace.duration = event.duration;
    if (event.error) trace.error = event.error;

    return { trace, isNew: false };
  }

  private handleError(event: TraceEvent & { type: 'error' }): { trace: TraceEntry; isNew: boolean } {
    const trace = this.traces.get(event.traceId);
    if (!trace) return { trace: this.createPlaceholder(event.traceId), isNew: true };

    trace.state = 'error';
    trace.error = event.error;
    trace.duration = event.duration;

    return { trace, isNew: false };
  }

  private createPlaceholder(traceId: string): TraceEntry {
    const trace: TraceEntry = {
      id: traceId,
      startTime: Date.now(),
      url: '(unknown)',
      method: 'POST',
      requestHeaders: {},
      requestBody: null,
      rawRequestBody: null,
      status: 0,
      statusText: '',
      responseHeaders: {},
      isSSE: false,
      chunks: [],
      assembled: null,
      responseBody: null,
      ttfb: 0,
      duration: 0,
      state: 'pending',
    };
    this.traces.set(traceId, trace);
    this.order.push(traceId);
    return trace;
  }

  /** Assemble a full response from accumulated SSE chunks. */
  private assembleResponse(chunks: ParsedSSEChunk[]): AssembledResponse {
    let fullText = '';
    let thinkingText = '';
    let finishReason = '';
    let model = '';
    const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0 };

    for (const chunk of chunks) {
      const p = chunk.parsed;
      if (!p) continue;

      if (p.model) model = p.model;
      if (p.finish_reason) finishReason = p.finish_reason;

      if (p.delta?.content) {
        fullText += p.delta.content;
      }

      if (p.delta?.tool_calls) {
        for (const tc of p.delta.tool_calls) {
          const existing = toolCallsMap.get(tc.index);
          if (existing) {
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
          } else {
            toolCallsMap.set(tc.index, {
              id: tc.id || '',
              name: tc.function?.name || '',
              arguments: tc.function?.arguments || '',
            });
          }
        }
      }

      if (p.usage) {
        usage = {
          promptTokens: p.usage.prompt_tokens || 0,
          completionTokens: p.usage.completion_tokens || 0,
          totalTokens: p.usage.total_tokens || 0,
          cachedTokens: p.usage.prompt_tokens_details?.cached_tokens || 0,
        };
      }
    }

    return {
      fullText,
      thinkingText,
      finishReason,
      model,
      toolCalls: [...toolCallsMap.values()],
      usage,
    };
  }
}

// ------------------------------------------------------------------
// Server
// ------------------------------------------------------------------

function startServer(port: number): Promise<void> {
  const store = new TraceStore();
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // --- REST API --- //

  app.post('/api/trace', (req, res) => {
    try {
      const event = req.body as TraceEvent;
      const { trace } = store.handleEvent(event);

      // Broadcast to WS clients
      if (event.type === 'sse-chunk') {
        broadcastChunk(event.traceId, trace);
      } else {
        broadcastUpdate(trace);
      }

      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[QwenTrace] Error processing trace event:', err);
      res.status(400).json({ error: String(err) });
    }
  });

  app.get('/api/traces', (_req, res) => {
    res.json(store.getAll());
  });

  app.delete('/api/traces', (_req, res) => {
    store.clear();
    broadcastList(store);
    res.json({ ok: true });
  });

  // --- Serve built frontend (production) --- //
  const webDist = path.resolve(PROJECT_ROOT, 'dist', 'web');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  // --- HTTP + WebSocket server --- //
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  const wsClients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    wsClients.add(ws);
    // Send current state
    const msg: WSMessage = { type: 'trace-list', traces: store.getAll() };
    ws.send(JSON.stringify(msg));
    ws.on('close', () => wsClients.delete(ws));
  });

  function broadcast(msg: WSMessage) {
    const data = JSON.stringify(msg);
    for (const ws of wsClients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }

  function broadcastUpdate(trace: TraceEntry) {
    broadcast({ type: 'trace-update', trace });
  }

  function broadcastChunk(traceId: string, trace: TraceEntry) {
    const lastChunk = trace.chunks[trace.chunks.length - 1];
    if (!lastChunk) return;
    broadcast({
      type: 'trace-chunk',
      traceId,
      chunk: lastChunk,
      assembled: trace.assembled,
      state: trace.state,
      duration: trace.duration,
    });
  }

  function broadcastList(st: TraceStore) {
    broadcast({ type: 'trace-list', traces: st.getAll() });
  }

  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      console.log(`\x1b[36m[QwenTrace]\x1b[0m Server running at http://localhost:${port}`);
      console.log(`\x1b[36m[QwenTrace]\x1b[0m Dashboard: http://localhost:${port} (production) or http://localhost:5173 (dev)`);
      resolve();
    });
    server.on('error', reject);
  });
}

// ------------------------------------------------------------------
// CLI: spawn Qwen Code with the hook injected
// ------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  let port = DEFAULT_PORT;
  let noOpen = false;

  // Parse --port
  const portIdx = args.indexOf('--port');
  if (portIdx >= 0 && args[portIdx + 1]) {
    port = parseInt(args[portIdx + 1], 10);
    args.splice(portIdx, 2);
  }

  // Parse --no-open
  const noOpenIdx = args.indexOf('--no-open');
  if (noOpenIdx >= 0) {
    noOpen = true;
    args.splice(noOpenIdx, 1);
  }

  // Find the separator "--"
  const sepIdx = args.indexOf('--');
  let childArgs: string[] = [];
  if (sepIdx >= 0) {
    childArgs = args.slice(sepIdx + 1);
    args.splice(sepIdx);
  }

  // Start the server
  await startServer(port);

  // If child command is provided, spawn it with the hook
  if (childArgs.length > 0) {
    const [cmd, ...cmdArgs] = childArgs;
    const existingNodeOpts = process.env.NODE_OPTIONS || '';
    const hookImport = `--import ${HOOK_PATH}`;

    // Avoid duplicate imports
    const nodeOptions = existingNodeOpts.includes(HOOK_PATH)
      ? existingNodeOpts
      : `${hookImport} ${existingNodeOpts}`.trim();

    console.log(`\x1b[36m[QwenTrace]\x1b[0m Spawning: ${cmd} ${cmdArgs.join(' ')}`);
    console.log(`\x1b[36m[QwenTrace]\x1b[0m NODE_OPTIONS: ${nodeOptions}`);

    const child = spawn(cmd, cmdArgs, {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_OPTIONS: nodeOptions,
        QWENTRACE_PORT: String(port),
      },
      shell: process.platform === 'win32',
    });

    child.on('exit', (code) => {
      console.log(`\x1b[36m[QwenTrace]\x1b[0m Child process exited with code ${code}`);
      console.log(`\x1b[36m[QwenTrace]\x1b[0m Server still running at http://localhost:${port} — press Ctrl+C to stop`);
    });

    // Forward SIGINT/SIGTERM to child, but keep server alive
    process.on('SIGINT', () => {
      child.kill('SIGINT');
    });
    process.on('SIGTERM', () => {
      child.kill('SIGTERM');
    });
  } else {
    // No child command — just run the server (hook-only mode)
    console.log(`\x1b[36m[QwenTrace]\x1b[0m`);
    console.log(`\x1b[36m[QwenTrace]\x1b[0m Server-only mode. To trace Qwen Code, run in another terminal:`);
    console.log(`\x1b[36m[QwenTrace]\x1b[0m   NODE_OPTIONS="--import ${HOOK_PATH}" QWENTRACE_PORT=${port} qwen`);
    console.log(`\x1b[36m[QwenTrace]\x1b[0m`);

    // Try to open browser (skip if --no-open or non-TTY)
    if (!noOpen && process.stdout.isTTY) {
      import('open').then(({ default: open }) => {
        open(`http://localhost:${port}`).catch(() => {});
      }).catch(() => {});
    }
  }

  // Keep the process alive — the HTTP server handles the event loop,
  // but add an explicit unref guard to prevent accidental exit
  process.on('SIGINT', () => {
    console.log(`\n\x1b[36m[QwenTrace]\x1b[0m Shutting down...`);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[QwenTrace] Fatal error:', err);
  process.exit(1);
});
