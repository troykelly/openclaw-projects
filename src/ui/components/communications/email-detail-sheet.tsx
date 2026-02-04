import * as React from 'react';
import {
  Mail,
  Paperclip,
  Reply,
  Forward,
  Unlink,
  Calendar,
  User,
} from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { Separator } from '@/ui/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/ui/components/ui/sheet';
import type { LinkedEmail } from './types';

export interface EmailDetailSheetProps {
  email: LinkedEmail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUnlink?: (email: LinkedEmail) => void;
}

export function EmailDetailSheet({
  email,
  open,
  onOpenChange,
  onUnlink,
}: EmailDetailSheetProps) {
  if (!email) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[500px] sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="sr-only">Email Details</SheetTitle>
          <SheetDescription className="sr-only">View email subject, sender, and body</SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-full">
          <div className="space-y-4 pb-6">
            {/* Subject */}
            <div>
              <h2 className="text-xl font-semibold">{email.subject}</h2>
            </div>

            {/* Actions */}
            {onUnlink && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onUnlink(email)}
                >
                  <Unlink className="mr-1 size-3" />
                  Unlink
                </Button>
              </div>
            )}

            <Separator />

            {/* Meta info */}
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-2">
                <User className="mt-0.5 size-4 text-muted-foreground" />
                <div>
                  <p className="font-medium">{email.from.name || email.from.email}</p>
                  {email.from.name && (
                    <p className="text-xs text-muted-foreground">{email.from.email}</p>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Mail className="mt-0.5 size-4 text-muted-foreground" />
                <div>
                  <p className="text-muted-foreground">To:</p>
                  <p>
                    {email.to.map((r) => r.name || r.email).join(', ')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="size-4" />
                <span>
                  {email.date.toLocaleDateString([], {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}{' '}
                  at{' '}
                  {email.date.toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              </div>

              {email.hasAttachments && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Paperclip className="size-4" />
                  <span>Has attachments</span>
                </div>
              )}
            </div>

            <Separator />

            {/* Body */}
            <div className="prose prose-sm dark:prose-invert max-w-none">
              {email.body ? (
                <div className="whitespace-pre-wrap">{email.body}</div>
              ) : (
                <p className="text-muted-foreground">{email.snippet}</p>
              )}
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
