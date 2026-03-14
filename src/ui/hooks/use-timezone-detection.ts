/**
 * Hook to detect browser timezone and compare with stored timezone.
 *
 * Uses Intl.DateTimeFormat to detect and canonicalize the browser timezone,
 * then compares with the user's stored timezone from settings.
 *
 * @see Issue #2512 — Epic #2509
 */
import { useMemo } from 'react';
import { useSettings, type SettingsState } from '@/ui/components/settings/use-settings';

export interface TimezoneDetectionResult {
  /** Canonical browser timezone, or null if detection failed. */
  browserTimezone: string | null;
  /** Stored timezone from settings, or null if not yet loaded. */
  storedTimezone: string | null;
  /** True only when both timezones are known, valid, and differ. */
  mismatch: boolean;
  /** True while settings are being fetched. */
  isLoading: boolean;
  /** Non-null if settings fetch failed. */
  error: Error | null;
}

/** Detect and canonicalize the browser timezone via Intl APIs. */
function detectBrowserTimezone(): string | null {
  try {
    const raw = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!raw) return null;
    // Canonicalize via round-trip through DateTimeFormat constructor
    const canonical = Intl.DateTimeFormat(undefined, { timeZone: raw }).resolvedOptions().timeZone;
    return canonical || null;
  } catch {
    return null;
  }
}

export function useTimezoneDetection(): TimezoneDetectionResult {
  const { state } = useSettings();

  return useMemo(() => {
    if (state.kind === 'loading') {
      return {
        browserTimezone: null,
        storedTimezone: null,
        mismatch: false,
        isLoading: true,
        error: null,
      };
    }

    if (state.kind === 'error') {
      return {
        browserTimezone: null,
        storedTimezone: null,
        mismatch: false,
        isLoading: false,
        error: new Error(state.message),
      };
    }

    const browserTimezone = detectBrowserTimezone();
    const storedTimezone = state.data.timezone ?? null;

    const mismatch =
      browserTimezone !== null &&
      storedTimezone !== null &&
      browserTimezone !== storedTimezone;

    return {
      browserTimezone,
      storedTimezone,
      mismatch,
      isLoading: false,
      error: null,
    };
  }, [state]);
}
