import React, { useState, useEffect, useCallback } from 'react';
import { useTraces } from './hooks/useTraces';
import Sidebar from './components/Sidebar';
import DetailPanel from './components/DetailPanel';

type ThemePreference = 'system' | 'light' | 'dark';

const THEME_CYCLE: ThemePreference[] = ['system', 'light', 'dark'];
const THEME_LABELS: Record<ThemePreference, string> = {
  system: 'Auto',
  light: 'Light',
  dark: 'Dark',
};

// ---- Theme SVG Icons (12x12, strokeWidth 1.5, currentColor) ----
const ThemeIconAuto = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="6" r="4.5" />
    <path d="M6 1.5v9" />
    <path d="M6 1.5A4.5 4.5 0 0 1 6 10.5" fill="currentColor" stroke="none" />
  </svg>
);

const ThemeIconLight = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="6" r="2.5" />
    <line x1="6" y1="0.5" x2="6" y2="2" />
    <line x1="6" y1="10" x2="6" y2="11.5" />
    <line x1="0.5" y1="6" x2="2" y2="6" />
    <line x1="10" y1="6" x2="11.5" y2="6" />
  </svg>
);

const ThemeIconDark = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 7.5a4.5 4.5 0 1 1-5.5-5.5A3.5 3.5 0 0 0 10 7.5z" />
  </svg>
);

const THEME_ICONS: Record<ThemePreference, React.FC> = {
  system: ThemeIconAuto,
  light: ThemeIconLight,
  dark: ThemeIconDark,
};

export default function App() {
  const { traces, connected, clearTraces } = useTraces();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Auto-select the first trace when data arrives and nothing is selected.
  useEffect(() => {
    if (traces.length > 0 && selectedId === null) {
      setSelectedId(traces[0].id);
    }
  }, [traces, selectedId]);

  // ---- Theme ----
  const [themePreference, setThemePreference] = useState<ThemePreference>('system');

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    function applyTheme() {
      let resolved: 'light' | 'dark';
      if (themePreference === 'system') {
        resolved = mediaQuery.matches ? 'dark' : 'light';
      } else {
        resolved = themePreference;
      }
      document.documentElement.dataset.theme = resolved;
    }

    applyTheme();
    mediaQuery.addEventListener('change', applyTheme);
    return () => mediaQuery.removeEventListener('change', applyTheme);
  }, [themePreference]);

  const cycleTheme = useCallback(() => {
    setThemePreference((prev) => {
      const nextIndex = (THEME_CYCLE.indexOf(prev) + 1) % THEME_CYCLE.length;
      return THEME_CYCLE[nextIndex];
    });
  }, []);

  const selectedTrace = selectedId
    ? traces.find((t) => t.id === selectedId) ?? null
    : null;

  // ---- Export / Save ----
  const exportTraces = useCallback(() => {
    if (traces.length === 0) return;
    const json = JSON.stringify(traces, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = `qwentrace-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [traces]);

  // Ctrl+S / Cmd+S keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        exportTraces();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [exportTraces]);

  const hasTraces = traces.length > 0;

  return (
    <div
      className="qt-app-shell"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: 'var(--qt-bg)',
        color: 'var(--qt-text)',
      }}
    >
      {/* ---- Header ---- */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 14px',
          height: 52,
          minHeight: 52,
          background: 'var(--qt-bg-header)',
          borderBottom: '1px solid var(--qt-border)',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span
            style={{
              fontSize: 17,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              lineHeight: 1,
            }}
          >
            <span style={{ color: 'var(--qt-accent)' }}>Qwen</span>
            <span style={{ color: 'var(--qt-text)' }}>Trace</span>
          </span>
          <span
            aria-hidden
            style={{
              width: 1,
              height: 14,
              background: 'var(--qt-border)',
              flexShrink: 0,
            }}
          />
          <span
            className="qt-mono"
            style={{
              fontSize: 10,
              color: 'var(--qt-text-muted)',
              letterSpacing: '0.05em',
            }}
          >
            v0.1.0
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Connection indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: connected ? 'var(--qt-status-green)' : 'var(--qt-status-red)',
                boxShadow: connected ? '0 0 6px var(--qt-status-green)' : 'none',
              }}
            />
            <span style={{ fontSize: 11, color: 'var(--qt-text-muted)' }}>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>

          {/* Request count */}
          <span style={{ fontSize: 11, color: 'var(--qt-text-muted)' }}>
            <span className="qt-num" style={{ color: 'var(--qt-text-sub)' }}>{traces.length}</span>
            {' '}
            request{traces.length !== 1 ? 's' : ''}
          </span>

          {/* Theme toggle */}
          <button
            className="qt-header-btn"
            onClick={cycleTheme}
            title={`Theme: ${themePreference} — click to cycle`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            {React.createElement(THEME_ICONS[themePreference])}
            {THEME_LABELS[themePreference]}
          </button>

          {/* Save button */}
          <button
            className="qt-header-btn"
            onClick={exportTraces}
            disabled={!hasTraces}
            title="Export traces (⌘S)"
          >
            Save
          </button>

          {/* Clear button */}
          <button
            className="qt-header-btn qt-header-btn--danger"
            onClick={clearTraces}
            disabled={!hasTraces}
          >
            Clear
          </button>
        </div>
      </header>

      {/* ---- Body ---- */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <aside
          aria-label="Captured requests"
          style={{
            width: 360,
            minWidth: 280,
            borderRight: '1px solid var(--qt-border)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Sidebar
            traces={traces}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </aside>

        {/* Detail panel */}
        <main aria-label="Request detail" style={{ flex: 1, overflow: 'hidden' }}>
          <DetailPanel trace={selectedTrace} />
        </main>
      </div>
    </div>
  );
}
