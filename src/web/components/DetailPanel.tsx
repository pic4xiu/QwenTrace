import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { TraceEntry, ParsedSSEChunk } from '../../types';

// ── Color tokens ──────────────────────────────────────────────
const C = {
  bg: '#1e1e2e',
  tabBar: '#181825',
  tabActive: '#313244',
  tabActiveText: '#89b4fa',
  tabInactiveText: '#6c7086',
  text: '#cdd6f4',
  subtext: '#a6adc8',
  codeBg: '#11111b',
  border: '#313244',
  accent: '#89b4fa',
  dimText: '#585b70',
  badgeBg: '#313244',
  errorText: '#f38ba8',
  successText: '#a6e3a1',
  warningText: '#f9e2af',
} as const;

type TabId = 'overview' | 'request' | 'response' | 'sse' | 'timing';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'request', label: 'Request' },
  { id: 'response', label: 'Response' },
  { id: 'sse', label: 'SSE Stream' },
  { id: 'timing', label: 'Timing' },
];

// ── Helpers ───────────────────────────────────────────────────

function fmtMs(ms: number | undefined | null): string {
  if (ms == null || isNaN(ms)) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function statusColor(status: number): string {
  if (status >= 200 && status < 300) return C.successText;
  if (status >= 400) return C.errorText;
  return C.warningText;
}

function stateColor(state: TraceEntry['state']): string {
  switch (state) {
    case 'complete': return C.successText;
    case 'streaming': return C.accent;
    case 'error': return C.errorText;
    case 'pending': return C.warningText;
    default: return C.text;
  }
}

function tryFormatJson(raw: string | null | undefined): string {
  if (!raw) return '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

// ── Sub-components ────────────────────────────────────────────

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 4,
        background: C.badgeBg,
        color: C.accent,
        fontSize: 12,
        fontWeight: 600,
        marginLeft: 8,
      }}
    >
      {children}
    </span>
  );
}

