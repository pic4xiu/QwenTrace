import { useState, useEffect, useCallback, useRef } from 'react';
import type { TraceEntry, WSMessage, ParsedSSEChunk, AssembledResponse } from '../../types';

const WS_URL =
  typeof window !== 'undefined' && window.location.port === '5173'
    ? 'ws://localhost:7890/ws'      // Vite dev — connect to the real server
    : `ws://${window.location.host}/ws`;  // Production

export function useTraces() {
  const [traces, setTraces] = useState<TraceEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      // Auto-reconnect after 2s
      reconnectTimer.current = setTimeout(connect, 2000);
    };
    ws.onerror = () => ws.close();

    ws.onmessage = (evt) => {
      try {
        const msg: WSMessage = JSON.parse(evt.data);
        switch (msg.type) {
          case 'trace-list':
            setTraces(msg.traces);
            break;

          case 'trace-update':
            setTraces((prev) => {
              const idx = prev.findIndex((t) => t.id === msg.trace.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = msg.trace;
                return next;
              }
              return [...prev, msg.trace];
            });
            break;

          case 'trace-chunk':
            setTraces((prev) => {
              const idx = prev.findIndex((t) => t.id === msg.traceId);
              if (idx < 0) return prev;
              const next = [...prev];
              const trace = { ...next[idx] };
              trace.chunks = [...trace.chunks, msg.chunk];
              trace.assembled = msg.assembled;
              trace.state = msg.state;
              trace.duration = msg.duration;
              next[idx] = trace;
              return next;
            });
            break;
        }
      } catch { /* ignore parse errors */ }
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const clearTraces = useCallback(async () => {
    await fetch('/api/traces', { method: 'DELETE' });
    setTraces([]);
  }, []);

  return { traces, connected, clearTraces };
}
