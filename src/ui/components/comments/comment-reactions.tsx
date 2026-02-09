/**
 * Reactions display for comments
 * Issue #399: Implement comments system with threading
 */
import * as React from 'react';
import { SmilePlus } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/components/ui/popover';
import { cn } from '@/ui/lib/utils';
import type { CommentReaction } from './types';
import { REACTION_EMOJIS } from './types';

export interface CommentReactionsProps {
  reactions: CommentReaction[];
  currentUserId: string;
  onReact: (emoji: string) => void;
  className?: string;
}

export function CommentReactions({ reactions, currentUserId, onReact, className }: CommentReactionsProps) {
  const [popoverOpen, setPopoverOpen] = React.useState(false);

  const handleReact = (emoji: string) => {
    onReact(emoji);
    setPopoverOpen(false);
  };

  return (
    <div className={cn('flex items-center gap-1 flex-wrap', className)}>
      {/* Existing reactions */}
      {reactions.map((reaction) => {
        const hasReacted = reaction.users.includes(currentUserId);

        return (
          <button
            key={reaction.emoji}
            type="button"
            data-reacted={hasReacted}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors',
              hasReacted ? 'bg-primary/20 border border-primary/30' : 'bg-muted hover:bg-muted/80',
            )}
            onClick={() => onReact(reaction.emoji)}
          >
            <span>{reaction.emoji}</span>
            <span>{reaction.count}</span>
          </button>
        );
      })}

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
