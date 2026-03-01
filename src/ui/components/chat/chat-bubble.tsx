/**
 * Floating chat bubble (FAB) for the agent chat feature (Epic #1940, Issue #1947).
 *
 * Positioned bottom-right on all authenticated pages. Shows unread badge.
 * Click toggles the chat panel. Position-aware above mobile nav.
 * Hidden when no agents are available. Animated entrance respects
 * prefers-reduced-motion.
 */

import * as React from 'react';
import { MessageCircle } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { useChat } from '@/ui/contexts/chat-context';
import { useAvailableAgents, useChatUnreadCount } from '@/ui/hooks/queries/use-chat';
import { useMediaQuery, MEDIA_QUERIES } from '@/ui/hooks/use-media-query';

export function ChatBubble(): React.JSX.Element | null {
  const { togglePanel, isPanelOpen } = useChat();
  const { data: agentsData } = useAvailableAgents();
  const { data: unreadData } = useChatUnreadCount();
  const prefersReducedMotion = useMediaQuery(MEDIA_QUERIES.reducedMotion);

  const agents = React.useMemo(
    () => (Array.isArray(agentsData?.agents) ? agentsData.agents : []),
    [agentsData?.agents],
  );

  const unreadCount = unreadData?.count ?? 0;

  // Hidden when no agents available
  if (agents.length === 0) return null;

  return (
    <button
      data-testid="chat-bubble"
      type="button"
      onClick={togglePanel}
      aria-label={
        unreadCount > 0
          ? `Open chat (${unreadCount} unread message${unreadCount !== 1 ? 's' : ''})`
          : 'Open chat'
      }
      aria-expanded={isPanelOpen}
      className={cn(
        'fixed z-40 flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg',
        'size-14 hover:bg-primary/90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        // Position above mobile nav on small screens
        'bottom-20 right-4 md:bottom-6 md:right-6',
        // Animated entrance
        !prefersReducedMotion && 'animate-in fade-in zoom-in-75 duration-300',
        // Hide when panel is open
        isPanelOpen && 'hidden',
      )}
    >
      <MessageCircle className="size-6" aria-hidden="true" />
      {unreadCount > 0 && (
        <span
          data-testid="chat-unread-badge"
          className={cn(
            'absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground',
            !prefersReducedMotion && 'animate-in zoom-in-50 duration-200',
          )}
          aria-hidden="true"
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}