function KVRow({ label, value, valueColor }: { label: string; value: React.ReactNode; valueColor?: string }) {
  return (
    <div style={{ display: 'flex', padding: '6px 0', borderBottom: `1px solid ${C.border}` }}>
      <span style={{ width: 160, minWidth: 160, color: C.subtext, fontSize: 13 }}>{label}</span>
      <span style={{ flex: 1, color: valueColor ?? C.text, fontSize: 13, wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre
      style={{
        background: C.codeBg,
        color: C.text,
        padding: 12,
        borderRadius: 6,
        fontSize: 12,
        lineHeight: 1.5,
        overflow: 'auto',
        maxHeight: 500,
        margin: '8px 0',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      <code>{children}</code>
    </pre>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        color: C.accent,
        fontSize: 14,
        fontWeight: 600,
        margin: '16px 0 8px',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}
    >
      {children}
    </h3>
  );
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <button
      onClick={handleCopy}
      style={{
        background: copied ? '#a6e3a122' : 'transparent',
        border: `1px solid ${copied ? '#a6e3a1' : C.border}`,
        color: copied ? '#a6e3a1' : C.subtext,
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 4,
        cursor: 'pointer',
        transition: 'all 0.15s',
        fontFamily: 'inherit',
        marginLeft: 8,
        whiteSpace: 'nowrap',
      }}
    >
      {copied ? 'Copied!' : (label || 'Copy')}
    </button>
  );
}

function HeaderTable({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers);
  if (entries.length === 0) {
    return <div style={{ color: C.dimText, fontSize: 13, padding: '8px 0' }}>No headers</div>;
  }
  return (
    <div style={{ fontSize: 13 }}>
      {entries.map(([k, v]) => (
        <div
          key={k}
          style={{
            display: 'flex',
            padding: '4px 0',
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          <span style={{ width: 220, minWidth: 220, color: C.accent, fontFamily: 'monospace', fontSize: 12 }}>
            {k}
          </span>
          <span style={{ flex: 1, color: C.text, wordBreak: 'break-all', fontFamily: 'monospace', fontSize: 12 }}>
            {v}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Tab content ───────────────────────────────────────────────

function OverviewTab({ trace }: { trace: TraceEntry }) {
  const usage = trace.assembled?.usage;
  return (
    <div>
      <SectionTitle>Request</SectionTitle>
      <KVRow label="URL" value={trace.url} />
      <KVRow label="Method" value={trace.method} />
      <KVRow
        label="Status"
        value={trace.status ? `${trace.status} ${trace.statusText}` : '--'}
        valueColor={trace.status ? statusColor(trace.status) : undefined}
      />
      <KVRow label="Model" value={trace.assembled?.model || trace.requestBody?.model || '--'} />

      <SectionTitle>Timing</SectionTitle>
      <KVRow label="Duration" value={fmtMs(trace.duration)} />
      <KVRow label="TTFB" value={fmtMs(trace.ttfb)} />

      <SectionTitle>Token Usage</SectionTitle>
      {usage ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 8,
            marginTop: 8,
          }}
        >
          {[
            { label: 'Prompt', value: usage.promptTokens },
            { label: 'Completion', value: usage.completionTokens },
            { label: 'Cached', value: usage.cachedTokens },
            { label: 'Total', value: usage.totalTokens },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                background: C.codeBg,
                borderRadius: 6,
                padding: '10px 14px',
                border: `1px solid ${C.border}`,
              }}
            >
              <div style={{ color: C.subtext, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {item.label}
              </div>
              <div style={{ color: C.text, fontSize: 18, fontWeight: 700, marginTop: 2 }}>
                {item.value != null ? item.value.toLocaleString() : '--'}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: C.dimText, fontSize: 13, padding: '8px 0' }}>No token usage data</div>
      )}

      <SectionTitle>Status</SectionTitle>
      <KVRow
        label="Finish Reason"
        value={trace.assembled?.finishReason || '--'}
      />
      <KVRow
        label="State"
        value={trace.state}
        valueColor={stateColor(trace.state)}
      />
      {trace.error && <KVRow label="Error" value={trace.error} valueColor={C.errorText} />}
    </div>
  );
}

function RequestTab({ trace }: { trace: TraceEntry }) {
  const body = trace.requestBody;
  const messagesCount = body?.messages?.length ?? 0;
  const toolsCount = body?.tools?.length ?? 0;

  const bodyText = body
    ? JSON.stringify(body, null, 2)
    : trace.rawRequestBody
      ? tryFormatJson(trace.rawRequestBody)
      : null;

  return (
    <div>
      <SectionTitle>Request Headers</SectionTitle>
      <HeaderTable headers={trace.requestHeaders ?? {}} />

      <div style={{ display: 'flex', alignItems: 'center', marginTop: 16, marginBottom: 8 }}>
        <SectionTitle>
          Request Body
          {messagesCount > 0 && <Badge>{messagesCount} message{messagesCount !== 1 ? 's' : ''}</Badge>}
          {toolsCount > 0 && <Badge>{toolsCount} tool{toolsCount !== 1 ? 's' : ''}</Badge>}
        </SectionTitle>
        {bodyText && <CopyButton text={bodyText} />}
      </div>
      {bodyText ? (
        <CodeBlock>{bodyText}</CodeBlock>
      ) : (
        <div style={{ color: C.dimText, fontSize: 13, padding: '8px 0' }}>No request body</div>
      )}
    </div>
  );
}

function ResponseTab({ trace }: { trace: TraceEntry }) {
  const assembled = trace.assembled;
  const isSSE = trace.isSSE || (trace.chunks?.length ?? 0) > 0;
  const jsonl = isSSE ? buildJsonl(trace.chunks ?? []) : '';
  const jsonlChunkCount = isSSE
    ? (trace.chunks ?? []).filter((c) => c.raw !== '[DONE]' && c.raw.trim()).length
    : 0;

  // Build the full copyable response text
  const buildFullResponse = (): string => {
    const parts: string[] = [];
    if (assembled) {
      if (assembled.fullText) parts.push(assembled.fullText);
      if (assembled.thinkingText) parts.push(`[Thinking]\n${assembled.thinkingText}`);
      if (assembled.toolCalls.length > 0) {
        parts.push(`[Tool Calls]\n${JSON.stringify(assembled.toolCalls, null, 2)}`);
      }
    } else if (trace.responseBody) {
      parts.push(tryFormatJson(trace.responseBody));
    }
    return parts.join('\n\n');
  };

  return (
    <div>
      {/* Response Headers */}
      <SectionTitle>Response Headers</SectionTitle>
      {Object.keys(trace.responseHeaders ?? {}).length > 0 ? (
        <HeaderTable headers={trace.responseHeaders} />
      ) : (
        <div style={{ color: C.dimText, fontSize: 13, padding: '8px 0' }}>No response headers</div>
      )}

      {/* Quick copy actions for SSE — full raw stream as JSONL */}
      {isSSE && jsonlChunkCount > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 16, marginBottom: 8 }}>
            <SectionTitle>
              Raw SSE Stream
              <Badge>JSONL</Badge>
            </SectionTitle>
            <CopyButton text={jsonl} label={`Copy as JSONL (${jsonlChunkCount})`} />
          </div>
          <div
            style={{
              fontSize: 11,
              color: C.dimText,
              marginBottom: 8,
              lineHeight: 1.5,
            }}
          >
            Each line is one OpenAI <code style={{ color: C.subtext }}>ChatCompletionChunk</code>. The trailing
            <code style={{ color: C.subtext }}> [DONE]</code> sentinel is excluded so the output is valid JSONL.
            Switch to the <strong style={{ color: C.subtext }}>SSE Stream</strong> tab to inspect chunks individually.
          </div>
        </>
      )}

      {/* Response Body */}
      {assembled ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 16, marginBottom: 8 }}>
            <SectionTitle>Assembled Response</SectionTitle>
            {(assembled.fullText || assembled.toolCalls.length > 0) && (
              <CopyButton text={buildFullResponse()} label="Copy All" />
            )}
          </div>
          {assembled.fullText ? (
            <CodeBlock>{assembled.fullText}</CodeBlock>
          ) : (
            <div style={{ color: C.dimText, fontSize: 13, padding: '8px 0' }}>No text content</div>
          )}

          {assembled.thinkingText ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', marginTop: 16, marginBottom: 8 }}>
                <SectionTitle>Thinking</SectionTitle>
                <CopyButton text={assembled.thinkingText} />
              </div>
              <CodeBlock>{assembled.thinkingText}</CodeBlock>
            </>
          ) : null}

          {assembled.toolCalls.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', marginTop: 16, marginBottom: 8 }}>
                <SectionTitle>Tool Calls ({assembled.toolCalls.length})</SectionTitle>
                <CopyButton text={JSON.stringify(assembled.toolCalls, null, 2)} />
              </div>
              <CodeBlock>{JSON.stringify(assembled.toolCalls, null, 2)}</CodeBlock>
            </>
          )}
        </>
      ) : trace.responseBody ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 16, marginBottom: 8 }}>
            <SectionTitle>
              Response Body
              <Badge>non-streaming</Badge>
            </SectionTitle>
            <CopyButton text={tryFormatJson(trace.responseBody)} />
          </div>
          <div style={{ fontSize: 11, color: C.dimText, marginBottom: 8 }}>
            This response did not use SSE streaming — likely a <code style={{ color: C.subtext }}>/v1/models</code>,
            <code style={{ color: C.subtext }}> /v1/embeddings</code>, a <code style={{ color: C.subtext }}>stream:false </code>
            request, or a non-streaming error payload.
          </div>
          <CodeBlock>{tryFormatJson(trace.responseBody)}</CodeBlock>
        </>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 200,
            color: C.dimText,
            fontSize: 14,
          }}
        >
          No response data
        </div>
      )}
    </div>
  );
}

