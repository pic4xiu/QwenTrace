// ============================================================
// QwenTrace shared types — used by hook, server, and frontend
// ============================================================

/** Unique ID for each traced HTTP round-trip */
export type TraceId = string;

// ---- Trace events (hook → server) ---- //

export interface TraceRequestEvent {
  type: 'request';
  traceId: TraceId;
  timestamp: number;
  url: string;
  method: string;
  body: string | null;
  /**
   * @deprecated Headers are no longer captured (2026-04). Field kept optional
   * so the type stays compatible if external tooling still emits it.
   */
  headers?: Record<string, string>;
}

export interface TraceResponseStartEvent {
  type: 'response-start';
  traceId: TraceId;
  timestamp: number;
  status: number;
  statusText: string;
  ttfb: number;
  /**
   * Hook-side hint indicating the response was a stream. Server prefers to
   * derive this from the request body's `stream: true` flag and only falls
   * back to this when request body parsing failed.
   */
  isSSE?: boolean;
  /**
   * @deprecated Headers are no longer captured (2026-04). Field kept optional
   * so the type stays compatible if external tooling still emits it.
   */
  headers?: Record<string, string>;
}

export interface TraceSSEChunkEvent {
  type: 'sse-chunk';
  traceId: TraceId;
  timestamp: number;
  elapsed: number;
  data: string;
}

export interface TraceResponseBodyEvent {
  type: 'response-body';
  traceId: TraceId;
  timestamp: number;
  body: string;
  duration: number;
}

export interface TraceCompleteEvent {
  type: 'complete';
  traceId: TraceId;
  timestamp: number;
  duration: number;
  error?: string;
}

export interface TraceErrorEvent {
  type: 'error';
  traceId: TraceId;
  timestamp: number;
  error: string;
  duration: number;
}

export type TraceEvent =
  | TraceRequestEvent
  | TraceResponseStartEvent
  | TraceSSEChunkEvent
  | TraceResponseBodyEvent
  | TraceCompleteEvent
  | TraceErrorEvent;

// ---- Assembled trace (server → frontend) ---- //

export interface ParsedSSEChunk {
  timestamp: number;
  elapsed: number;
  deltaMs: number;
  raw: string;
  parsed: {
    id?: string;
    model?: string;
    delta?: {
      role?: string;
      content?: string;
      // Qwen / DeepSeek emit chain-of-thought via `reasoning_content`,
      // some providers (Anthropic-compat) use `thinking`. Capture both.
      reasoning_content?: string;
      thinking?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  } | null;
}

export interface AssembledResponse {
  fullText: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  thinkingText: string;
  finishReason: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens: number;
  };
}

export interface ParsedRequestBody {
  model?: string;
  messages?: Array<{
    role: string;
    content: unknown;
    tool_calls?: unknown[];
    tool_call_id?: string;
  }>;
  tools?: Array<{
    type: string;
    function: { name: string; description?: string; parameters?: unknown };
  }>;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TraceEntry {
  id: TraceId;
  startTime: number;
  /**
   * Wall-clock timestamp at which the trace transitioned to a terminal state
   * (`complete` or `error`). Undefined while the request is still in flight.
   * Useful for joins / analytics where `duration` (a relative delta) is
   * insufficient.
   */
  endTime?: number;
  // Request
  url: string;
  method: string;
  requestBody: ParsedRequestBody | null;
  rawRequestBody: string | null;
  // Response
  status: number;
  statusText: string;
  // SSE
  isSSE: boolean;
  chunks: ParsedSSEChunk[];
  assembled: AssembledResponse | null;
  // Non-SSE body
  responseBody: string | null;
  // Timing
  ttfb: number;
  duration: number;
  // State
  state: 'pending' | 'streaming' | 'complete' | 'error';
  error?: string;
  /**
   * @deprecated Headers are no longer captured (2026-04). Reading these from
   * an old export file is still supported, but new traces will leave them
   * undefined. Verified that Qwen Code's pipeline only consumes the response
   * body (qwen-code/packages/core/src/core/openaiContentGenerator/).
   */
  requestHeaders?: Record<string, string>;
  /** @deprecated See `requestHeaders` above. */
  responseHeaders?: Record<string, string>;
}

// ---- WebSocket messages (server ↔ frontend) ---- //

export interface WSTraceUpdate {
  type: 'trace-update';
  trace: TraceEntry;
}

export interface WSTraceChunk {
  type: 'trace-chunk';
  traceId: TraceId;
  chunk: ParsedSSEChunk;
  assembled: AssembledResponse | null;
  state: TraceEntry['state'];
  duration: number;
}

export interface WSTraceList {
  type: 'trace-list';
  traces: TraceEntry[];
}

export type WSMessage = WSTraceUpdate | WSTraceChunk | WSTraceList;
