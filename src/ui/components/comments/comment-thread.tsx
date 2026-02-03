/**
 * Threaded comment display
 * Issue #399: Implement comments system with threading
 */
import * as React from 'react';
import { ChevronDown, ChevronUp, MessageSquare } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { cn } from '@/ui/lib/utils';
import { CommentCard } from './comment-card';
import type { Comment } from './types';

export interface CommentThreadProps {
  comment: Comment;
  replies: Comment[];
  currentUserId: string;
  onReply: (commentId: string) => void;
  onEdit: (commentId: string) => void;
  onDelete: (commentId: string) => void;
  onReact?: (commentId: string, emoji: string) => void;
  defaultCollapsed?: boolean;
  className?: string;
}

export function CommentThread({
  comment,
  replies,
  currentUserId,
  onReply,
  onEdit,
  onDelete,
  onReact,
  defaultCollapsed = false,
  className,
}: CommentThreadProps) {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  const hasReplies = replies.length > 0;

  return (
    <div className={cn('space-y-2', className)}>
      {/* Parent comment */}
      <CommentCard
        comment={comment}
        currentUserId={currentUserId}
        onReply={onReply}
        onEdit={onEdit}
        onDelete={onDelete}
        onReact={onReact}
      />

      {/* Replies */}
      {hasReplies && (
        <div className="ml-8">
          {/* Toggle button */}
          {collapsed ? (
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setCollapsed(false)}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>{replies.length} replies</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs mb-2"
                onClick={() => setCollapsed(true)}
              >
                <ChevronUp className="h-3.5 w-3.5 mr-1" />
                Hide replies
              </Button>

              <div data-testid="thread-replies" className="ml-8 space-y-4">
                {replies.map((reply) => (
                  <CommentCard
                    key={reply.id}
                    comment={reply}
                    currentUserId={currentUserId}
                    onReply={onReply}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onReact={onReact}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
