import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { TraceEntry, ParsedSSEChunk } from '../../types';
import { getAgentRoleMeta } from '../utils/agentRole';

// ── Color tokens ──────────────────────────────────────────────
// Catppuccin Mocha base, deliberately scoped:
//   - `accent` is the ONLY blue and is reserved for active/focused/CTA states
//   - section titles, table keys, and metadata use neutral subtext, not accent
//   - shadows are tinted to the canvas (`#1e1e2e`) instead of generic black
const C = {
  bg: '#1e1e2e',
  surface: '#232334',     // raised one step above bg, for cards
  surfaceAlt: '#262638',  // raised two steps, for expanded states
  tabBar: '#181825',
  tabActive: '#2a2a3c',
  tabActiveText: '#cdd6f4',
  tabInactiveText: '#6c7086',
  text: '#cdd6f4',
  subtext: '#a6adc8',
  codeBg: '#161622',
  border: '#2a2a3c',
  borderStrong: '#393952',
  accent: '#89b4fa',
  accentDim: '#89b4fa22',
  dimText: '#585b70',
  badgeBg: 'rgba(205, 214, 244, 0.06)',
  badgeText: '#a6adc8',
  errorText: '#f38ba8',
  successText: '#a6e3a1',
  warningText: '#f9e2af',
  toolText: '#fab387',    // peach for tool calls — distinct from warning
  shadowSm: '0 1px 2px rgba(0, 0, 0, 0.25)',
  shadowMd: '0 1px 2px rgba(0, 0, 0, 0.2), 0 4px 12px rgba(11, 11, 18, 0.35)',
} as const;

type TabId = 'overview' | 'request' | 'response' | 'sse' | 'timing';

// Tab semantics:
//   - "Pretty"  → human-readable rendering (assembled thinking + text + tool calls)
//   - "Raw"     → completely unprocessed response body (SSE stream verbatim, OR full JSON for non-SSE)
const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'request', label: 'Request' },
  { id: 'response', label: 'Pretty' },
  { id: 'sse', label: 'Raw' },
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

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'accent' }) {
  // Default tone is neutral so badges don't fight the section title for attention.
  // `accent` is reserved for badges that ARE the focal CTA hint (e.g. "JSONL").
  const isAccent = tone === 'accent';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        borderRadius: 3,
        background: isAccent ? C.accentDim : C.badgeBg,
        color: isAccent ? C.accent : C.badgeText,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.04em',
        marginLeft: 8,
        verticalAlign: 'middle',
      }}
    >
      {children}
    </span>
  );
}

