import * as React from 'react';
import { Mail, Building, Phone, Tag } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Card } from '@/ui/components/ui/card';
import { Badge } from '@/ui/components/ui/badge';
import { formatContactName, getContactInitials } from '@/ui/lib/format-contact-name.ts';
import type { Contact } from './types';

export interface ContactCardProps {
  contact: Contact;
  onClick?: (contact: Contact) => void;
  className?: string;
}

export function ContactCard({ contact, onClick, className }: ContactCardProps) {
  const displayName = formatContactName(contact);
  const initials = getContactInitials(contact);
  const primaryEmail = contact.endpoints?.find((e) => e.type === 'email')?.value;
  const primaryPhone = contact.endpoints?.find((e) => e.type === 'phone')?.value;

  return (
    <Card data-testid="contact-card" className={cn('cursor-pointer p-4 transition-colors hover:bg-muted/50', className)} onClick={() => onClick?.(contact)}>
      <div className="flex items-start gap-3">
        {/* Avatar */}
        {contact.photo_url ? (
          <img src={contact.photo_url} alt={displayName} className="size-10 shrink-0 rounded-full object-cover" />
        ) : (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">{initials}</div>
        )}

        {/* Info */}
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium">{displayName}</h3>

          <div className="mt-1 space-y-0.5 text-sm text-muted-foreground">
            {primaryEmail && (
              <p className="flex items-center gap-1 truncate">
                <Mail className="size-3 shrink-0" />
                {primaryEmail}
              </p>
            )}

            {primaryPhone && (
              <p className="flex items-center gap-1 truncate">
                <Phone className="size-3 shrink-0" />
                {primaryPhone}
              </p>
            )}
          </div>

          {/* Tags */}
          {contact.tags && contact.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {contact.tags.slice(0, 3).map((tag) => (
                <Badge key={tag} variant="secondary" className="gap-1 text-xs">
                  <Tag className="size-2.5" />
                  {tag}
                </Badge>
              ))}
              {contact.tags.length > 3 && (
                <Badge variant="outline" className="text-xs">+{contact.tags.length - 3}</Badge>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
