import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { TraceEntry } from '../../types';

// ── Color palette (dark theme) ──────────────────────────────────

const colors = {
  bg: '#1e1e2e',
  selectedBg: '#313244',
  hoverBg: '#282838',
  text: '#cdd6f4',
  muted: '#6c7086',
  border: '#313244',
  statusGreen: '#a6e3a1',
  statusRed: '#f38ba8',
  statusGray: '#6c7086',
  dotBlue: '#89b4fa',
  dotGreen: '#a6e3a1',
  dotRed: '#f38ba8',
  dotGray: '#6c7086',
} as const;

// ── Helpers ─────────────────────────────────────────────────────

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) + '\u2026' : value;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return String(count);
}

function statusColor(status: number): string {
  if (status >= 200 && status < 300) return colors.statusGreen;
  if (status >= 400) return colors.statusRed;
  return colors.statusGray; // 0 or any other pending value
}

function stateDotColor(state: TraceEntry['state']): string {
  switch (state) {
    case 'streaming':
      return colors.dotBlue;
    case 'complete':
      return colors.dotGreen;
    case 'error':
      return colors.dotRed;
    default:
      return colors.dotGray;
  }
}

// ── Props ───────────────────────────────────────────────────────

interface SidebarProps {
  traces: TraceEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

// ── Row component ───────────────────────────────────────────────

interface RowProps {
  index: number;
  trace: TraceEntry;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

const SidebarRow: React.FC<RowProps> = ({ index, trace, isSelected, onSelect }) => {
  const [hovered, setHovered] = useState(false);

  const model = trace.requestBody?.model
    ? truncate(trace.requestBody.model, 20)
    : '\u2014';

  const totalTokens = trace.assembled?.usage?.totalTokens;

  const isPending = trace.state === 'pending' || trace.state === 'streaming';
  const durationLabel =
    isPending && trace.duration === 0 ? '...' : formatDuration(trace.duration);

  let bg = 'transparent';
  if (isSelected) bg = colors.selectedBg;
  else if (hovered) bg = colors.hoverBg;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(trace.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect(trace.id);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        cursor: 'pointer',
        backgroundColor: bg,
        borderBottom: `1px solid ${colors.border}`,
        transition: 'background-color 0.1s ease',
        userSelect: 'none',
        outline: 'none',
      }}
    >
      {/* State dot */}
      <span
        style={{
          width: 8,
          height: 8,
          minWidth: 8,
          borderRadius: '50%',
          backgroundColor: stateDotColor(trace.state),
          flexShrink: 0,
          ...(trace.state === 'streaming'
            ? { animation: 'qwtrace-pulse 1.4s ease-in-out infinite' }
            : {}),
        }}
      />

      {/* Index */}
      <span
        style={{
          color: colors.muted,
          fontSize: 11,
          fontFamily: 'monospace',
          minWidth: 28,
          flexShrink: 0,
        }}
      >
        #{index}
      </span>

      {/* Model name */}
      <span
        style={{
          flex: 1,
          color: colors.text,
          fontSize: 13,
          fontFamily:
            "'SF Mono', 'Cascadia Code', 'Fira Code', Menlo, monospace",
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {model}
      </span>

      {/* Status code */}
      <span
        style={{
          color: statusColor(trace.status),
          fontSize: 12,
          fontFamily: 'monospace',
          fontWeight: 600,
          minWidth: 28,
          textAlign: 'right',
          flexShrink: 0,
        }}
      >
        {trace.status || '\u2013'}
      </span>

      {/* Duration */}
      <span
        style={{
          color: colors.muted,
          fontSize: 11,
          fontFamily: 'monospace',
          minWidth: 42,
          textAlign: 'right',
          flexShrink: 0,
        }}
      >
        {durationLabel}
      </span>

      {/* Tokens */}
      <span
        style={{
          color: totalTokens ? colors.text : colors.muted,
          fontSize: 11,
          fontFamily: 'monospace',
          minWidth: 38,
          textAlign: 'right',
          flexShrink: 0,
          opacity: totalTokens ? 1 : 0.4,
        }}
      >
        {totalTokens ? formatTokens(totalTokens) : '\u2013'}
      </span>
    </div>
  );
};

// ── Sidebar component ───────────────────────────────────────────

const Sidebar: React.FC<SidebarProps> = ({ traces, selectedId, onSelect }) => {
  const listRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevTraceCountRef = useRef(traces.length);

  // Track whether the user is scrolled to the bottom.
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    // Consider "at bottom" if within 30px of the end.
    isAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  }, []);

  // Auto-scroll when new traces arrive, but only if the user was already
  // at the bottom of the list.
  useEffect(() => {
    if (traces.length > prevTraceCountRef.current && isAtBottomRef.current) {
      const el = listRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
    prevTraceCountRef.current = traces.length;
  }, [traces.length]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: colors.bg,
        color: colors.text,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 12px 8px',
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: 0.3 }}>
          Requests
        </span>
        <span style={{ fontSize: 11, color: colors.muted }}>
          {traces.length}
        </span>
      </div>

      {/* List */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {traces.length === 0 && (
          <div
            style={{
              padding: 24,
              textAlign: 'center',
              color: colors.muted,
              fontSize: 13,
            }}
          >
            No requests captured yet.
          </div>
        )}

        {traces.map((trace, i) => (
          <SidebarRow
            key={trace.id}
            index={i + 1}
            trace={trace}
            isSelected={trace.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>

      {/* Pulse animation for the streaming dot */}
      <style>{`
        @keyframes qwtrace-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
};

export default Sidebar;
