/**
 * Hook to manage timezone mismatch dismissals in localStorage.
 *
 * Persists which browser timezones the user has dismissed, keyed per-timezone
 * so that a new mismatch (e.g., after travel) can re-prompt.
 *
 * @see Issue #2512 — Epic #2509
 */
import { useState, useCallback, useMemo } from 'react';

const STORAGE_KEY = 'tz_mismatch_dismiss_v1';

interface DismissalData {
  dismissedBrowserTimezones: string[];
}

export interface TimezoneDismissal {
  /** True if the given browserTimezone was previously dismissed. */
  isDismissed: boolean;
  /** Dismiss the given browserTimezone (persists to localStorage). */
  dismiss: (browserTimezone: string) => void;
}

/** Read the dismissed timezones from localStorage. */
function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<DismissalData>;
    if (Array.isArray(parsed.dismissedBrowserTimezones)) {
      return parsed.dismissedBrowserTimezones.filter(
        (entry): entry is string => typeof entry === 'string',
      );
    }
    return [];
  } catch {
    return [];
  }
}

/** Write dismissed timezones to localStorage. Returns true on success. */
function writeDismissed(dismissed: string[]): boolean {
  try {
    const data: DismissalData = { dismissedBrowserTimezones: dismissed };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.warn('Failed to persist timezone dismissal to localStorage:', err);
    return false;
  }
}

export function useTimezoneDismissal(browserTimezone: string | null): TimezoneDismissal {
  // In-memory fallback state for when localStorage fails
  const [inMemoryDismissed, setInMemoryDismissed] = useState<string[]>(() => readDismissed());

  const isDismissed = useMemo(
    () => browserTimezone !== null && inMemoryDismissed.includes(browserTimezone),
    [browserTimezone, inMemoryDismissed],
  );

  const dismiss = useCallback((tz: string) => {
    setInMemoryDismissed((prev) => {
      if (prev.includes(tz)) return prev;
      const next = [...prev, tz];
      writeDismissed(next);
      return next;
    });
  }, []);

  return { isDismissed, dismiss };
}