function KVRow({ label, value, valueColor, mono }: { label: string; value: React.ReactNode; valueColor?: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', padding: '7px 0', borderBottom: `1px solid ${C.border}` }}>
      <span style={{ width: 160, minWidth: 160, color: C.subtext, fontSize: 12 }}>{label}</span>
      <span
        className={mono ? 'qt-mono' : 'qt-num'}
        style={{ flex: 1, color: valueColor ?? C.text, fontSize: 13, wordBreak: 'break-all' }}
      >
        {value}
      </span>
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre
      style={{
        background: C.codeBg,
        color: C.text,
        padding: '12px 14px',
        borderRadius: 8,
        border: `1px solid ${C.border}`,
        fontSize: 12,
        lineHeight: 1.55,
        overflow: 'auto',
        maxHeight: 500,
        margin: '6px 0',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      <code>{children}</code>
    </pre>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  // Eyebrow-style: small, neutral, all-caps with strong tracking.
  // The accent color is no longer the default for headings — it's reserved for active states.
  return (
    <h3
      style={{
        color: C.subtext,
        fontSize: 11,
        fontWeight: 600,
        margin: '20px 0 10px',
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
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

  // Pill-shaped button with an inline glyph + label. Active/focus styles
  // come from App.css globals.
  return (
    <button
      onClick={handleCopy}
      title={copied ? 'Copied to clipboard' : 'Copy to clipboard'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: copied ? 'rgba(166, 227, 161, 0.12)' : 'transparent',
        border: `1px solid ${copied ? C.successText : C.border}`,
        color: copied ? C.successText : C.subtext,
        fontSize: 11,
        padding: '3px 10px 3px 8px',
        borderRadius: 999,
        cursor: 'pointer',
        marginLeft: 8,
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden style={{ fontSize: 12, lineHeight: 1, opacity: 0.85 }}>
        {copied ? '✓' : '⎘'}
      </span>
      {copied ? 'Copied' : (label || 'Copy')}
    </button>
  );
}

// HeaderTable was removed in 2026-04. Rationale documented at the two former
// call sites (RequestTab / ResponseTab). TL;DR: Qwen Code never reads response
// headers in its model interaction pipeline, so they were UI noise and a
// security risk (bearer token leaked through JSON export).

// ── Tab content ───────────────────────────────────────────────

function StateBadge({ state }: { state: TraceEntry['state'] }) {
  // Compact dot + sentence-case label, replacing the raw 'streaming' string.
  const labels: Record<TraceEntry['state'], string> = {
    pending: 'Pending',
    streaming: 'Streaming',
    complete: 'Complete',
    error: 'Failed',
  };
  const color = stateColor(state);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color }}>
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: color,
          boxShadow: state === 'streaming' ? `0 0 6px ${color}` : 'none',
          animation: state === 'streaming' ? 'pulse 1.4s ease-in-out infinite' : undefined,
        }}
      />
      {labels[state]}
    </span>
  );
}

function OverviewTab({ trace }: { trace: TraceEntry }) {
  const usage = trace.assembled?.usage;
  // Identify which Qwen Code agent originated this call. The Overview tab
  // is the "who/what/when" page, so the role belongs at the very top — it
  // answers the question users ask first when scanning a trace.
  const role = getAgentRoleMeta(trace);

  // Token usage as 4 stat tiles arranged 4-up on wide screens, dropping to 2-up on narrow.
  // Style is "data divider" rather than "card with shadow + border" — driven by `border-top`
  // accent stripe and large mono numerals, per the dashboard-hardening rule from the skill.
  const tokenStats = usage
    ? [
        { key: 'prompt', label: 'Prompt', value: usage.promptTokens, accent: false },
        { key: 'completion', label: 'Completion', value: usage.completionTokens, accent: true },
        { key: 'cached', label: 'Cached', value: usage.cachedTokens, accent: false },
        { key: 'total', label: 'Total', value: usage.totalTokens, accent: false },
      ]
    : [];

  return (
    <div>
      {/* Agent role identity card — prominent because "which agent is this?"
          is the most useful single question when triaging Qwen Code traffic.
          Uses the role's signature color as a left border stripe (concentric
          with the surface fill), keeping the page calm but unmistakable. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
          padding: '14px 16px',
          marginBottom: 18,
          background: C.surface,
          borderRadius: 10,
          borderLeft: `3px solid ${role.color}`,
          boxShadow: C.shadowSm,
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            flexShrink: 0,
            borderRadius: 8,
            background: `${role.color}1f`, // ~12% alpha tinted fill
            color: role.color,
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          {role.symbol}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="qt-eyebrow" style={{ marginBottom: 4 }}>
            Agent role
          </div>
          <div
            style={{
              color: C.text,
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              lineHeight: 1.25,
            }}
          >
            {role.label}
          </div>
          <div
            style={{
              color: C.dimText,
              fontSize: 12,
              lineHeight: 1.55,
              marginTop: 4,
              maxWidth: 560,
            }}
          >
            {role.description}
          </div>
        </div>
      </div>

      <SectionTitle>Request</SectionTitle>
      <KVRow label="URL" value={trace.url} mono />
      <KVRow label="Method" value={trace.method} mono />
      <KVRow
        label="Status"
        value={trace.status ? `${trace.status} ${trace.statusText}` : '—'}
        valueColor={trace.status ? statusColor(trace.status) : undefined}
        mono
      />
      <KVRow label="Model" value={trace.assembled?.model || trace.requestBody?.model || '—'} mono />

      <SectionTitle>Timing</SectionTitle>
      <KVRow label="Duration" value={fmtMs(trace.duration)} />
      <KVRow label="TTFB" value={fmtMs(trace.ttfb)} />

      <SectionTitle>Token usage</SectionTitle>
      {usage ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 10,
            marginTop: 6,
          }}
        >
          {tokenStats.map((item) => (
            <div
              key={item.key}
              style={{
                background: C.surface,
                borderRadius: 10,
                padding: '12px 14px 14px',
                borderTop: `2px solid ${item.accent ? C.accent : C.borderStrong}`,
                boxShadow: C.shadowSm,
              }}
            >
              <div className="qt-eyebrow">{item.label}</div>
              <div
                className="qt-mono"
                style={{
                  color: C.text,
                  fontSize: 22,
                  fontWeight: 600,
                  marginTop: 4,
                  letterSpacing: '-0.01em',
                  lineHeight: 1.1,
                }}
              >
                {item.value != null ? item.value.toLocaleString() : '—'}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: C.dimText, fontSize: 12, padding: '8px 0' }}>No token usage reported.</div>
      )}

      <SectionTitle>Status</SectionTitle>
      <KVRow label="State" value={<StateBadge state={trace.state} />} />
      <KVRow
        label="Finish reason"
        value={trace.assembled?.finishReason || '—'}
        mono
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
      {/* Headers intentionally hidden — Qwen Code uses only request body for
          model interaction. Headers are SDK metadata + bearer token (security
          risk in exports). See git log 2026-04 for full rationale. */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <SectionTitle>
          Request body
          {messagesCount > 0 && <Badge>{messagesCount} message{messagesCount !== 1 ? 's' : ''}</Badge>}
          {toolsCount > 0 && <Badge>{toolsCount} tool{toolsCount !== 1 ? 's' : ''}</Badge>}
        </SectionTitle>
        {bodyText && <CopyButton text={bodyText} />}
      </div>
      {bodyText ? (
        <CodeBlock>{bodyText}</CodeBlock>
      ) : (
        <div style={{ color: C.dimText, fontSize: 12, padding: '8px 0' }}>No request body.</div>
      )}
    </div>
  );
}

/**
 * ResponseTab — Pretty View.
 *
 * Shows the *human-readable* rendering of the response, regardless of whether
 * the underlying transport was SSE or a single JSON payload. The server
 * normalises both shapes into `trace.assembled`, so this tab only ever has to
 * deal with one data structure: thinking → text → tool calls → usage.
 *
 * Anything raw (the byte-for-byte response body) lives in the "Raw" tab.
 */
function ResponseTab({ trace }: { trace: TraceEntry }) {
  const assembled = trace.assembled;
  const isSSE = trace.isSSE || (trace.chunks?.length ?? 0) > 0;

  // Aggregate every renderable section into a single "Copy all" payload.
  const buildFullResponse = (): string => {
    if (!assembled) return '';
    const parts: string[] = [];
    if (assembled.thinkingText) parts.push(`[Thinking]\n${assembled.thinkingText}`);
    if (assembled.fullText) parts.push(assembled.fullText);
    if (assembled.toolCalls.length > 0) {
      parts.push(`[Tool Calls]\n${JSON.stringify(assembled.toolCalls, null, 2)}`);
    }
    return parts.join('\n\n');
  };

  const hasAnyContent = !!(
    assembled &&
    (assembled.fullText || assembled.thinkingText || assembled.toolCalls.length > 0)
  );

  return (
    <div>
      {/* Headers intentionally hidden — Qwen Code's pipeline only consumes the
          response body (verified in qwen-code/packages/core/src/core/openaiContentGenerator/).
          The OpenAI SDK decides SSE vs JSON from the request `stream` flag, not
          from response Content-Type, so showing 17 transport headers per trace
          was pure noise. */}
      <div
        style={{
          padding: '8px 12px',
          fontSize: 11,
          color: C.dimText,
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          lineHeight: 1.55,
          marginBottom: 4,
        }}
      >
        Parsed, human-friendly view. For the unmodified {isSSE ? 'SSE stream' : 'JSON body'},
        switch to the <strong style={{ color: C.text }}>Raw</strong> tab.
      </div>

      {/* Assembled rendering */}
      {assembled ? (
        <>
          {/* Thinking — rendered first because reasoning precedes the answer */}
          {assembled.thinkingText && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', marginTop: 18, marginBottom: 8 }}>
                <SectionTitle>
                  Thinking
                  <Badge>reasoning</Badge>
                </SectionTitle>
                <CopyButton text={assembled.thinkingText} />
              </div>
              <CodeBlock>{assembled.thinkingText}</CodeBlock>
            </>
          )}

          {/* Final text content */}
          {assembled.fullText && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', marginTop: 18, marginBottom: 8 }}>
                <SectionTitle>Content</SectionTitle>
                <CopyButton text={assembled.fullText} />
              </div>
              <CodeBlock>{assembled.fullText}</CodeBlock>
            </>
          )}

          {/* Tool calls — pretty-print arguments JSON when possible */}
          {assembled.toolCalls.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', marginTop: 18, marginBottom: 8 }}>
                <SectionTitle>Tool calls ({assembled.toolCalls.length})</SectionTitle>
                <CopyButton text={JSON.stringify(assembled.toolCalls, null, 2)} />
              </div>
              {assembled.toolCalls.map((tc, i) => (
                <div
                  key={`${tc.id || 'tc'}-${i}`}
                  style={{
                    background: C.surface,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    padding: '10px 14px',
                    marginBottom: 8,
                    boxShadow: C.shadowSm,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 10,
                      marginBottom: 8,
                    }}
                  >
                    <span
                      className="qt-mono"
                      style={{ color: C.toolText, fontSize: 12, fontWeight: 600 }}
                    >
                      {tc.name || '(unnamed)'}
                    </span>
                    {tc.id && (
                      <span className="qt-mono" style={{ color: C.dimText, fontSize: 10 }}>
                        {tc.id}
                      </span>
                    )}
                  </div>
                  <pre
                    style={{
                      background: C.codeBg,
                      color: C.text,
                      padding: '10px 12px',
                      borderRadius: 6,
                      fontSize: 12,
                      lineHeight: 1.55,
                      margin: 0,
                      overflow: 'auto',
                      maxHeight: 320,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    <code>{tryFormatJson(tc.arguments || '{}')}</code>
                  </pre>
                </div>
              ))}
            </>
          )}

          {/* Usage summary — surfaces the token counts inline so this tab is self-contained */}
          {assembled.usage && (assembled.usage.totalTokens > 0 || assembled.usage.promptTokens > 0) && (
            <>
              <SectionTitle>Usage</SectionTitle>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 18,
                  fontSize: 12,
                  color: C.subtext,
                  padding: '6px 0 4px',
                }}
              >
                <span>
                  <span className="qt-eyebrow" style={{ marginRight: 6 }}>Prompt</span>
                  <span className="qt-mono" style={{ color: C.text }}>
                    {assembled.usage.promptTokens.toLocaleString()}
                  </span>
                </span>
                <span>
                  <span className="qt-eyebrow" style={{ marginRight: 6 }}>Completion</span>
                  <span className="qt-mono" style={{ color: C.text }}>
                    {assembled.usage.completionTokens.toLocaleString()}
                  </span>
                </span>
                <span>
                  <span className="qt-eyebrow" style={{ marginRight: 6 }}>Total</span>
                  <span className="qt-mono" style={{ color: C.text }}>
                    {assembled.usage.totalTokens.toLocaleString()}
                  </span>
                </span>
                {assembled.finishReason && (
                  <span>
                    <span className="qt-eyebrow" style={{ marginRight: 6 }}>Finish</span>
                    <span className="qt-mono" style={{ color: C.text }}>
                      {assembled.finishReason}
                    </span>
                  </span>
                )}
              </div>
            </>
          )}

          {/* Sticky "Copy all" footer when there's anything worth copying */}
          {hasAnyContent && (
            <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end' }}>
              <CopyButton text={buildFullResponse()} label="Copy all" />
            </div>
          )}

          {/* True empty state — assembled exists but is entirely blank */}
          {!hasAnyContent && (
            <div style={{ color: C.dimText, fontSize: 12, padding: '14px 0' }}>
              The response was received successfully but contained no text, thinking, or tool calls.
            </div>
          )}
        </>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 8,
            padding: '40px 20px',
            color: C.dimText,
            fontSize: 12,
            textAlign: 'center',
          }}
        >
          <div style={{ color: C.subtext, fontSize: 13 }}>No response yet</div>
          <div>Once the request completes, the parsed response will appear here.</div>
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

/**
 * Reconstruct the wire-format SSE stream from captured chunks.
 * Each event is rendered as `data: <payload>\n\n` — exactly what
 * the network would have delivered. The trailing `[DONE]` sentinel
 * is preserved so the output is byte-identical to a real SSE response.
 */
function buildRawSseStream(chunks: ParsedSSEChunk[]): string {
  const out: string[] = [];
  for (const c of chunks) {
    const payload = c.raw;
    if (!payload) continue;
    out.push(`data: ${payload}\n\n`);
  }
  return out.join('');
}

// ── Raw tab ───────────────────────────────────────────────────
//
// "Raw" is the byte-level view. Two transport shapes are supported:
//
//   1. SSE stream  → reconstruct the wire format `data: ...\n\n` from chunks.
//                    Sub-views: Stream (raw text) / Chunks (cards) / JSONL.
//   2. JSON body   → display the verbatim response body, no parsing applied.
//
// The Pretty tab takes care of human-friendly rendering; this tab is for
// engineers who need to verify or replay the exact bytes the server sent.

type RawView = 'stream' | 'chunks' | 'jsonl';

function SSEStreamTab({ trace }: { trace: TraceEntry }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isStreaming = trace.state === 'streaming';
  const chunks = trace.chunks ?? [];
  const isSSE = trace.isSSE || chunks.length > 0;

  // Per-trace UI state — reset whenever the user picks a different request.
  const [filter, setFilter] = useState<FilterKind>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [bulkExpand, setBulkExpand] = useState<'collapsed' | 'expanded'>('collapsed');
  const [view, setView] = useState<RawView>('stream');
  const [wrap, setWrap] = useState(true);

  useEffect(() => {
    setExpandedIds(new Set());
    setBulkExpand('collapsed');
    setFilter('all');
    setView(isSSE ? 'stream' : 'stream');
  }, [trace.id, isSSE]);

  // Auto-scroll while streaming (only meaningful in chunk view)
  useEffect(() => {
    if (autoScroll && isStreaming && view === 'chunks' && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chunks.length, isStreaming, autoScroll, view]);

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

  // ── Branch: non-SSE response ───────────────────────────────────
  // Just dump the raw body. No filtering, no chunking, no transformation.
  if (!isSSE) {
    const body = trace.responseBody ?? '';
    const hasBody = body.length > 0;
    const looksLikeJson = hasBody && /^\s*[\{\[]/.test(body);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Toolbar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 10,
            padding: '10px 0',
            borderBottom: `1px solid ${C.border}`,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 12, color: C.subtext }}>
            <Badge>non-streaming</Badge>
            <span style={{ marginLeft: 8 }}>
              <span className="qt-mono" style={{ color: C.text }}>
                {body.length.toLocaleString()}
              </span>{' '}
              bytes
            </span>
          </span>
          <span style={{ flex: 1 }} />
          {hasBody && <CopyButton text={body} label="Copy raw body" />}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0, padding: '12px 0' }}>
          {hasBody ? (
            <pre
              style={{
                background: C.codeBg,
                color: C.text,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: '14px 16px',
                margin: 0,
                fontSize: 12,
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              <code>{body}</code>
            </pre>
          ) : (
            <RawEmptyState
              title="No response body captured"
              detail="The server returned an empty body, or the body wasn't captured before the connection closed."
            />
          )}
          {hasBody && looksLikeJson && (
            <div
              style={{
                marginTop: 10,
                fontSize: 11,
                color: C.dimText,
                lineHeight: 1.55,
              }}
            >
              This response is a single JSON document, not an SSE stream.
              Switch to the <strong style={{ color: C.subtext }}>Pretty</strong> tab for parsed thinking, content, and tool calls.
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Branch: SSE stream ─────────────────────────────────────────
  const validJsonlCount = chunks.filter((c) => c.raw !== '[DONE]' && c.raw.trim()).length;
  const rawStream = buildRawSseStream(chunks);
  const jsonl = buildJsonl(chunks);

  // Filter only applies to chunk view
  const visible = chunks
    .map((chunk, index) => ({ chunk, index, kind: classifyChunk(chunk) }))
    .filter(({ kind }) => matchesFilter(kind, filter));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>

      {/* Toolbar — primary row: counts + view selector */}
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
          <span className="qt-mono" style={{ fontWeight: 600, color: C.text }}>
            {chunks.length}
          </span>
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
          {view === 'chunks' && filter !== 'all' && (
            <span style={{ color: C.dimText }}>
              · showing{' '}
              <span className="qt-mono" style={{ color: C.text, fontWeight: 600 }}>
                {visible.length}
              </span>
            </span>
          )}
        </span>

        <span style={{ flex: 1 }} />

        {/* View selector — three byte-level perspectives */}
        <SegmentedControl
          value={view}
          onChange={(v) => setView(v as RawView)}
          options={[
            { id: 'stream', label: 'Stream' },
            { id: 'chunks', label: 'Chunks' },
            { id: 'jsonl', label: 'JSONL' },
          ]}
        />

        {/* Copy current view as a single text blob */}
        {view === 'stream' && rawStream && (
          <CopyButton text={rawStream} label="Copy stream" />
        )}
        {view === 'jsonl' && validJsonlCount > 0 && (
          <CopyButton text={jsonl} label={`Copy JSONL (${validJsonlCount})`} />
        )}
      </div>

      {/* Toolbar — secondary row: only meaningful in Chunks view */}
      {view === 'chunks' && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            padding: '8px 0',
            borderBottom: `1px solid ${C.border}`,
            flexShrink: 0,
          }}
        >
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
          <ToolbarButton onClick={bulkExpand === 'expanded' ? collapseAll : expandAll}>
            {bulkExpand === 'expanded' ? 'Collapse all' : 'Expand all'}
          </ToolbarButton>
          <span style={{ flex: 1 }} />
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
        </div>
      )}

      {/* Toolbar — wrap toggle for stream/jsonl text views */}
      {(view === 'stream' || view === 'jsonl') && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 0',
            borderBottom: `1px solid ${C.border}`,
            flexShrink: 0,
          }}
        >
          <span style={{ flex: 1 }} />
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
              checked={wrap}
              onChange={(e) => setWrap(e.target.checked)}
              style={{ accentColor: C.accent, cursor: 'pointer' }}
            />
            Wrap lines
          </label>
        </div>
      )}

      {/* Body */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          minHeight: 0,
          padding: '12px 0',
        }}
      >
        {chunks.length === 0 ? (
          <RawEmptyState
            title={isStreaming ? 'Waiting for the first chunk…' : 'No SSE chunks captured'}
            detail={
              isStreaming
                ? 'The connection is open but the server has not yet sent any data.'
                : 'The request did not produce any streaming chunks.'
            }
          />
        ) : view === 'stream' ? (
          <RawTextBlock text={rawStream} wrap={wrap} />
        ) : view === 'jsonl' ? (
          validJsonlCount > 0 ? (
            <RawTextBlock text={jsonl} wrap={wrap} />
          ) : (
            <RawEmptyState
              title="No JSON-L content"
              detail="None of the captured chunks contained a parseable JSON payload."
            />
          )
        ) : visible.length === 0 ? (
          <RawEmptyState
            title="No chunks match the current filter"
            detail="Try a different filter, or switch back to All."
          />
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

// ── Raw view helpers ──────────────────────────────────────────

/** Single dark code block for raw stream / JSONL views. */
function RawTextBlock({ text, wrap }: { text: string; wrap: boolean }) {
  return (
    <pre
      style={{
        background: C.codeBg,
        color: C.text,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: '14px 16px',
        margin: 0,
        fontSize: 12,
        lineHeight: 1.55,
        whiteSpace: wrap ? 'pre-wrap' : 'pre',
        wordBreak: wrap ? 'break-word' : 'normal',
        overflow: 'auto',
      }}
    >
      <code>{text}</code>
    </pre>
  );
}

/** Composed empty state used across all Raw view branches. */
function RawEmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '40px 20px',
        color: C.dimText,
        fontSize: 12,
        textAlign: 'center',
      }}
    >
      <div
        aria-hidden
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          border: `1px dashed ${C.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: C.dimText,
          fontSize: 16,
          marginBottom: 6,
        }}
      >
        ◌
      </div>
      <div style={{ color: C.subtext, fontSize: 13 }}>{title}</div>
      <div style={{ maxWidth: 360, lineHeight: 1.55 }}>{detail}</div>
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
        background: active ? C.surface : 'transparent',
        border: `1px solid ${active ? C.borderStrong : C.border}`,
        color: active ? C.text : C.subtext,
        fontSize: 11,
        padding: '3px 10px',
        borderRadius: 999,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
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
  // Pill-style segmented control. The active segment uses the surface color
  // (subtle elevation) rather than a colored fill, so the accent stays scarce.
  return (
    <div
      role="tablist"
      style={{
        display: 'inline-flex',
        background: 'rgba(0, 0, 0, 0.18)',
        border: `1px solid ${C.border}`,
        borderRadius: 999,
        padding: 2,
      }}
    >
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            style={{
              background: active ? C.surface : 'transparent',
              color: active ? C.text : C.subtext,
              border: 'none',
              fontSize: 11,
              padding: '2px 12px',
              borderRadius: 999,
              cursor: 'pointer',
              fontWeight: active ? 600 : 400,
              boxShadow: active ? C.shadowSm : 'none',
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
          margin: '6px 0',
          fontSize: 10,
          color: C.dimText,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          borderTop: `1px dashed ${C.border}`,
          borderBottom: `1px dashed ${C.border}`,
        }}
      >
        <span className="qt-mono" style={{ width: 36, textAlign: 'right', textTransform: 'none' }}>#{index}</span>
        <span className="qt-mono" style={{ width: 72, textTransform: 'none' }}>+{Math.round(chunk.elapsed)}ms</span>
        <span style={{ flex: 1, textAlign: 'center' }}>stream end · [DONE]</span>
      </div>
    );
  }

  // Card with subtle elevation (tinted shadow), 10px outer radius.
  // Inner pre uses 8px radius to maintain "tighter inner / softer outer" rhythm.
  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        margin: '7px 0',
        overflow: 'hidden',
        boxShadow: expanded ? C.shadowMd : C.shadowSm,
        transition: 'box-shadow 180ms cubic-bezier(0.32, 0.72, 0, 1)',
      }}
    >
      {/* Header — clickable to toggle */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '7px 10px',
          cursor: 'pointer',
          userSelect: 'none',
          background: expanded ? C.surfaceAlt : 'transparent',
          transition: 'background 150ms ease',
        }}
      >
        <span
          className="qt-mono"
          style={{
            color: C.dimText,
            fontSize: 10,
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 180ms cubic-bezier(0.32, 0.72, 0, 1)',
            display: 'inline-block',
            width: 10,
          }}
        >
          ▶
        </span>
        <span
          className="qt-mono"
          style={{
            width: 36,
            textAlign: 'right',
            color: C.dimText,
            fontSize: 11,
          }}
        >
          #{index}
        </span>
        <span
          className="qt-mono"
          style={{
            width: 70,
            color: C.subtext,
            fontSize: 11,
          }}
        >
          +{Math.round(chunk.elapsed)}ms
        </span>
        <span
          className="qt-mono"
          style={{
            width: 56,
            color: C.dimText,
            fontSize: 11,
          }}
          title="Time since previous chunk"
        >
          Δ{Math.round(chunk.deltaMs)}ms
        </span>
        <span
          className="qt-mono"
          style={{
            color: summary.color,
            fontSize: 11,
            fontWeight: 600,
            minWidth: 90,
          }}
        >
          {summary.label}
        </span>
        <span
          className="qt-mono"
          style={{
            flex: 1,
            color: summary.color,
            fontSize: 12,
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
        <div style={{ borderTop: `1px solid ${C.border}`, background: C.codeBg }}>
          <pre
            style={{
              background: 'transparent',
              color: C.text,
              padding: '14px 16px',
              margin: 0,
              fontSize: 12,
              lineHeight: 1.55,
              overflow: 'auto',
              maxHeight: 360,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              borderRadius: 0,
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

// Pretty is the most useful tab for "what did the AI actually say?" — make it
// the default both on initial mount and whenever the user switches traces.
const DEFAULT_TAB: TabId = 'response';

function DetailPanel({ trace }: DetailPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>(DEFAULT_TAB);

  // Reset to the default tab when the selected trace changes
  useEffect(() => {
    setActiveTab(DEFAULT_TAB);
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
          padding: 32,
          userSelect: 'none',
        }}
      >
        <div style={{ maxWidth: 360, textAlign: 'center' }}>
          <div
            aria-hidden
            style={{
              width: 56,
              height: 56,
              margin: '0 auto 18px',
              borderRadius: 14,
              background: C.surface,
              border: `1px solid ${C.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: C.subtext,
              fontSize: 22,
              boxShadow: C.shadowSm,
            }}
          >
            ⌘
          </div>
          <div style={{ color: C.text, fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
            No request selected
          </div>
          <div style={{ color: C.dimText, fontSize: 12, lineHeight: 1.6 }}>
            Pick a captured request from the list on the left to inspect headers, payload,
            and the live SSE stream. New requests appear automatically while Qwen Code is running.
          </div>
        </div>
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
      {/* Tab bar — uses semantic <nav role="tablist"> for screen readers.
          Active tab indicated by accent underline (the only place accent appears
          in the chrome). All other state is communicated by weight + color shift. */}
      <nav
        role="tablist"
        aria-label="Trace detail sections"
        style={{
          display: 'flex',
          background: C.tabBar,
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
          padding: '0 4px',
        }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              style={{
                position: 'relative',
                padding: '11px 14px 10px',
                fontSize: 12,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? C.text : C.tabInactiveText,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {tab.label}
              {/* Active underline as a separate element so :active scale doesn't move it */}
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  left: 8,
                  right: 8,
                  bottom: -1,
                  height: 2,
                  background: isActive ? C.accent : 'transparent',
                  borderRadius: 1,
                  transition: 'background 150ms ease',
                }}
              />
            </button>
          );
        })}
      </nav>

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
