import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { TraceEntry } from '../../types';
import { getAgentRoleMeta } from '../utils/agentRole';

// ── Color palette (CSS variable references) ─────────────────────

const colors = {
  bg: 'var(--qt-bg)',
  selectedBg: 'var(--qt-bg-selected)',
  selectedAccent: 'var(--qt-accent)',
  hoverBg: 'var(--qt-bg-hover)',
  text: 'var(--qt-text)',
  subtext: 'var(--qt-text-sub)',
  muted: 'var(--qt-text-muted)',
  border: 'var(--qt-border)',
  statusGreen: 'var(--qt-status-green)',
  statusRed: 'var(--qt-status-red)',
  statusGray: 'var(--qt-text-muted)',
  dotBlue: 'var(--qt-dot-blue)',
  dotGreen: 'var(--qt-dot-green)',
  dotRed: 'var(--qt-dot-red)',
  dotGray: 'var(--qt-dot-gray)',
} as const;

// ── Helpers ─────────────────────────────────────────────────────

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

const DOT_WIDTH = 7;
const DOT_GAP = 8;
const IDX_WIDTH = 22;
const SECOND_LINE_INDENT = DOT_WIDTH + DOT_GAP + IDX_WIDTH + DOT_GAP;

const SidebarRow: React.FC<RowProps> = ({ index, trace, isSelected, onSelect }) => {
  const [hovered, setHovered] = useState(false);

  const role = getAgentRoleMeta(trace);

  const model = trace.requestBody?.model ?? '\u2014';

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
      aria-selected={isSelected}
      onClick={() => onSelect(trace.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(trace.id);
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '12px 14px 12px 16px',
        cursor: 'pointer',
        backgroundColor: bg,
        boxShadow: isSelected ? 'inset 0 0 0 1px rgba(137, 180, 250, 0.06)' : 'none',
        borderBottom: `1px solid ${colors.border}`,
        transition: 'background-color 150ms cubic-bezier(0.32, 0.72, 0, 1)',
        userSelect: 'none',
      }}
    >
      {/* Selection accent stripe */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: isSelected ? colors.selectedAccent : 'transparent',
          transition: 'background 150ms ease',
        }}
      />

      {/* ── Row 1: state dot + index + role label … duration ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: DOT_GAP }}>
        {/* State dot */}
        <span
          style={{
            width: DOT_WIDTH,
            height: DOT_WIDTH,
            minWidth: DOT_WIDTH,
            borderRadius: '50%',
            backgroundColor: stateDotColor(trace.state),
            flexShrink: 0,
            boxShadow:
              trace.state === 'streaming'
                ? `0 0 6px ${stateDotColor(trace.state)}`
                : 'none',
            ...(trace.state === 'streaming'
              ? { animation: 'qwtrace-pulse 1.4s ease-in-out infinite' }
              : {}),
          }}
        />

        {/* Index */}
        <span
          className="qt-mono"
          style={{
            color: colors.muted,
            fontSize: 10,
            width: IDX_WIDTH,
            flexShrink: 0,
            textAlign: 'right',
          }}
        >
          {String(index).padStart(2, '0')}
        </span>

        {/* Agent role label */}
        <span
          title={`${role.label} — ${role.description}`}
          className="qt-mono"
          style={{
            color: role.color,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.02em',
            flexShrink: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {role.shortLabel}
        </span>

        {/* Spacer */}
        <span style={{ flex: 1 }} />

        {/* Duration — pushed to the right */}
        <span
          className="qt-mono"
          style={{
            color: colors.muted,
            fontSize: 10,
            minWidth: 44,
            flexShrink: 0,
            textAlign: 'right',
          }}
        >
          {durationLabel}
        </span>
      </div>

      {/* ── Row 2: model name … status code + tokens ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          paddingLeft: SECOND_LINE_INDENT,
        }}
      >
        {/* Model name — given ample space on its own line */}
        <span
          className="qt-mono"
          style={{
            flex: 1,
            color: isSelected ? colors.subtext : colors.muted,
            fontSize: 11,
            fontWeight: isSelected ? 500 : 400,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
        >
          {model}
        </span>

        {/* Status code */}
        <span
          className="qt-mono"
          style={{
            color: statusColor(trace.status),
            fontSize: 11,
            fontWeight: 600,
            minWidth: 28,
            textAlign: 'right',
            flexShrink: 0,
          }}
        >
          {trace.status || '\u2013'}
        </span>

        {/* Tokens */}
        <span
          className="qt-mono"
          style={{
            color: totalTokens ? colors.subtext : colors.muted,
            fontSize: 10,
            minWidth: 38,
            textAlign: 'right',
            flexShrink: 0,
            opacity: totalTokens ? 1 : 0.4,
          }}
        >
          {totalTokens ? formatTokens(totalTokens) : '\u2013'}
        </span>
      </div>
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
      {/* Header — eyebrow caps + tabular count, matches the rest of the chrome */}
      <div
        style={{
          padding: '16px 16px 12px',
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.14em',
            color: colors.subtext,
          }}
        >
          Requests
        </span>
        <span
          className="qt-mono"
          style={{ fontSize: 10, color: colors.muted }}
        >
          {String(traces.length).padStart(3, '0')}
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
              padding: '40px 24px',
              textAlign: 'center',
              color: colors.muted,
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            {/* Skeleton bars */}
            <div
              aria-hidden
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                alignItems: 'center',
                marginBottom: 18,
              }}
            >
              <div
                className="qt-skeleton"
                style={{
                  width: '60%',
                  height: 8,
                  borderRadius: 4,
                  background: colors.border,
                }}
              />
              <div
                className="qt-skeleton"
                style={{
                  width: '80%',
                  height: 8,
                  borderRadius: 4,
                  background: colors.border,
                }}
              />
              <div
                className="qt-skeleton"
                style={{
                  width: '45%',
                  height: 8,
                  borderRadius: 4,
                  background: colors.border,
                }}
              />
            </div>
            <div style={{ color: colors.subtext, fontSize: 12, marginBottom: 4 }}>
              Waiting for traffic
            </div>
            <div style={{ fontSize: 11 }}>
              Run Qwen Code with the trace hook enabled — captured requests will appear here in real time.
            </div>
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
