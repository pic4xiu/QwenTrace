import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { TraceEntry } from '../../types';
import { getAgentRoleMeta } from '../utils/agentRole';

// ── Color palette (dark theme) ──────────────────────────────────

const colors = {
  bg: '#1e1e2e',
  selectedBg: '#2a2a3c',
  selectedAccent: '#89b4fa',
  hoverBg: 'rgba(205, 214, 244, 0.04)',
  text: '#cdd6f4',
  subtext: '#a6adc8',
  muted: '#6c7086',
  border: '#2a2a3c',
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

/**
 * Compose a hex color with an alpha channel suffix.
 * The role chip uses ~12% fill and ~25% border tint to stay quiet against
 * the dark background while still reading as "this row is X kind of call".
 */
function hexWithAlpha(hex: string, alpha: number): string {
  // Clamp to [0, 1] then map to a two-digit hex byte.
  const a = Math.max(0, Math.min(1, alpha));
  const byte = Math.round(a * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${byte}`;
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

  // Detect *which* Qwen Code agent is responsible for this call. The role
  // is far more informative than the model name in a dense list, so we
  // surface it as a colored chip immediately after the index.
  const role = getAgentRoleMeta(trace);

  const model = trace.requestBody?.model
    ? truncate(trace.requestBody.model, 18)
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
        alignItems: 'center',
        gap: 8,
        padding: '9px 12px 9px 14px',
        cursor: 'pointer',
        backgroundColor: bg,
        borderBottom: `1px solid ${colors.border}`,
        transition: 'background-color 120ms ease',
        userSelect: 'none',
      }}
    >
      {/* Selection accent stripe — the only place accent appears in the sidebar.
          Sits flush to the left edge so the eye locks onto the active row. */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 2,
          background: isSelected ? colors.selectedAccent : 'transparent',
          transition: 'background 150ms ease',
        }}
      />

      {/* State dot */}
      <span
        style={{
          width: 7,
          height: 7,
          minWidth: 7,
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
          minWidth: 24,
          flexShrink: 0,
        }}
      >
        {String(index).padStart(2, '0')}
      </span>

      {/* Agent role chip — colored dot + short label. Tooltip carries the
          full description so the chrome stays calm while still being
          discoverable. The chip uses a tinted-fill bg matching the role
          color at very low alpha — same hue as the sidebar accent system. */}
      <span
        title={`${role.label} — ${role.description}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 6px 2px 5px',
          borderRadius: 4,
          background: hexWithAlpha(role.color, 0.12),
          border: `1px solid ${hexWithAlpha(role.color, 0.25)}`,
          color: role.color,
          fontSize: 10,
          lineHeight: 1.2,
          fontWeight: 600,
          letterSpacing: '0.02em',
          flexShrink: 0,
          maxWidth: 124,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        <span aria-hidden style={{ fontSize: 9, opacity: 0.9 }}>
          {role.symbol}
        </span>
        {role.shortLabel}
      </span>

      {/* Model name — secondary, muted further now that the role chip carries
          the primary identity signal. */}
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

      {/* Duration */}
      <span
        className="qt-mono"
        style={{
          color: colors.muted,
          fontSize: 10,
          minWidth: 44,
          textAlign: 'right',
          flexShrink: 0,
        }}
      >
        {durationLabel}
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
          padding: '14px 14px 10px',
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
            <div
              aria-hidden
              style={{
                width: 36,
                height: 36,
                margin: '0 auto 14px',
                borderRadius: 10,
                border: `1px dashed ${colors.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: colors.muted,
                fontSize: 16,
              }}
            >
              ◌
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
