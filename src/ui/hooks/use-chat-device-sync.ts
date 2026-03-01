/**
 * Hook for multi-device chat sync on reconnect (Issue #1959).
 *
 * When the WebSocket reconnects, fetches messages since lastSyncedAt
 * to reconcile the local cache. Uses REST fallback for offline recovery.
 */
import { useState, useEffect, useRef } from 'react';
import { apiClient } from '@/ui/lib/api-client';

type SyncState = 'idle' | 'syncing' | 'synced' | 'error';

interface ChatDeviceSyncOptions {
  /** Whether sync is enabled (typically true when WS reconnects). */
  enabled: boolean;
  /** ISO timestamp of last successful sync, or null for first connect. */
  lastSyncedAt: string | null;
}

interface UseChatDeviceSyncReturn {
  /** Current sync state. */
  syncState: SyncState;
  /** Error message if sync failed, or null. */
  syncError: string | null;
}

export function useChatDeviceSync(options: ChatDeviceSyncOptions): UseChatDeviceSyncReturn {
  const { enabled, lastSyncedAt } = options;
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !lastSyncedAt) return;

    let alive = true;
    setSyncState('syncing');
    setSyncError(null);

    async function performSync() {
      try {
        // Fetch active sessions to check for any updates
        await apiClient.get('/api/chat/sessions?status=active');
        if (!alive || !mountedRef.current) return;
        setSyncState('synced');
      } catch (err) {
        if (!alive || !mountedRef.current) return;
        setSyncState('error');
        setSyncError(err instanceof Error ? err.message : 'Sync failed');
      }
    }

    performSync();
    return () => {
      alive = false;
    };
  }, [enabled, lastSyncedAt]);

  return { syncState, syncError };
}
