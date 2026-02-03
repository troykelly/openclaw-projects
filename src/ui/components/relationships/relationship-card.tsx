/**
 * Card for displaying a relationship
 * Issue #395: Implement contact relationship types
 */
import * as React from 'react';
import { ArrowRight, ArrowLeftRight, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { cn } from '@/ui/lib/utils';
import { RelationshipBadge } from './relationship-badge';
import type { ContactRelationship, Contact } from './types';

export interface RelationshipCardProps {
  relationship: ContactRelationship;
  contact: Contact;
  onEdit?: (relationshipId: string) => void;
  onRemove?: (relationshipId: string) => void;
  className?: string;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function RelationshipCard({
  relationship,
  contact,
  onEdit,
  onRemove,
  className,
}: RelationshipCardProps) {
  const initials = contact.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors',
        className
      )}
    >
      {/* Avatar */}
      <div className="shrink-0">
        {contact.avatar ? (
          <img
            src={contact.avatar}
            alt={contact.name}
            className="w-10 h-10 rounded-full object-cover"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
            {initials}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium truncate">{contact.name}</span>
          <RelationshipBadge type={relationship.type} size="sm" />
          {relationship.direction !== 'bidirectional' && (
            <span
              data-testid="direction-indicator"
              className="text-muted-foreground"
              title={relationship.direction === 'outgoing' ? 'You → Them' : 'Them → You'}
            >
              {relationship.direction === 'outgoing' ? (
                <ArrowRight className="h-3.5 w-3.5" />
              ) : (
                <ArrowLeftRight className="h-3.5 w-3.5" />
              )}
            </span>
          )}
        </div>

        {relationship.notes && (
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{relationship.notes}</p>
        )}

        {relationship.lastInteraction && (
          <p className="text-xs text-muted-foreground mt-1">
            Last interaction: {formatDate(relationship.lastInteraction)}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {onEdit && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onEdit(relationship.id)}
            aria-label="Edit relationship"
          >
            <Pencil className="h-4 w-4" />
          </Button>
        )}
        {onRemove && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={() => onRemove(relationship.id)}
            aria-label="Remove relationship"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
