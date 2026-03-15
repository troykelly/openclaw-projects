/**
 * Hook that returns the user's timezone from settings.
 *
 * Provides the stored IANA timezone string (e.g. "Australia/Sydney").
 * Falls back to the browser's timezone when no stored timezone is available.
 *
 * @see Issue #2517 — Epic #2509
 */
import { useSettings } from '@/ui/components/settings/use-settings';

/**
 * Returns the user's effective timezone.
 *
 * Resolution order:
 * 1. Stored timezone from user_setting
 * 2. Browser timezone via Intl.DateTimeFormat
 * 3. undefined (lets Intl use system default)
 */
export function useTimezone(): string | undefined {
  const { state } = useSettings();

  if (state.kind === 'loaded' && state.data.timezone) {
    return state.data.timezone;
  }

  // Fallback to browser timezone
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
