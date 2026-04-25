import { useState, useEffect, useCallback } from 'react';
import { useTraces } from './hooks/useTraces';
import Sidebar from './components/Sidebar';
import DetailPanel from './components/DetailPanel';

export default function App() {
  const { traces, connected, clearTraces } = useTraces();
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
        background: '#1e1e2e',
        color: '#cdd6f4',
      }}
    >
      {/* ---- Header ---- */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 14px',
          height: 44,
          minHeight: 44,
          background: '#181825',
          borderBottom: '1px solid #2a2a3c',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span
            style={{
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              lineHeight: 1,
            }}
          >
            <span style={{ color: '#89b4fa' }}>Qwen</span>
            <span style={{ color: '#cdd6f4' }}>Trace</span>
          </span>
          <span
            className="qt-mono"
            style={{
              fontSize: 10,
              color: '#6c7086',
              letterSpacing: '0.05em',
            }}
          >
            v0.1.0
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* Connection indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: connected ? '#a6e3a1' : '#f38ba8',
                boxShadow: connected ? '0 0 6px #a6e3a1' : 'none',
              }}
            />
            <span style={{ fontSize: 11, color: '#6c7086' }}>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>

          {/* Request count */}
          <span style={{ fontSize: 11, color: '#6c7086' }}>
            <span className="qt-num" style={{ color: '#a6adc8' }}>{traces.length}</span>
            {' '}
            request{traces.length !== 1 ? 's' : ''}
          </span>

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
            width: 320,
            minWidth: 280,
            borderRight: '1px solid #2a2a3c',
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
