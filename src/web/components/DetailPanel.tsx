import React, { useState, useEffect, useRef } from 'react';
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

  return (
    <div>
      <SectionTitle>Request Headers</SectionTitle>
      <HeaderTable headers={trace.requestHeaders ?? {}} />

      <SectionTitle>
        Request Body
        {messagesCount > 0 && <Badge>{messagesCount} message{messagesCount !== 1 ? 's' : ''}</Badge>}
        {toolsCount > 0 && <Badge>{toolsCount} tool{toolsCount !== 1 ? 's' : ''}</Badge>}
      </SectionTitle>
      {body ? (
        <CodeBlock>{JSON.stringify(body, null, 2)}</CodeBlock>
      ) : trace.rawRequestBody ? (
        <CodeBlock>{tryFormatJson(trace.rawRequestBody)}</CodeBlock>
      ) : (
        <div style={{ color: C.dimText, fontSize: 13, padding: '8px 0' }}>No request body</div>
      )}
    </div>
  );
}

function ResponseTab({ trace }: { trace: TraceEntry }) {
  const assembled = trace.assembled;

  if (assembled) {
    return (
      <div>
        <SectionTitle>Response Text</SectionTitle>
        {assembled.fullText ? (
          <CodeBlock>{assembled.fullText}</CodeBlock>
        ) : (
          <div style={{ color: C.dimText, fontSize: 13, padding: '8px 0' }}>No text content</div>
        )}

        {assembled.thinkingText ? (
          <>
            <SectionTitle>Thinking</SectionTitle>
            <CodeBlock>{assembled.thinkingText}</CodeBlock>
          </>
        ) : null}

        {assembled.toolCalls.length > 0 && (
          <>
            <SectionTitle>Tool Calls ({assembled.toolCalls.length})</SectionTitle>
            <CodeBlock>{JSON.stringify(assembled.toolCalls, null, 2)}</CodeBlock>
          </>
        )}
      </div>
    );
  }

  if (trace.responseBody) {
    return (
      <div>
        <SectionTitle>Response Body</SectionTitle>
        <CodeBlock>{tryFormatJson(trace.responseBody)}</CodeBlock>
      </div>
    );
  }

  return (
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
  );
}

function SSEStreamTab({ trace }: { trace: TraceEntry }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isStreaming = trace.state === 'streaming';
  const chunks = trace.chunks ?? [];

  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chunks.length, isStreaming]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          padding: '8px 0',
          fontSize: 12,
          color: C.subtext,
          borderBottom: `1px solid ${C.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 600, color: C.text }}>{chunks.length}</span> chunk{chunks.length !== 1 ? 's' : ''}
        {isStreaming && (
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: C.accent,
              animation: 'pulse 1.2s ease-in-out infinite',
              marginLeft: 4,
            }}
          />
        )}
      </div>

      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          minHeight: 0,
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
        ) : (
          chunks.map((chunk, i) => <ChunkRow key={i} chunk={chunk} index={i} />)
        )}
      </div>
    </div>
  );
}

function ChunkRow({ chunk, index }: { chunk: ParsedSSEChunk; index: number }) {
  const p = chunk.parsed;
  const deltaContent = p?.delta?.content;
  const deltaToolCalls = p?.delta?.tool_calls;
  const finishReason = p?.finish_reason;
  const usage = p?.usage;

  let contentNode: React.ReactNode = null;

  if (deltaContent) {
    contentNode = (
      <span
        style={{
          fontFamily: 'monospace',
          fontSize: 12,
          color: C.text,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {deltaContent}
      </span>
    );
  } else if (deltaToolCalls && deltaToolCalls.length > 0) {
    const tc = deltaToolCalls[0];
    const parts: string[] = [];
    if (tc.function?.name) parts.push(`fn: ${tc.function.name}`);
    if (tc.function?.arguments) parts.push(tc.function.arguments);
    contentNode = (
      <span style={{ fontFamily: 'monospace', fontSize: 12, color: C.warningText }}>
        tool_call[{tc.index}] {parts.join(' ')}
      </span>
    );
  } else if (finishReason) {
    contentNode = (
      <span style={{ fontSize: 12, color: C.successText, fontWeight: 600 }}>
        finish_reason: {finishReason}
      </span>
    );
  } else if (usage) {
    contentNode = (
      <span style={{ fontSize: 12, color: C.subtext }}>
        usage: {usage.total_tokens ?? '--'} tokens
      </span>
    );
  } else if (p?.delta?.role) {
    contentNode = (
      <span style={{ fontSize: 12, color: C.subtext }}>
        role: {p.delta.role}
      </span>
    );
  } else {
    contentNode = (
      <span style={{ fontSize: 12, color: C.dimText }}>
        (empty delta)
      </span>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '4px 0',
        borderBottom: `1px solid ${C.border}`,
        minHeight: 24,
      }}
    >
      <span
        style={{
          width: 36,
          minWidth: 36,
          textAlign: 'right',
          color: C.dimText,
          fontSize: 11,
          fontFamily: 'monospace',
          lineHeight: '20px',
        }}
      >
        {index}
      </span>
      <span
        style={{
          width: 72,
          minWidth: 72,
          color: C.accent,
          fontSize: 12,
          fontFamily: 'monospace',
          lineHeight: '20px',
        }}
      >
        +{Math.round(chunk.elapsed)}ms
      </span>
      <span style={{ flex: 1, lineHeight: '20px' }}>{contentNode}</span>
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
