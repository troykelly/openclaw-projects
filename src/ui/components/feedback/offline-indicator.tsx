import * as React from 'react';
import { useState, useEffect } from 'react';
import { WifiOff, Wifi } from 'lucide-react';
import { cn } from '@/ui/lib/utils';

export interface OfflineIndicatorProps {
  /** Whether to show the indicator when online (briefly showing "Back online" message) */
  showOnlineConfirmation?: boolean;
  /** Duration to show online confirmation in ms */
  onlineConfirmationDuration?: number;
  className?: string;
}

export function OfflineIndicator({ showOnlineConfirmation = true, onlineConfirmationDuration = 3000, className }: OfflineIndicatorProps) {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [showOnline, setShowOnline] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (wasOffline && showOnlineConfirmation) {
        setShowOnline(true);
        setTimeout(() => setShowOnline(false), onlineConfirmationDuration);
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      setWasOffline(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [wasOffline, showOnlineConfirmation, onlineConfirmationDuration]);

  if (isOnline && !showOnline) return null;

  return (
    <div
      data-testid="offline-indicator"
      role="status"
      aria-live="polite"
      className={cn(
        'fixed bottom-4 left-1/2 -translate-x-1/2 z-50',
        'flex items-center gap-2 rounded-full px-4 py-2 shadow-lg',
        'animate-in slide-in-from-bottom-4 duration-300',
        !isOnline ? 'bg-destructive text-destructive-foreground' : 'bg-green-500 text-white',
        className,
      )}
    >
      {!isOnline ? (
        <>
          <WifiOff className="size-4" />
          <span className="text-sm font-medium">You&apos;re offline</span>
        </>
      ) : (
        <>
          <Wifi className="size-4" />
          <span className="text-sm font-medium">Back online</span>
        </>
      )}
    </div>
  );
}
