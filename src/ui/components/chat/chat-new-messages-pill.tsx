/**
 * "X new messages" pill overlay (Epic #1940, Issue #1949).
 *
 * Shown when the user is scrolled up and new messages arrive.
 * Click scrolls to bottom.
 */

import * as React from 'react';
import { ArrowDown } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { useMediaQuery, MEDIA_QUERIES } from '@/ui/hooks/use-media-query';

interface ChatNewMessagesPillProps {
  count: number;
  onClick: () => void;
}

export function ChatNewMessagesPill({ count, onClick }: ChatNewMessagesPillProps): React.JSX.Element {
  const prefersReducedMotion = useMediaQuery(MEDIA_QUERIES.reducedMotion);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'absolute bottom-2 left-1/2 -translate-x-1/2 z-10',
        'flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow-md',
        'hover:bg-primary/90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
        !prefersReducedMotion && 'animate-in fade-in slide-in-from-bottom-2 duration-200',
      )}
      data-testid="chat-new-messages-pill"
      aria-label={`${count} new message${count !== 1 ? 's' : ''}, click to scroll to bottom`}
    >
      <ArrowDown className="size-3" aria-hidden="true" />
      {count} new message{count !== 1 ? 's' : ''}
    </button>
  );
}
