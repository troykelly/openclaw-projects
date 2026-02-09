import * as React from 'react';
import { User, Mail, Building, Briefcase, Link2 } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Card } from '@/ui/components/ui/card';
import { Badge } from '@/ui/components/ui/badge';
import type { Contact } from './types';

export interface ContactCardProps {
  contact: Contact;
  onClick?: (contact: Contact) => void;
  className?: string;
}

export function ContactCard({ contact, onClick, className }: ContactCardProps) {
  const initials = contact.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <Card data-testid="contact-card" className={cn('cursor-pointer p-4 transition-colors hover:bg-muted/50', className)} onClick={() => onClick?.(contact)}>
      <div className="flex items-start gap-3">
        {/* Avatar */}
        {contact.avatar ? (
          <img src={contact.avatar} alt={contact.name} className="size-10 shrink-0 rounded-full object-cover" />
        ) : (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">{initials}</div>
        )}

        {/* Info */}
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium">{contact.name}</h3>

          <div className="mt-1 space-y-0.5 text-sm text-muted-foreground">
            <p className="flex items-center gap-1 truncate">
              <Mail className="size-3 shrink-0" />
              {contact.email}
            </p>

            {contact.company && (
              <p className="flex items-center gap-1 truncate">
                <Building className="size-3 shrink-0" />
                {contact.company}
              </p>
            )}

            {contact.role && (
              <p className="flex items-center gap-1 truncate">
                <Briefcase className="size-3 shrink-0" />
                {contact.role}
              </p>
            )}
          </div>

          {/* Linked items count */}
          {contact.linkedItemCount > 0 && (
            <div className="mt-2">
              <Badge variant="secondary" className="gap-1">
                <Link2 className="size-3" />
                {contact.linkedItemCount} linked
              </Badge>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
