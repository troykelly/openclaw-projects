/**
 * Connected component that wires useTimezoneDetection, useTimezoneDismissal,
 * and useSettings into the TimezoneMismatchBanner.
 *
 * Renders nothing when there is no mismatch or the mismatch was dismissed.
 *
 * @see Issue #2512 — Epic #2509
 */
import { useCallback } from 'react';
import { toast } from 'sonner';
import { useSettings } from '@/ui/components/settings/use-settings';
import { useTimezoneDetection } from '@/ui/hooks/use-timezone-detection';
import { useTimezoneDismissal } from '@/ui/hooks/use-timezone-dismissal';
import { TimezoneMismatchBanner } from './TimezoneMismatchBanner';

/** Format IANA timezone for display in toast messages. */
function formatTimezone(tz: string): string {
  return tz.replace(/_/g, ' ').replace(/\//g, ' / ');
}

export function TimezoneBannerConnected(): React.JSX.Element | null {
  const { browserTimezone, storedTimezone, mismatch } = useTimezoneDetection();
  const { isDismissed, dismiss } = useTimezoneDismissal(browserTimezone);
  const { updateSettings } = useSettings();

  const handleUpdate = useCallback(async () => {
    if (!browserTimezone) return;
    const success = await updateSettings({ timezone: browserTimezone });
    if (!success) {
      throw new Error('Failed to update timezone');
    }
    toast.success(`Timezone updated to ${formatTimezone(browserTimezone)}`);
  }, [browserTimezone, updateSettings]);

  if (!mismatch || isDismissed || !browserTimezone || !storedTimezone) {
    return null;
  }

  return (
    <TimezoneMismatchBanner
      browserTimezone={browserTimezone}
      storedTimezone={storedTimezone}
      onUpdate={handleUpdate}
      onDismiss={dismiss}
    />
  );
}
