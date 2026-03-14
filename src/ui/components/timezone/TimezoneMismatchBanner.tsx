/**
 * Banner component that prompts the user when their browser timezone
 * differs from their stored account timezone.
 *
 * Accessibility: role="status", aria-live="polite", no auto-focus,
 * no focus trap. Escape dismisses only when focus is inside banner.
 *
 * @see Issue #2512 — UX spec #2510 — Epic #2509
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';

export interface TimezoneMismatchBannerProps {
  /** Validated canonical IANA string for the browser timezone. */
  browserTimezone: string;
  /** Validated canonical IANA string for the stored account timezone. */
  storedTimezone: string;
  /** Calls PATCH /settings; banner handles loading/error states. */
  onUpdate: () => Promise<void>;
  /** Records dismissal for the given browser timezone. */
  onDismiss: (browserTimezone: string) => void;
}

/** Format IANA timezone for display: underscores to spaces, slashes spaced. */
function formatTimezone(tz: string): string {
  return tz.replace(/_/g, ' ').replace(/\//g, ' / ');
}

export function TimezoneMismatchBanner({
  browserTimezone,
  storedTimezone,
  onUpdate,
  onDismiss,
}: TimezoneMismatchBannerProps): React.JSX.Element | null {
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  const displayBrowser = formatTimezone(browserTimezone);
  const displayStored = formatTimezone(storedTimezone);

  const handleUpdate = useCallback(async () => {
    setIsUpdating(true);
    setError(null);
    try {
      await onUpdate();
      setHidden(true);
    } catch {
      setError('Failed to update timezone. Try again or update in ');
    } finally {
      setIsUpdating(false);
    }
  }, [onUpdate]);

  const handleDismiss = useCallback(() => {
    onDismiss(browserTimezone);
    setHidden(true);
  }, [browserTimezone, onDismiss]);

  // Escape key dismisses only when focus is inside the banner
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && bannerRef.current?.contains(document.activeElement)) {
        handleDismiss();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleDismiss]);

  if (hidden) return null;

  return (
    <div
      ref={bannerRef}
      role="status"
      aria-live="polite"
      className="relative mx-4 mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950"
      data-testid="timezone-mismatch-banner"
    >
      {/* Close button */}
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute right-2 top-2 rounded-sm p-1 text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900"
        aria-label="Dismiss timezone notification"
      >
        <X className="size-4" />
      </button>

      <div className="pe-8">
        <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
          Your device timezone has changed
        </h2>
        <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
          Your account is set to {displayStored} but your device reports {displayBrowser}.
          Updating will affect how reminders, quiet hours, and dates are shown across the app.
        </p>

        {error && (
          <p className="mt-2 text-sm text-red-700 dark:text-red-400" data-testid="timezone-error">
            {error}
            <a href="/settings" className="underline hover:no-underline">
              Settings
            </a>
            .
          </p>
        )}

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Button
            size="sm"
            onClick={handleUpdate}
            disabled={isUpdating}
            className="min-h-[48px] sm:min-h-0"
          >
            {isUpdating && (
              <span className="me-2 inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            )}
            Update to {displayBrowser}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDismiss}
            disabled={isUpdating}
            className="min-h-[48px] sm:min-h-0"
          >
            Keep {displayStored}
          </Button>
        </div>
      </div>
    </div>
  );
}
