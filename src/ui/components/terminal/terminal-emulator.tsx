/**
 * xterm.js terminal emulator wrapper (Epic #1667, #1694).
 *
 * Manages the xterm.js terminal instance lifecycle: create, attach WebSocket,
 * handle resize, search, and cleanup.
 */
import * as React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { Terminal as XTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { useTerminalWebSocket, type TerminalWsStatus } from '@/ui/hooks/use-terminal-websocket';

interface TerminalEmulatorProps {
  sessionId: string;
  onStatusChange?: (status: TerminalWsStatus) => void;
}

export function TerminalEmulator({ sessionId, onStatusChange }: TerminalEmulatorProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);

  const handleData = useCallback((data: string) => {
    termRef.current?.write(data);
  }, []);

  const { status, send, resize, disconnect } = useTerminalWebSocket({
    sessionId,
    onData: handleData,
    onStatusChange,
    enabled: !!sessionId,
  });

  // Initialize xterm.js
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1a1b26',
        foreground: '#c0caf5',
        cursor: '#c0caf5',
        selectionBackground: '#33467c',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);

    term.open(containerRef.current);
    fitAddon.fit();

    // Send input from terminal to WebSocket
    term.onData((data) => {
      send(data);
    });

    // Handle terminal resize
    term.onResize(({ cols, rows }) => {
      resize(cols, rows);
    });

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    // Resize observer
    const observer = new ResizeObserver(() => {
      fitAddon.fit();
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      disconnect();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: only re-init on session change

  return (
    <div className="relative flex-1" data-testid="terminal-emulator">
      <div
        ref={containerRef}
        className="size-full"
        data-testid="terminal-container"
        data-status={status}
      />
    </div>
  );
}
