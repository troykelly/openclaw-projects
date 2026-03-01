/**
 * Hook for managing chat notification preferences (Issue #1958).
 *
 * Reads from GET /api/chat/preferences and updates via
 * PATCH /api/chat/preferences. Uses optimistic updates with rollback.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '@/ui/lib/api-client';

/** Notification delivery channel. */
export type ChatNotificationChannel = 'in_app' | 'push' | 'sms' | 'email';

/** Urgency levels for escalation. */
export type UrgencyLevel = 'low' | 'normal' | 'high' | 'urgent';

/** Quiet hours configuration. */
export interface QuietHours {
  start: string;
  end: string;
  timezone: string;
}

/** Per-urgency escalation channel configuration. */
export type EscalationConfig = Record<UrgencyLevel, ChatNotificationChannel[]>;

/** Chat notification preferences shape. */
export interface ChatNotificationPrefs {
  sound_enabled: boolean;
  auto_open_on_message: boolean;
  quiet_hours: QuietHours | null;
  escalation: EscalationConfig;
}

/** Partial update payload for chat notification preferences. */
export type ChatNotificationPrefsUpdate = Partial<ChatNotificationPrefs>;

/** Default preferences when API returns empty/malformed data. */
const DEFAULT_PREFS: ChatNotificationPrefs = {
  sound_enabled: true,
  auto_open_on_message: true,
  quiet_hours: null,
  escalation: {
    low: ['in_app'],
    normal: ['in_app', 'push'],
    high: ['in_app', 'push', 'email'],
    urgent: ['in_app', 'push', 'sms', 'email'],
  },
};

/** Normalize API response to ensure all fields are present. */
function normalizePrefs(raw: Record<string, unknown>): ChatNotificationPrefs {
  return {
    sound_enabled: typeof raw.sound_enabled === 'boolean' ? raw.sound_enabled : DEFAULT_PREFS.sound_enabled,
    auto_open_on_message: typeof raw.auto_open_on_message === 'boolean' ? raw.auto_open_on_message : DEFAULT_PREFS.auto_open_on_message,
    quiet_hours: raw.quiet_hours && typeof raw.quiet_hours === 'object' ? (raw.quiet_hours as QuietHours) : DEFAULT_PREFS.quiet_hours,
    escalation: raw.escalation && typeof raw.escalation === 'object' ? (raw.escalation as EscalationConfig) : DEFAULT_PREFS.escalation,
  };
}

interface UseChatNotificationPrefsReturn {
  /** Current preferences, or null if not yet loaded. */
  prefs: ChatNotificationPrefs | null;
  /** Whether the initial fetch is in progress. */
  isLoading: boolean;
  /** Error message, or null. */
  error: string | null;
  /** Whether a save is in progress. */
  isSaving: boolean;
  /** Update preferences (partial). */
  updatePrefs: (updates: ChatNotificationPrefsUpdate) => Promise<boolean>;
}

export function useChatNotificationPrefs(): UseChatNotificationPrefsReturn {
  const [prefs, setPrefs] = useState<ChatNotificationPrefs | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    let alive = true;
    mountedRef.current = true;

    async function fetch() {
      try {
        const data = await apiClient.get<Record<string, unknown>>('/api/chat/preferences');
        if (!alive) return;
        setPrefs(normalizePrefs(data));
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'Failed to load chat notification preferences');
      } finally {
        if (alive) setIsLoading(false);
      }
    }

    fetch();
    return () => {
      alive = false;
      mountedRef.current = false;
    };
  }, []);

  const updatePrefs = useCallback(
    async (updates: ChatNotificationPrefsUpdate): Promise<boolean> => {
      if (!prefs) return false;

      const previous = { ...prefs };
      setPrefs({ ...prefs, ...updates });
      setIsSaving(true);

      try {
        const data = await apiClient.patch<Record<string, unknown>>('/api/chat/preferences', updates);
        if (!mountedRef.current) return true;
        setPrefs(normalizePrefs(data));
        return true;
      } catch {
        if (!mountedRef.current) return false;
        setPrefs(previous);
        return false;
      } finally {
        if (mountedRef.current) setIsSaving(false);
      }
    },
    [prefs],
  );

  return {
    prefs,
    isLoading,
    error,
    isSaving,
    updatePrefs,
  };
}
