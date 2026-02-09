import * as React from 'react';
import { Mail, Paperclip, MoreVertical, Unlink, ExternalLink } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/components/ui/dropdown-menu';
import type { LinkedEmail } from './types';

export interface EmailCardProps {
  email: LinkedEmail;
  onClick?: (email: LinkedEmail) => void;
  onUnlink?: (email: LinkedEmail) => void;
  className?: string;
}

export function EmailCard({ email, onClick, onUnlink, className }: EmailCardProps) {
  return (
    <div
      data-testid="email-card"
      className={cn(
        'group flex items-start gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50',
        onClick && 'cursor-pointer',
        !email.isRead && 'border-l-2 border-l-primary',
        className,
      )}
      onClick={() => onClick?.(email)}
    >
      {/* Icon */}
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Mail className="size-4 text-primary" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={cn('truncate text-sm', !email.isRead && 'font-semibold')}>{email.subject}</p>
            <p className="text-xs text-muted-foreground">{email.from.name || email.from.email}</p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {email.hasAttachments && <Paperclip className="size-3 text-muted-foreground" />}
            <span className="text-xs text-muted-foreground">{formatEmailDate(email.date)}</span>

            {onUnlink && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-6 opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                    <MoreVertical className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUnlink(email);
                    }}
                  >
                    <Unlink className="mr-2 size-4" />
                    Unlink
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{email.snippet}</p>
      </div>
    </div>
  );
}

function formatEmailDate(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (days === 1) {
    return 'Yesterday';
  }
  if (days < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