// ── SSE chunk classification ──────────────────────────────────

type ChunkKind = 'content' | 'tool_call' | 'role' | 'finish' | 'usage' | 'done' | 'empty' | 'invalid';
type FilterKind = 'all' | 'content' | 'tool_call' | 'meta';

function classifyChunk(chunk: ParsedSSEChunk): ChunkKind {
  if (chunk.raw === '[DONE]') return 'done';
  const p = chunk.parsed;
  if (!p) return 'invalid';
  if (p.delta?.tool_calls && p.delta.tool_calls.length > 0) return 'tool_call';
  if (p.delta?.content) return 'content';
  if (p.delta?.role) return 'role';
  if (p.finish_reason) return 'finish';
  if (p.usage) return 'usage';
  return 'empty';
}

function chunkSummary(chunk: ParsedSSEChunk, kind: ChunkKind): { label: string; value: string; color: string } {
  const p = chunk.parsed;
  switch (kind) {
    case 'done':
      return { label: '[DONE]', value: 'stream end', color: C.dimText };
    case 'invalid':
      return { label: 'invalid', value: chunk.raw.slice(0, 80), color: C.errorText };
    case 'content':
      return { label: 'content', value: p?.delta?.content ?? '', color: C.text };
    case 'tool_call': {
      const tc = p?.delta?.tool_calls?.[0];
      const parts: string[] = [];
      if (tc?.id) parts.push(`id=${tc.id}`);
      if (tc?.function?.name) parts.push(`fn=${tc.function.name}`);
      if (tc?.function?.arguments) parts.push(tc.function.arguments);
      return { label: `tool_call[${tc?.index ?? '?'}]`, value: parts.join(' '), color: C.warningText };
    }
    case 'role':
      return { label: 'role', value: p?.delta?.role ?? '', color: C.subtext };
    case 'finish':
      return { label: 'finish_reason', value: p?.finish_reason ?? '', color: C.successText };
    case 'usage': {
      const u = p?.usage;
      return {
        label: 'usage',
        value: `prompt=${u?.prompt_tokens ?? '--'} completion=${u?.completion_tokens ?? '--'} total=${u?.total_tokens ?? '--'}`,
        color: C.successText,
      };
    }
    case 'empty':
    default:
      return { label: 'empty delta', value: '', color: C.dimText };
  }
}

