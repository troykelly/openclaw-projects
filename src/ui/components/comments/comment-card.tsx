/**
 * Card for displaying a single comment
 * Issue #399: Implement comments system with threading
 * Issue #1839: Fixed to match actual API response shapes
 */
import * as React from 'react';
import { Reply, Pencil, Trash2, MoreHorizontal } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/components/ui/dropdown-menu';
import { cn } from '@/ui/lib/utils';
import { CommentReactions } from './comment-reactions';
import type { Comment } from './types';

export interface CommentCardProps {
  comment: Comment;
  currentUserId: string;
  onReply?: (commentId: string) => void;
  onEdit?: (commentId: string) => void;
  onDelete?: (commentId: string) => void;
  onReact?: (commentId: string, emoji: string) => void;
  className?: string;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

function isEdited(comment: Comment): boolean {
  if (comment.edited_at) return true;
  return new Date(comment.updated_at).getTime() - new Date(comment.created_at).getTime() > 1000;
}

/** Derive a display name from an email address. */
function displayName(email: string): string {
  const local = email.split('@')[0];
  // Convert dots/underscores/hyphens to spaces and capitalize
  return local
    .replace(/[._-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Get initials from an email address. */
function initials(email: string): string {
  const name = displayName(email);
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function CommentCard({ comment, currentUserId, onReply, onEdit, onDelete, onReact, className }: CommentCardProps) {
  const isOwner = comment.user_email === currentUserId;
  const edited = isEdited(comment);
  const name = displayName(comment.user_email);
  const avatar = initials(comment.user_email);
  const reactionEntries = Object.entries(comment.reactions);

  return (
    <div className={cn('flex gap-3', className)}>
      {/* Avatar */}
      <div className="shrink-0">
        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium">{avatar}</div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{name}</span>
          <span data-testid="comment-timestamp" className="text-xs text-muted-foreground">
            {formatRelativeTime(comment.created_at)}
          </span>
          {edited && <span className="text-xs text-muted-foreground">(edited)</span>}
        </div>

        <div className="mt-1 text-sm whitespace-pre-wrap">{comment.content}</div>

        {/* Reactions */}
        {reactionEntries.length > 0 && (
          <CommentReactions reactions={comment.reactions} currentUserId={currentUserId} onReact={(emoji) => onReact?.(comment.id, emoji)} className="mt-2" />
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 mt-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onReply?.(comment.id)}>
            <Reply className="h-3.5 w-3.5 mr-1" />
            Reply
          </Button>

          {isOwner && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-1">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => onEdit?.(comment.id)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDelete?.(comment.id)} className="text-destructive">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </div>
  );
}
