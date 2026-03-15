/**
 * Invisible component that syncs the user's stored timezone to the
 * module-level default used by date formatting utilities.
 *
 * Place once inside the authenticated layout tree (after useSettings
 * can fire). No UI — just a side effect.
 *
 * @see Issue #2517 — Epic #2509
 */
import { useEffect } from 'react';
import { useSettings } from '@/ui/components/settings/use-settings';
import { setDefaultTimezone } from '@/ui/lib/date-format';

export function TimezoneSync(): null {
  const { state } = useSettings();

  useEffect(() => {
    if (state.kind === 'loaded' && state.data.timezone) {
      setDefaultTimezone(state.data.timezone);
    }
  }, [state]);

  return null;
}
