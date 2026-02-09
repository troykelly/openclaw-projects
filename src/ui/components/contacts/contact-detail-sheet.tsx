import * as React from 'react';
import { Mail, Building, Briefcase, Phone, Calendar, Link2, Pencil, Trash2, Folder, Target, Layers, FileText, ArrowRight, ArrowLeft } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { Separator } from '@/ui/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/ui/components/ui/sheet';
import type { ContactDetail, LinkedWorkItem, LinkedCommunication } from './types';

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
  contact: ContactDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (contact: ContactDetail) => void;
  onDelete?: (contact: ContactDetail) => void;
  onWorkItemClick?: (item: LinkedWorkItem) => void;
  onCommunicationClick?: (comm: LinkedCommunication) => void;
}

export function ContactDetailSheet({ contact, open, onOpenChange, onEdit, onDelete, onWorkItemClick, onCommunicationClick }: ContactDetailSheetProps) {
  if (!contact) return null;

  const initials = contact.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

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
              {contact.avatar ? (
                <img src={contact.avatar} alt={contact.name} className="size-16 rounded-full object-cover" />
              ) : (
                <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-xl font-medium text-primary">{initials}</div>
              )}

              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold">{contact.name}</h2>
                {contact.role && <p className="text-sm text-muted-foreground">{contact.role}</p>}
                {contact.company && <p className="text-sm text-muted-foreground">{contact.company}</p>}
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

            {/* Contact Info */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Contact Information</h3>

              <div className="space-y-2 text-sm">
                <p className="flex items-center gap-2">
                  <Mail className="size-4 text-muted-foreground" />
                  <a href={`mailto:${contact.email}`} className="hover:underline">
                    {contact.email}
                  </a>
                </p>

                {contact.phone && (
                  <p className="flex items-center gap-2">
                    <Phone className="size-4 text-muted-foreground" />
                    <a href={`tel:${contact.phone}`} className="hover:underline">
                      {contact.phone}
                    </a>
                  </p>
                )}

                {contact.company && (
                  <p className="flex items-center gap-2">
                    <Building className="size-4 text-muted-foreground" />
                    {contact.company}
                  </p>
                )}

                {contact.role && (
                  <p className="flex items-center gap-2">
                    <Briefcase className="size-4 text-muted-foreground" />
                    {contact.role}
                  </p>
                )}
              </div>

              {contact.notes && <div className="mt-3 rounded-md bg-muted/50 p-3 text-sm">{contact.notes}</div>}
            </div>

            <Separator />

            {/* Linked Work Items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Linked Items</h3>
                <Badge variant="secondary" className="text-xs">
                  {contact.linkedWorkItems.length}
                </Badge>
              </div>

              {contact.linkedWorkItems.length > 0 ? (
                <div className="space-y-1">
                  {contact.linkedWorkItems.map((item) => (
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
                  {contact.linkedCommunications.length}
                </Badge>
              </div>

              {contact.linkedCommunications.length > 0 ? (
                <div className="space-y-1">
                  {contact.linkedCommunications.map((comm) => (
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
