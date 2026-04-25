// ============================================================
// QwenTrace — fetch interceptor hook
// Loaded into Qwen Code process via: node --import ./register.mjs
// Patches globalThis.fetch to capture AI API traffic.
// ============================================================

const TRACE_PORT = process.env.QWENTRACE_PORT || '7890';
const TRACE_URL = `http://127.0.0.1:${TRACE_PORT}/api/trace`;

// Keep a reference to the REAL fetch before we patch it
const _originalFetch = globalThis.fetch;

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function genId() {
  // crypto.randomUUID() is available in Node 19+, fallback for older
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Per-trace event queue: serialize all sends for a given traceId so events
 * arrive at the server in the same order they were emitted by the hook.
 *
 * Why this matters: each `_originalFetch` POST is independent and the server
 * processes them as they land on its socket. Without serialization the
 * `complete` event could overtake a late `[DONE]` chunk, which would race the
 * server into setting `state = 'streaming'` AFTER `state = 'complete'` — the
 * end result being a status dot that pulses forever for a finished request.
 *
 * We key the queue by traceId so independent traces still send in parallel.
 * Once a trace's queue drains, we drop the entry to avoid a slow memory leak.
 */
const _traceQueues = new Map();

function _postEvent(data) {
  return _originalFetch(TRACE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).catch(() => {
    // Server might not be running — silently ignore.
  });
}

function sendTrace(data) {
  const key = data.traceId || '__global__';
  const prev = _traceQueues.get(key) || Promise.resolve();
  const next = prev.then(() => _postEvent(data));
  _traceQueues.set(key, next);

  // Drop the queue reference once it settles, but only if no later send has
  // chained onto it in the meantime.
  next.finally(() => {
    if (_traceQueues.get(key) === next) {
      _traceQueues.delete(key);
    }
  });
}

/** Check if a URL looks like an AI API call we should trace. */
function shouldTrace(url) {
  if (typeof url !== 'string') {
    try { url = url.toString(); } catch { return false; }
  }
  // Ignore our own trace reporting calls
  if (url.includes(`127.0.0.1:${TRACE_PORT}`)) return false;
  if (url.includes(`localhost:${TRACE_PORT}`)) return false;
  // Match AI API endpoints
  return (
    url.includes('/chat/completions') ||
    url.includes('/v1/completions') ||
    url.includes('/v1/embeddings') ||
    url.includes('/v1/models')
  );
}

/**
 * Detect whether the response is a stream by sniffing Content-Type.
 * Used ONLY to set the lightweight `isSSE` flag on the response-start event;
 * we no longer ship the full headers object since Qwen Code itself doesn't
 * consume response headers in its model pipeline (and the bearer token in
 * request headers was a security risk in exports).
 */
function detectIsSSE(responseHeaders) {
  if (!responseHeaders || typeof responseHeaders.get !== 'function') return false;
  const ct = (responseHeaders.get('content-type') || '').toLowerCase();
  // text/plain is intentionally tolerated — some proxies rewrite SSE.
  return ct.includes('text/event-stream') || ct.includes('text/plain');
}

/** Safely extract request body as string. */
function extractBody(init) {
  if (!init?.body) return null;
  if (typeof init.body === 'string') return init.body;
  if (init.body instanceof ArrayBuffer) return new TextDecoder().decode(init.body);
  if (init.body instanceof Uint8Array) return new TextDecoder().decode(init.body);
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(init.body)) return init.body.toString('utf-8');
  // ReadableStream body — we can't read it without consuming, skip
  return null;
}

// ------------------------------------------------------------------
// SSE stream reader (runs in background, doesn't block caller)
// ------------------------------------------------------------------

async function captureSSEStream(stream, traceId, startTime) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6).trim();
          if (data === '[DONE]') {
            sendTrace({
              type: 'sse-chunk',
              traceId,
              timestamp: Date.now(),
              elapsed: Date.now() - startTime,
              data: '[DONE]',
            });
          } else {
            sendTrace({
              type: 'sse-chunk',
              traceId,
              timestamp: Date.now(),
              elapsed: Date.now() - startTime,
              data,
            });
          }
        }
      }
    }

    // Flush remaining buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith('data: ')) {
        sendTrace({
          type: 'sse-chunk',
          traceId,
          timestamp: Date.now(),
          elapsed: Date.now() - startTime,
          data: trimmed.slice(6).trim(),
        });
      }
    }

    sendTrace({
      type: 'complete',
      traceId,
      timestamp: Date.now(),
      duration: Date.now() - startTime,
    });
  } catch (err) {
    sendTrace({
      type: 'complete',
      traceId,
      timestamp: Date.now(),
      duration: Date.now() - startTime,
      error: err?.message || String(err),
    });
  }
}

// ------------------------------------------------------------------
// Patch globalThis.fetch
// ------------------------------------------------------------------

globalThis.fetch = async function qwenTraceFetch(input, init) {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input?.url || '';

  if (!shouldTrace(url)) {
    return _originalFetch(input, init);
  }

  const traceId = genId();
  const startTime = Date.now();

  // --- Report request ---
  // Headers intentionally NOT sent — they only contain SDK metadata
  // (x-stainless-*) and a bearer token, neither of which the AI sees.
  const requestBody = extractBody(init);
  sendTrace({
    type: 'request',
    traceId,
    timestamp: startTime,
    url,
    method: init?.method || 'POST',
    body: requestBody,
  });

  try {
    // --- Call the real fetch ---
    const response = await _originalFetch(input, init);
    const now = Date.now();

    // --- Detect streaming once, share with both the report and the body branch ---
    const isSSE = detectIsSSE(response.headers);

    // --- Report response start ---
    // Only ship `isSSE` (a single bool) instead of the entire headers object;
    // see types.ts for the full rationale.
    sendTrace({
      type: 'response-start',
      traceId,
      timestamp: now,
      status: response.status,
      statusText: response.statusText,
      ttfb: now - startTime,
      isSSE,
    });

    // Check if this is actually a streaming request
    let requestIsStreaming = false;
    if (requestBody) {
      try {
        const parsed = JSON.parse(requestBody);
        requestIsStreaming = parsed.stream === true;
      } catch { /* not JSON */ }
    }

    if ((isSSE || requestIsStreaming) && response.body) {
      // Tee the stream: one branch for capture, one for the caller
      const [captureBranch, passBranch] = response.body.tee();

      // Read capture branch in background (non-blocking)
      captureSSEStream(captureBranch, traceId, startTime);

      // Return new Response with the pass branch
      return new Response(passBranch, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    // --- Non-streaming: clone and capture body ---
    const cloned = response.clone();
    cloned.text().then((text) => {
      sendTrace({
        type: 'response-body',
        traceId,
        timestamp: Date.now(),
        body: text,
        duration: Date.now() - startTime,
      });
      sendTrace({
        type: 'complete',
        traceId,
        timestamp: Date.now(),
        duration: Date.now() - startTime,
      });
    }).catch(() => {});

    return response;
  } catch (err) {
    sendTrace({
      type: 'error',
      traceId,
      timestamp: Date.now(),
      error: err?.message || String(err),
      duration: Date.now() - startTime,
    });
    throw err;
  }
};

// Log confirmation (visible in Qwen Code's stderr)
process.stderr.write(
  `\x1b[36m[QwenTrace]\x1b[0m Hook active — reporting to http://127.0.0.1:${TRACE_PORT}\n`
);
