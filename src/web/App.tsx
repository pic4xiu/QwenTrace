import { useState } from 'react';
import { useTraces } from './hooks/useTraces';
import Sidebar from './components/Sidebar';
import DetailPanel from './components/DetailPanel';

export default function App() {
  const { traces, connected, clearTraces } = useTraces();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedTrace = selectedId
    ? traces.find((t) => t.id === selectedId) ?? null
    : null;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: '#1e1e2e',
      color: '#cdd6f4',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
      fontSize: 13,
    }}>
      {/* ---- Header ---- */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        height: 40,
        minHeight: 40,
        background: '#181825',
        borderBottom: '1px solid #313244',
        userSelect: 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.5 }}>
            <span style={{ color: '#89b4fa' }}>Qwen</span>
            <span style={{ color: '#cdd6f4' }}>Trace</span>
          </span>
          <span style={{
            fontSize: 10,
            color: '#6c7086',
            border: '1px solid #313244',
            borderRadius: 4,
            padding: '1px 6px',
          }}>
            v0.1.0
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Connection indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: connected ? '#a6e3a1' : '#f38ba8',
              boxShadow: connected ? '0 0 6px #a6e3a1' : 'none',
            }} />
            <span style={{ fontSize: 11, color: '#6c7086' }}>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>

          {/* Request count */}
          <span style={{ fontSize: 11, color: '#6c7086' }}>
            {traces.length} request{traces.length !== 1 ? 's' : ''}
          </span>

          {/* Clear button */}
          <button
            onClick={clearTraces}
            style={{
              background: 'transparent',
              border: '1px solid #313244',
              color: '#6c7086',
              fontSize: 11,
              padding: '2px 10px',
              borderRadius: 4,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#f38ba8';
              e.currentTarget.style.color = '#f38ba8';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#313244';
              e.currentTarget.style.color = '#6c7086';
            }}
          >
            Clear
          </button>
        </div>
      </header>

      {/* ---- Body ---- */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <div style={{
          width: 320,
          minWidth: 280,
          borderRight: '1px solid #313244',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <Sidebar
            traces={traces}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>

        {/* Detail panel */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <DetailPanel trace={selectedTrace} />
        </div>
      </div>
    </div>
  );
}
