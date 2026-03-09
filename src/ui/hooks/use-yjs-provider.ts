/**
 * Hook for managing Yjs Doc + WebsocketProvider lifecycle.
 * Creates provider on mount, destroys on unmount or noteId change.
 * Part of Issue #2256
 */

import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { getAccessToken } from '@/ui/lib/auth-manager';
import { getWsBaseUrl } from '@/ui/lib/api-config';

/** Connection status derived from WebSocket + sync state */
export type YjsConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'synced'
  | 'disconnected';

export interface UseYjsProviderResult {
  /** The Yjs document, or null if noteId is null */
  doc: Y.Doc | null;
  /** The WebSocket provider, or null if noteId is null */
  provider: WebsocketProvider | null;
  /** Connection/sync status */
  status: YjsConnectionStatus;
  /** Whether Yjs collaborative editing is active */
  yjsEnabled: boolean;
}

/**
 * Manage a Yjs Doc + WebsocketProvider for a given noteId.
 * - Returns null doc/provider when noteId is null.
 * - Creates fresh instances when noteId changes.
 * - Destroys both on unmount or noteId change.
 */
export function useYjsProvider(noteId: string | null): UseYjsProviderResult {
  const [state, setState] = useState<{
    doc: Y.Doc | null;
    provider: WebsocketProvider | null;
    status: YjsConnectionStatus;
  }>({
    doc: null,
    provider: null,
    status: 'disconnected',
  });

  useEffect(() => {
    if (!noteId) {
      setState({ doc: null, provider: null, status: 'disconnected' });
      return;
    }

    const doc = new Y.Doc();
    const token = getAccessToken();

    // Build WebSocket URL targeting the API host (api.DOMAIN in production).
    // y-websocket WebsocketProvider connects to `${serverUrl}/${roomname}`,
    // so with serverUrl=wss://api.example.com/yjs and roomname=noteId,
    // it connects to wss://api.example.com/yjs/{noteId}.
    const wsBase = getWsBaseUrl();
    const wsUrl = wsBase ? `${wsBase}/yjs` : '/yjs';

    const provider = new WebsocketProvider(wsUrl, noteId, doc, {
      connect: true,
      params: { token: token ?? '' },
    });

    provider.on('status', ({ status: wsStatus }: { status: string }) => {
      setState((prev) => ({
        ...prev,
        status: wsStatus === 'connected' ? 'connected' : 'disconnected',
      }));
    });

    provider.on('sync', (isSynced: boolean) => {
      if (isSynced) {
        setState((prev) => ({ ...prev, status: 'synced' }));
      }
    });

    setState({ doc, provider, status: 'connecting' });

    return () => {
      provider.destroy();
      doc.destroy();
    };
  }, [noteId]);

  return {
    doc: state.doc,
    provider: state.provider,
    status: state.status,
    yjsEnabled: state.doc !== null,
  };
}
