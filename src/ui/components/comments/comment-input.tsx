/**
 * Input for creating/editing comments
 * Issue #399: Implement comments system with threading
 */
import * as React from 'react';
import { Send, Loader2 } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Textarea } from '@/ui/components/ui/textarea';
import { cn } from '@/ui/lib/utils';

export interface CommentInputProps {
  onSubmit: (content: string) => void;
  placeholder?: string;
  initialValue?: string;
  loading?: boolean;
  isReply?: boolean;
  onCancel?: () => void;
  className?: string;
}

export function CommentInput({
  onSubmit,
  placeholder = 'Add a comment...',
  initialValue = '',
  loading = false,
  isReply = false,
  onCancel,
  className,
}: CommentInputProps) {
  const [content, setContent] = React.useState(initialValue);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (content.trim() && !loading) {
      onSubmit(content.trim());
      setContent('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (content.trim() && !loading) {
        onSubmit(content.trim());
        setContent('');
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className={cn('space-y-2', className)}>
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={placeholder}
        onKeyDown={handleKeyDown}
        rows={isReply ? 2 : 3}
        className="resize-none"
      />
      <div className="flex items-center justify-end gap-2">
        {isReply && onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" size="sm" disabled={!content.trim() || loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Send className="h-4 w-4 mr-1" />
              {isReply ? 'Reply' : 'Comment'}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
