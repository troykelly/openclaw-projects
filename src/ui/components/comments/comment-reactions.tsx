/**
 * Reactions display for comments
 * Issue #399: Implement comments system with threading
 * Issue #1839: Fixed to match actual API response shape (Record<string, number>)
 */
import * as React from 'react';
import { SmilePlus } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/components/ui/popover';
import { cn } from '@/ui/lib/utils';
import { REACTION_EMOJIS } from './types';

export interface CommentReactionsProps {
  /** Reactions as returned by the API: { emoji: count } */
  reactions: Record<string, number>;
  currentUserId: string;
  onReact: (emoji: string) => void;
  className?: string;
}

export function CommentReactions({ reactions, currentUserId: _currentUserId, onReact, className }: CommentReactionsProps) {
  const [popoverOpen, setPopoverOpen] = React.useState(false);
  const entries = Object.entries(reactions);

  const handleReact = (emoji: string) => {
    onReact(emoji);
    setPopoverOpen(false);
  };

  return (
    <div className={cn('flex items-center gap-1 flex-wrap', className)}>
      {/* Existing reactions */}
      {entries.map(([emoji, count]) => (
        <button
          key={emoji}
          type="button"
          className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors', 'bg-muted hover:bg-muted/80')}
          onClick={() => onReact(emoji)}
        >
          <span>{emoji}</span>
          <span>{count}</span>
        </button>
      ))}

      {/* Add reaction */}
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 rounded-full" aria-label="Add reaction">
            <SmilePlus className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start">
          <div className="flex gap-1">
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="w-8 h-8 flex items-center justify-center rounded hover:bg-muted text-lg"
                onClick={() => handleReact(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
