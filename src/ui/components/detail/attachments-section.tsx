import * as React from 'react';
import { Brain, User, Mail, Calendar, Link2, ExternalLink } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import type { WorkItemAttachment } from './types';

function getAttachmentIcon(type: WorkItemAttachment['type']) {
  switch (type) {
    case 'memory':
      return <Brain className="size-4" />;
    case 'contact':
      return <User className="size-4" />;
    case 'email':
      return <Mail className="size-4" />;
    case 'calendar':
      return <Calendar className="size-4" />;
  }
}

function getAttachmentTypeLabel(type: WorkItemAttachment['type']): string {
  switch (type) {
    case 'memory':
      return 'Memory';
    case 'contact':
      return 'Contact';
    case 'email':
      return 'Email';
    case 'calendar':
      return 'Event';
  }
}

export interface AttachmentsSectionProps {
  attachments: WorkItemAttachment[];
  onAttachmentClick?: (attachment: WorkItemAttachment) => void;
  onLinkNew?: () => void;
  className?: string;
}

export function AttachmentsSection({ attachments, onAttachmentClick, onLinkNew, className }: AttachmentsSectionProps) {
  const groupedAttachments = React.useMemo(() => {
    const groups: Record<WorkItemAttachment['type'], WorkItemAttachment[]> = {
      memory: [],
      contact: [],
      email: [],
      calendar: [],
    };
    for (const attachment of attachments) {
      groups[attachment.type].push(attachment);
    }
    return groups;
  }, [attachments]);

  const hasAny = attachments.length > 0;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Linked Items</h3>
        {onLinkNew && (
          <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={onLinkNew}>
            <Link2 className="size-3" />
            Link
          </Button>
        )}
      </div>

      {hasAny ? (
        <div className="space-y-4">
          {(Object.entries(groupedAttachments) as [WorkItemAttachment['type'], WorkItemAttachment[]][])
            .filter(([_, items]) => items.length > 0)
            .map(([type, items]) => (
              <div key={type}>
                <h4 className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  {getAttachmentIcon(type)}
                  {getAttachmentTypeLabel(type)}s ({items.length})
                </h4>
                <div className="space-y-1">
                  {items.map((attachment) => (
                    <button
                      key={attachment.id}
                      data-testid="attachment-item"
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left',
                        'hover:bg-muted/50',
                        onAttachmentClick && 'cursor-pointer',
                      )}
                      onClick={() => onAttachmentClick?.(attachment)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{attachment.title}</span>
                        {attachment.subtitle && <span className="block truncate text-xs text-muted-foreground">{attachment.subtitle}</span>}
                      </span>
                      {onAttachmentClick && <ExternalLink className="size-3 shrink-0 text-muted-foreground" />}
                    </button>
                  ))}
                </div>
              </div>
            ))}
        </div>
      ) : (
        <p className="py-4 text-center text-sm text-muted-foreground">No linked items</p>
      )}
    </div>
  );
}
