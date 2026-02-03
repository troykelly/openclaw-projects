/**
 * Full comments section for work items
 * Issue #399: Implement comments system with threading
 */
import * as React from 'react';
import { MessageSquare, Loader2 } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { CommentInput } from './comment-input';
import { CommentThread } from './comment-thread';
import type { Comment } from './types';

export interface CommentsSectionProps {
  workItemId: string;
  comments: Comment[];
  currentUserId: string;
  onAddComment: (workItemId: string, content: string) => void;
  onEditComment: (commentId: string, content: string) => void;
  onDeleteComment: (commentId: string) => void;
  onAddReply: (commentId: string, content: string) => void;
  onReact?: (commentId: string, emoji: string) => void;
  loading?: boolean;
  submitting?: boolean;
  className?: string;
}

export function CommentsSection({
  workItemId,
  comments,
  currentUserId,
  onAddComment,
  onEditComment,
  onDeleteComment,
  onAddReply,
  onReact,
  loading = false,
  submitting = false,
  className,
}: CommentsSectionProps) {
  const [replyingTo, setReplyingTo] = React.useState<string | null>(null);

  // Separate top-level comments and replies
  const { topLevel, repliesByParent } = React.useMemo(() => {
    const topLevel: Comment[] = [];
    const repliesByParent: Map<string, Comment[]> = new Map();

    for (const comment of comments) {
      if (comment.parentId) {
        const existing = repliesByParent.get(comment.parentId) || [];
        existing.push(comment);
        repliesByParent.set(comment.parentId, existing);
      } else {
        topLevel.push(comment);
      }
    }

    // Sort by createdAt
    topLevel.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    
    for (const [, replies] of repliesByParent) {
      replies.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    }

    return { topLevel, repliesByParent };
  }, [comments]);

  const handleSubmitComment = (content: string) => {
    onAddComment(workItemId, content);
  };

  const handleReply = (commentId: string) => {
    setReplyingTo(commentId);
  };

  const handleSubmitReply = (parentId: string, content: string) => {
    onAddReply(parentId, content);
    setReplyingTo(null);
  };

  const handleEdit = (commentId: string) => {
    // This would typically open an edit modal or inline editor
    // For now, we just call onEditComment with placeholder
    console.log('Edit comment:', commentId);
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Comments</h3>
        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
          {comments.length}
        </span>
      </div>

      {/* Comment input */}
      <CommentInput
        onSubmit={handleSubmitComment}
        placeholder="Add a comment..."
        loading={submitting}
      />

      {/* Loading state */}
      {loading && (
        <div data-testid="comments-loading" className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Comments list */}
      {!loading && topLevel.length === 0 && (
        <div className="py-8 text-center text-muted-foreground">
          <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No comments yet</p>
          <p className="text-xs mt-1">Be the first to comment</p>
        </div>
      )}

      {!loading && topLevel.length > 0 && (
        <div className="space-y-6">
          {topLevel.map((comment) => (
            <div key={comment.id}>
              <CommentThread
                comment={comment}
                replies={repliesByParent.get(comment.id) || []}
                currentUserId={currentUserId}
                onReply={handleReply}
                onEdit={handleEdit}
                onDelete={onDeleteComment}
                onReact={onReact}
              />

              {/* Reply input */}
              {replyingTo === comment.id && (
                <div className="ml-11 mt-2">
                  <CommentInput
                    onSubmit={(content) => handleSubmitReply(comment.id, content)}
                    placeholder="Write a reply..."
                    isReply
                    onCancel={() => setReplyingTo(null)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
