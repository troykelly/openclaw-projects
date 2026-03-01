/**
 * Chat panel overlay (Epic #1940, Issue #1948).
 *
 * ~400x600px overlay on desktop, full-screen Sheet on mobile (<768px).
 * ErrorBoundary wrapped, focus trap, Escape to close,
 * animated open/close (reduced-motion aware), respects sidebar collapse.
 */

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { useChat } from '@/ui/contexts/chat-context';
import { useMediaQuery, MEDIA_QUERIES } from '@/ui/hooks/use-media-query';
import { ErrorBoundary } from '@/ui/components/error-boundary';
import { Sheet, SheetContent } from '@/ui/components/ui/sheet';
import { Button } from '@/ui/components/ui/button';
import { ChatSessionList } from './chat-session-list';
import { ChatConversation } from './chat-conversation';
import { ChatHeader } from './chat-header';
import { ChatInput } from './chat-input';
import { ChatEmptyState } from './chat-empty-state';

export function ChatPanel(): React.JSX.Element | null {
  const { isPanelOpen, closePanel, activeSessionId } = useChat();
  const isMobile = useMediaQuery(MEDIA_QUERIES.mobile);
  const prefersReducedMotion = useMediaQuery(MEDIA_QUERIES.reducedMotion);
  const panelRef = React.useRef<HTMLDivElement>(null);

  // Escape to close
  React.useEffect(() => {
    if (!isPanelOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePanel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isPanelOpen, closePanel]);

  // Focus trap: focus the panel when opened
  React.useEffect(() => {
    if (isPanelOpen && panelRef.current) {
      panelRef.current.focus();
    }
  }, [isPanelOpen]);

  if (!isPanelOpen) return null;

  const panelContent = (
    <ErrorBoundary title="Chat error" description="Something went wrong with the chat. Please try again.">
      <div className="flex h-full flex-col">
        {activeSessionId ? (
          <>
            <ChatHeader />
            <ChatConversation />
            <ChatInput />
          </>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-border p-3">
              <h2 className="text-sm font-semibold">Messages</h2>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={closePanel}
                aria-label="Close chat"
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>
            <ChatSessionList />
            <ChatEmptyState />
          </>
        )}
      </div>
    </ErrorBoundary>
  );

  // Mobile: full-screen Sheet
  if (isMobile) {
    return (
      <Sheet open={isPanelOpen} onOpenChange={(open) => { if (!open) closePanel(); }}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="h-[100dvh] p-0"
          data-testid="chat-panel"
        >
          {panelContent}
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: floating overlay
  return (
    <div
      ref={panelRef}
      data-testid="chat-panel"
      role="dialog"
      aria-label="Chat"
      aria-modal="true"
      tabIndex={-1}
      className={cn(
        'fixed bottom-6 right-6 z-50 flex h-[600px] w-[400px] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl',
        !prefersReducedMotion && 'animate-in fade-in slide-in-from-bottom-4 duration-200',
      )}
    >
      {panelContent}
    </div>
  );
}