function matchesFilter(kind: ChunkKind, filter: FilterKind): boolean {
  if (filter === 'all') return true;
  if (filter === 'content') return kind === 'content' || kind === 'role';
  if (filter === 'tool_call') return kind === 'tool_call';
  if (filter === 'meta') return kind === 'finish' || kind === 'usage' || kind === 'done';
  return true;
}

/** Build standard JSONL: one JSON object per line, [DONE] excluded. Invalid chunks kept as-is. */
function buildJsonl(chunks: ParsedSSEChunk[]): string {
  const lines: string[] = [];
  for (const c of chunks) {
    if (c.raw === '[DONE]') continue;
    const trimmed = c.raw.trim();
    if (!trimmed) continue;
    lines.push(trimmed);
  }
  return lines.join('\n');
}

// ── SSE Stream tab ────────────────────────────────────────────

function SSEStreamTab({ trace }: { trace: TraceEntry }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isStreaming = trace.state === 'streaming';
  const chunks = trace.chunks ?? [];

  const [filter, setFilter] = useState<FilterKind>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [bulkExpand, setBulkExpand] = useState<'collapsed' | 'expanded'>('collapsed');

  // Reset per-trace UI state
  useEffect(() => {
    setExpandedIds(new Set());
    setBulkExpand('collapsed');
    setFilter('all');
  }, [trace.id]);

  // Auto-scroll while streaming
  useEffect(() => {
    if (autoScroll && isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chunks.length, isStreaming, autoScroll]);

  const toggleChunk = useCallback((index: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setBulkExpand('expanded');
    setExpandedIds(new Set(chunks.map((_, i) => i)));
  }, [chunks]);

  const collapseAll = useCallback(() => {
    setBulkExpand('collapsed');
    setExpandedIds(new Set());
  }, []);

  const jsonl = buildJsonl(chunks);
  const validJsonlCount = chunks.filter((c) => c.raw !== '[DONE]' && c.raw.trim()).length;

  // Apply filter, but keep original index for display
  const visible = chunks
    .map((chunk, index) => ({ chunk, index, kind: classifyChunk(chunk) }))
    .filter(({ kind }) => matchesFilter(kind, filter));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>

      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          padding: '10px 0',
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 12, color: C.subtext, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 600, color: C.text }}>{chunks.length}</span>
          chunk{chunks.length !== 1 ? 's' : ''}
          {isStreaming && (
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: C.accent,
                animation: 'pulse 1.2s ease-in-out infinite',
              }}
            />
          )}
          {filter !== 'all' && (
            <span style={{ color: C.dimText }}>
              · showing <span style={{ color: C.accent, fontWeight: 600 }}>{visible.length}</span>
            </span>
          )}
        </span>

        <span style={{ flex: 1 }} />

        {/* Filter */}
        <SegmentedControl
          value={filter}
          onChange={(v) => setFilter(v as FilterKind)}
          options={[
            { id: 'all', label: 'All' },
            { id: 'content', label: 'Content' },
            { id: 'tool_call', label: 'Tools' },
            { id: 'meta', label: 'Meta' },
          ]}
        />

        {/* Expand/Collapse */}
        <ToolbarButton onClick={bulkExpand === 'expanded' ? collapseAll : expandAll}>
          {bulkExpand === 'expanded' ? 'Collapse all' : 'Expand all'}
        </ToolbarButton>

        {/* Auto-scroll */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11,
            color: C.subtext,
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            style={{ accentColor: C.accent, cursor: 'pointer' }}
          />
          Auto-scroll
        </label>

        {/* Copy as JSONL */}
        {validJsonlCount > 0 && <CopyButton text={jsonl} label={`Copy as JSONL (${validJsonlCount})`} />}
      </div>

      {/* Chunk list */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          minHeight: 0,
          padding: '8px 0',
        }}
      >
        {chunks.length === 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: 200,
              color: C.dimText,
              fontSize: 14,
            }}
          >
            {isStreaming ? 'Waiting for chunks...' : 'No SSE chunks'}
          </div>
        ) : visible.length === 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: 120,
              color: C.dimText,
              fontSize: 13,
            }}
          >
            No chunks match the current filter.
          </div>
        ) : (
          visible.map(({ chunk, index, kind }) => (
            <ChunkCard
              key={index}
              chunk={chunk}
              index={index}
              kind={kind}
              expanded={expandedIds.has(index)}
              onToggle={() => toggleChunk(index)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ToolbarButton({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? C.tabActive : 'transparent',
        border: `1px solid ${active ? C.accent : C.border}`,
        color: active ? C.accent : C.subtext,
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 4,
        cursor: 'pointer',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  );
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        border: `1px solid ${C.border}`,
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      {options.map((opt, i) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            style={{
              background: active ? C.tabActive : 'transparent',
              color: active ? C.accent : C.subtext,
              border: 'none',
              borderLeft: i === 0 ? 'none' : `1px solid ${C.border}`,
              fontSize: 11,
              padding: '2px 10px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: active ? 600 : 400,
              transition: 'all 0.15s',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ChunkCard({
  chunk,
  index,
  kind,
  expanded,
  onToggle,
}: {
  chunk: ParsedSSEChunk;
  index: number;
  kind: ChunkKind;
  expanded: boolean;
  onToggle: () => void;
}) {
  const summary = chunkSummary(chunk, kind);

  // The "raw" stored on the chunk is already the JSON string (data: prefix stripped).
  // For display we pretty-print it; for copy we keep the original (single-line) JSON to stay JSONL-friendly.
  const isDone = kind === 'done';
  const prettyJson = !isDone ? tryFormatJson(chunk.raw) : chunk.raw;
  const copyJson = chunk.raw;

  // [DONE] marker — render as a single thin row, not a card
  if (isDone) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 10px',
          margin: '4px 0',
          fontSize: 11,
          color: C.dimText,
          fontFamily: 'monospace',
          background: 'transparent',
          borderTop: `1px dashed ${C.border}`,
          borderBottom: `1px dashed ${C.border}`,
        }}
      >
        <span style={{ width: 36, textAlign: 'right' }}>{index}</span>
        <span style={{ color: C.accent, width: 72 }}>+{Math.round(chunk.elapsed)}ms</span>
        <span style={{ flex: 1 }}>──── [DONE] ────</span>
      </div>
    );
  }

  return (
    <div
      style={{
        background: C.codeBg,
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        margin: '6px 0',
        overflow: 'hidden',
      }}
    >
      {/* Header — clickable to toggle */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 10px',
          cursor: 'pointer',
          userSelect: 'none',
          background: expanded ? C.tabActive : 'transparent',
          transition: 'background 0.15s',
        }}
      >
        <span
          style={{
            color: C.dimText,
            fontSize: 10,
            fontFamily: 'monospace',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
            display: 'inline-block',
            width: 10,
          }}
        >
          ▶
        </span>
        <span
          style={{
            width: 36,
            textAlign: 'right',
            color: C.dimText,
            fontSize: 11,
            fontFamily: 'monospace',
          }}
        >
          #{index}
        </span>
        <span
          style={{
            width: 70,
            color: C.accent,
            fontSize: 11,
            fontFamily: 'monospace',
          }}
        >
          +{Math.round(chunk.elapsed)}ms
        </span>
        <span
          style={{
            width: 56,
            color: C.dimText,
            fontSize: 11,
            fontFamily: 'monospace',
          }}
          title="Time since previous chunk"
        >
          Δ{Math.round(chunk.deltaMs)}ms
        </span>
        <span
          style={{
            color: summary.color,
            fontSize: 11,
            fontFamily: 'monospace',
            fontWeight: 600,
            minWidth: 90,
          }}
        >
          {summary.label}
        </span>
        <span
          style={{
            flex: 1,
            color: summary.color,
            fontSize: 12,
            fontFamily: 'monospace',
            whiteSpace: 'pre',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            opacity: 0.85,
          }}
        >
          {summary.value}
        </span>
        <span onClick={(e) => e.stopPropagation()}>
          <CopyButton text={copyJson} label="Copy" />
        </span>
      </div>

      {/* Body */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${C.border}` }}>
          <pre
            style={{
              background: 'transparent',
              color: C.text,
              padding: 12,
              margin: 0,
              fontSize: 12,
              lineHeight: 1.5,
              overflow: 'auto',
              maxHeight: 360,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            <code>{prettyJson}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

function TimingTab({ trace }: { trace: TraceEntry }) {
  const ttfb = trace.ttfb || 0;
  const duration = trace.duration || 0;
  const streamDuration = duration > ttfb ? duration - ttfb : 0;
  const chunks = trace.chunks ?? [];
  const chunkCount = chunks.length;

  const avgInterval =
    chunkCount > 1
      ? chunks.reduce((sum, c, i) => (i === 0 ? 0 : sum + c.deltaMs), 0) / (chunkCount - 1)
      : 0;

  const completionTokens = trace.assembled?.usage?.completionTokens ?? 0;
  const tokenRate = streamDuration > 0 && completionTokens > 0
    ? (completionTokens / (streamDuration / 1000)).toFixed(1)
    : '--';

  // Bar proportions
  const total = Math.max(duration, 1);
  const ttfbPct = (ttfb / total) * 100;
  const streamPct = (streamDuration / total) * 100;

  return (
    <div>
      <SectionTitle>Timeline</SectionTitle>
      <div
        style={{
          display: 'flex',
          height: 32,
          borderRadius: 6,
          overflow: 'hidden',
          background: C.codeBg,
          border: `1px solid ${C.border}`,
          marginTop: 8,
        }}
      >
        {ttfbPct > 0 && (
          <div
            style={{
              width: `${ttfbPct}%`,
              background: '#fab387',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 600,
              color: '#1e1e2e',
              minWidth: ttfbPct > 8 ? undefined : 0,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            {ttfbPct > 12 ? 'TTFB' : ''}
          </div>
        )}
        {streamPct > 0 && (
          <div
            style={{
              width: `${streamPct}%`,
              background: C.accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 600,
              color: '#1e1e2e',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            {streamPct > 12 ? 'Streaming' : ''}
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#fab387' }} />
          <span style={{ color: C.subtext }}>TTFB</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: C.accent }} />
          <span style={{ color: C.subtext }}>Streaming</span>
        </div>
      </div>

      <SectionTitle>Summary</SectionTitle>
      <KVRow label="TTFB" value={fmtMs(ttfb)} />
      <KVRow label="Streaming Duration" value={fmtMs(streamDuration)} />
      <KVRow label="Total Duration" value={fmtMs(duration)} />
      <KVRow label="Chunk Count" value={chunkCount} />
      <KVRow label="Avg Chunk Interval" value={avgInterval > 0 ? fmtMs(avgInterval) : '--'} />
      <KVRow
        label="Token Generation Rate"
        value={tokenRate !== '--' ? `${tokenRate} tok/s` : '--'}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

interface DetailPanelProps {
  trace: TraceEntry | null;
}

function DetailPanel({ trace }: DetailPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  // Reset to overview when selected trace changes
  useEffect(() => {
    setActiveTab('overview');
  }, [trace?.id]);

  if (!trace) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          background: C.bg,
          color: C.dimText,
          fontSize: 14,
          userSelect: 'none',
        }}
      >
        Select a request to view details
      </div>
    );
  }

  let tabContent: React.ReactNode;
  switch (activeTab) {
    case 'overview':
      tabContent = <OverviewTab trace={trace} />;
      break;
    case 'request':
      tabContent = <RequestTab trace={trace} />;
      break;
    case 'response':
      tabContent = <ResponseTab trace={trace} />;
      break;
    case 'sse':
      tabContent = <SSEStreamTab trace={trace} />;
      break;
    case 'timing':
      tabContent = <TimingTab trace={trace} />;
      break;
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: C.bg,
        color: C.text,
      }}
    >
      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          background: C.tabBar,
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '10px 16px',
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? C.tabActiveText : C.tabInactiveText,
                background: isActive ? C.tabActive : 'transparent',
                border: 'none',
                cursor: 'pointer',
                outline: 'none',
                transition: 'background 0.15s, color 0.15s',
                borderBottom: isActive ? `2px solid ${C.accent}` : '2px solid transparent',
                fontFamily: 'inherit',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '0 16px 16px',
          minHeight: 0,
        }}
      >
        {tabContent}
      </div>
    </div>
  );
}

export default DetailPanel;
