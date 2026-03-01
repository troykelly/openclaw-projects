/**
 * Chat-specific skeleton loaders (Epic #1940, Issue #1948).
 *
 * Provides skeleton loading states for session list and message list.
 */

import * as React from 'react';
import { cn } from '@/ui/lib/utils';

interface ChatSkeletonLoaderProps {
  type: 'session-list' | 'message-list';
  count?: number;
}

function SkeletonBar({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded bg-muted', className)} />
  );
}

function SessionItemSkeleton() {
  return (
    <div className="flex items-start gap-3 border-b border-border p-3">
      <SkeletonBar className="size-8 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <div className="flex items-center justify-between">
          <SkeletonBar className="h-3 w-24" />
          <SkeletonBar className="h-3 w-8" />
        </div>
        <SkeletonBar className="h-3 w-40" />
      </div>
    </div>
  );
}

function MessageItemSkeleton({ isUser }: { isUser: boolean }) {
  return (
    <div className={cn('flex gap-2 px-3 py-1.5', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && <SkeletonBar className="size-6 shrink-0 rounded-full" />}
      <SkeletonBar className={cn('h-10 rounded-lg', isUser ? 'w-48' : 'w-56')} />
    </div>
  );
}

export function ChatSkeletonLoader({ type, count = 5 }: ChatSkeletonLoaderProps): React.JSX.Element {
  if (type === 'session-list') {
    return (
      <div data-testid="chat-skeleton-sessions" className="flex-1">
        {Array.from({ length: count }, (_, i) => (
          <SessionItemSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div data-testid="chat-skeleton-messages" className="flex flex-1 flex-col gap-1 p-3">
      {Array.from({ length: count }, (_, i) => (
        <MessageItemSkeleton key={i} isUser={i % 3 === 1} />
      ))}
    </div>
  );
}
