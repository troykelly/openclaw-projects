import * as React from 'react';
import {
  Mail, Building, Phone, Calendar, Link2, Pencil, Trash2,
  Folder, Target, Layers, FileText, ArrowRight, ArrowLeft, Tag, MapPin,
} from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { Separator } from '@/ui/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/ui/components/ui/sheet';
import { formatContactName, getContactInitials } from '@/ui/lib/format-contact-name.ts';
import type { Contact, ContactEndpoint, ContactAddress, ContactDate } from './types';
import type { LinkedWorkItem, LinkedCommunication } from './types';

function getWorkItemIcon(kind: LinkedWorkItem['kind']) {
  switch (kind) {
    case 'project':
      return <Folder className="size-4" />;
    case 'initiative':
      return <Target className="size-4" />;
    case 'epic':
      return <Layers className="size-4" />;
    case 'issue':
      return <FileText className="size-4" />;
  }
}

function getRelationshipLabel(rel: LinkedWorkItem['relationship']): string {
  switch (rel) {
    case 'owner':
      return 'Owner';
    case 'assignee':
      return 'Assigned';
    case 'stakeholder':
      return 'Stakeholder';
    case 'reviewer':
      return 'Reviewer';
  }
}

export interface ContactDetailSheetProps {
  contact: Contact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (contact: Contact) => void;
  onDelete?: (contact: Contact) => void;
  linkedWorkItems?: LinkedWorkItem[];
  linkedCommunications?: LinkedCommunication[];
  onWorkItemClick?: (item: LinkedWorkItem) => void;
  onCommunicationClick?: (comm: LinkedCommunication) => void;
}

export function ContactDetailSheet({
  contact,
  open,
  onOpenChange,
  onEdit,
  onDelete,
  linkedWorkItems = [],
  linkedCommunications = [],
  onWorkItemClick,
  onCommunicationClick,
}: ContactDetailSheetProps) {
  if (!contact) return null;

  const displayName = formatContactName(contact);
  const initials = getContactInitials(contact);
  const emails = contact.endpoints?.filter((e) => e.type === 'email') ?? [];
  const phones = contact.endpoints?.filter((e) => e.type === 'phone') ?? [];
  const addresses = contact.addresses ?? [];
  const dates = contact.dates ?? [];
  const tags = contact.tags ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-96 sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="sr-only">Contact Details</SheetTitle>
          <SheetDescription className="sr-only">View contact information, linked items, and communications</SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-full">
          <div className="space-y-6 pb-6">
            {/* Header */}
            <div className="flex items-start gap-4">
              {contact.photo_url ? (
                <img src={contact.photo_url} alt={displayName} className="size-16 rounded-full object-cover" />
              ) : (
                <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-xl font-medium text-primary">{initials}</div>
              )}

              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold">{displayName}</h2>
                {contact.nickname && <p className="text-sm text-muted-foreground">{contact.nickname}</p>}
                {contact.contact_kind && contact.contact_kind !== 'person' && (
                  <Badge variant="outline" className="mt-1 text-xs capitalize">
                    {contact.contact_kind.replace('_', ' ')}
                  </Badge>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              {onEdit && (
                <Button variant="outline" size="sm" onClick={() => onEdit(contact)}>
                  <Pencil className="mr-1 size-3" />
                  Edit
                </Button>
              )}
              {onDelete && (
                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => onDelete(contact)}>
                  <Trash2 className="mr-1 size-3" />
                  Delete
                </Button>
              )}
            </div>

            <Separator />

            {/* Endpoints */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Contact Information</h3>

              <div className="space-y-2 text-sm">
                {emails.map((ep) => (
                  <p key={ep.id ?? ep.value} className="flex items-center gap-2">
                    <Mail className="size-4 text-muted-foreground" />
                    <a href={`mailto:${ep.value}`} className="hover:underline">
                      {ep.value}
                    </a>
                    {ep.label && <span className="text-xs text-muted-foreground">({ep.label})</span>}
                  </p>
                ))}

                {phones.map((ep) => (
                  <p key={ep.id ?? ep.value} className="flex items-center gap-2">
                    <Phone className="size-4 text-muted-foreground" />
                    <a href={`tel:${ep.value}`} className="hover:underline">
                      {ep.value}
                    </a>
                    {ep.label && <span className="text-xs text-muted-foreground">({ep.label})</span>}
                  </p>
                ))}

                {emails.length === 0 && phones.length === 0 && (
                  <p className="text-muted-foreground">No contact endpoints</p>
                )}
              </div>

              {contact.notes && <div className="mt-3 rounded-md bg-muted/50 p-3 text-sm">{contact.notes}</div>}
            </div>

            {/* Addresses */}
            {addresses.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h3 className="text-sm font-medium">Addresses</h3>
                  <div className="space-y-2 text-sm">
                    {addresses.map((addr) => (
                      <div key={addr.id} className="flex items-start gap-2">
                        <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <div>
                          {addr.formatted_address ?? [addr.street_address, addr.city, addr.region, addr.postal_code, addr.country].filter(Boolean).join(', ')}
                          {addr.label && <span className="ml-1 text-xs text-muted-foreground">({addr.label})</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Dates */}
            {dates.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h3 className="text-sm font-medium">Dates</h3>
                  <div className="space-y-2 text-sm">
                    {dates.map((d) => (
                      <p key={d.id} className="flex items-center gap-2">
                        <Calendar className="size-4 text-muted-foreground" />
                        <span>{d.date_value}</span>
                        <span className="text-xs text-muted-foreground capitalize">{d.label ?? d.date_type}</span>
                      </p>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Tags */}
            {tags.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h3 className="text-sm font-medium">Tags</h3>
                  <div className="flex flex-wrap gap-1">
                    {tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="gap-1 text-xs">
                        <Tag className="size-2.5" />
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            <Separator />

            {/* Linked Work Items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Linked Items</h3>
                <Badge variant="secondary" className="text-xs">
                  {linkedWorkItems.length}
                </Badge>
              </div>

              {linkedWorkItems.length > 0 ? (
                <div className="space-y-1">
                  {linkedWorkItems.map((item) => (
                    <button
                      key={item.id}
                      data-testid="linked-work-item"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted/50"
                      onClick={() => onWorkItemClick?.(item)}
                    >
                      <span className="text-muted-foreground">{getWorkItemIcon(item.kind)}</span>
                      <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                      <Badge variant="outline" className="shrink-0 text-xs">
                        {getRelationshipLabel(item.relationship)}
                      </Badge>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">No linked items</p>
              )}
            </div>

            <Separator />

            {/* Communications */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Communications</h3>
                <Badge variant="secondary" className="text-xs">
                  {linkedCommunications.length}
                </Badge>
              </div>

              {linkedCommunications.length > 0 ? (
                <div className="space-y-1">
                  {linkedCommunications.map((comm) => (
                    <button
                      key={comm.id}
                      data-testid="linked-communication"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted/50"
                      onClick={() => onCommunicationClick?.(comm)}
                    >
                      <span className="text-muted-foreground">
                        {comm.type === 'email' ? (
                          comm.direction === 'sent' ? (
                            <ArrowRight className="size-4" />
                          ) : (
                            <ArrowLeft className="size-4" />
                          )
                        ) : (
                          <Calendar className="size-4" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{comm.subject}</span>
                        <span className="text-xs text-muted-foreground">{comm.date.toLocaleDateString()}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">No communications</p>
              )}
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
