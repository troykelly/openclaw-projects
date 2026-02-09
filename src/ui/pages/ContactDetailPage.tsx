/**
 * Contact detail page.
 *
 * Displays a full profile for a single contact, with a header showing
 * avatar, name, and contact information, and tabs for:
 * - Endpoints (all communication endpoints)
 * - Linked Work Items (work items associated with this contact)
 * - Activity (recent activity for this contact)
 * - Notes (contact notes with inline editing)
 *
 * Navigated to via /people/:contactId.
 */
import React, { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { ArrowLeft, Mail, Phone, Pencil, Trash2, Link2, Calendar, FileText, MessageSquare } from 'lucide-react';
import { apiClient } from '@/ui/lib/api-client';
import type { Contact, ContactBody } from '@/ui/lib/api-types';
import { getInitials } from '@/ui/lib/work-item-utils';
import { Skeleton, SkeletonText, ErrorState, EmptyState } from '@/ui/components/feedback';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Textarea } from '@/ui/components/ui/textarea';
import { Badge } from '@/ui/components/ui/badge';
import { Card, CardContent } from '@/ui/components/ui/card';
import { Separator } from '@/ui/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/ui/components/ui/dialog';
import { useContactDetail } from '@/ui/hooks/queries/use-contacts';

export function ContactDetailPage(): React.JSX.Element {
  const { contactId } = useParams<{ contactId: string }>();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const { data: contact, isLoading, isError, error, refetch } = useContactDetail(contactId ?? '');

  const handleBack = useCallback(() => {
    navigate('/contacts');
  }, [navigate]);

  const handleUpdate = useCallback(
    async (body: ContactBody) => {
      if (!contactId) return;
      setIsSubmitting(true);
      try {
        await apiClient.patch(`/api/contacts/${contactId}`, body);
        setEditOpen(false);
        refetch();
      } catch (err) {
        console.error('Failed to update contact:', err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [contactId, refetch],
  );

  const handleDelete = useCallback(async () => {
    if (!contactId) return;
    try {
      await apiClient.delete(`/api/contacts/${contactId}`);
      navigate('/contacts');
    } catch (err) {
      console.error('Failed to delete contact:', err);
    }
  }, [contactId, navigate]);

  // Loading state
  if (isLoading) {
    return (
      <div data-testid="page-contact-detail" className="p-6">
        <div className="mb-6 flex items-center gap-4">
          <Skeleton width={36} height={36} variant="circular" />
          <div className="flex-1">
            <Skeleton width={200} height={24} />
            <Skeleton width={150} height={16} className="mt-2" />
          </div>
        </div>
        <Skeleton width="100%" height={48} className="mb-4" />
        <SkeletonText lines={5} />
      </div>
    );
  }

  // Error state
  if (isError || !contact) {
    return (
      <div data-testid="page-contact-detail" className="p-6">
        <Button variant="ghost" size="sm" onClick={handleBack} className="mb-4">
          <ArrowLeft className="mr-2 size-4" />
          Back to Contacts
        </Button>
        <ErrorState
          type={isError ? 'generic' : 'not-found'}
          title={isError ? 'Failed to load contact' : 'Contact not found'}
          description={isError && error instanceof Error ? error.message : 'The contact you are looking for does not exist or has been removed.'}
          onRetry={isError ? () => refetch() : undefined}
        />
      </div>
    );
  }

  const email = contact.endpoints.find((ep) => ep.type === 'email')?.value;
  const phone = contact.endpoints.find((ep) => ep.type === 'phone')?.value;

  return (
    <div data-testid="page-contact-detail" className="p-6 h-full flex flex-col">
      {/* Back button */}
      <Button variant="ghost" size="sm" onClick={handleBack} className="mb-4 w-fit" data-testid="back-button">
        <ArrowLeft className="mr-2 size-4" />
        Back to Contacts
      </Button>

      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-medium text-primary">
            {getInitials(contact.display_name)}
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{contact.display_name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {email && (
                <span className="flex items-center gap-1">
                  <Mail className="size-3" />
                  <a href={`mailto:${email}`} className="hover:underline">
                    {email}
                  </a>
                </span>
              )}
              {phone && (
                <span className="flex items-center gap-1">
                  <Phone className="size-3" />
                  <a href={`tel:${phone}`} className="hover:underline">
                    {phone}
                  </a>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} data-testid="edit-contact-button">
            <Pencil className="mr-1 size-3" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteConfirmOpen(true)}
            data-testid="delete-contact-button"
          >
            <Trash2 className="mr-1 size-3" />
            Delete
          </Button>
        </div>
      </div>

      <Separator className="mb-6" />

      {/* Tabbed content */}
      <Tabs defaultValue="endpoints" className="flex-1">
        <TabsList data-testid="contact-tabs">
          <TabsTrigger value="endpoints" className="gap-1">
            <Link2 className="size-3" />
            Endpoints
          </TabsTrigger>
          <TabsTrigger value="notes" className="gap-1">
            <MessageSquare className="size-3" />
            Notes
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-1">
            <Calendar className="size-3" />
            Activity
          </TabsTrigger>
        </TabsList>

        {/* Endpoints Tab */}
        <TabsContent value="endpoints" className="mt-4">
          {contact.endpoints.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {contact.endpoints.map((ep, idx) => (
                <Card key={idx} data-testid="endpoint-card">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                      {ep.type === 'email' && <Mail className="size-5 text-muted-foreground" />}
                      {ep.type === 'phone' && <Phone className="size-5 text-muted-foreground" />}
                      {ep.type !== 'email' && ep.type !== 'phone' && <Link2 className="size-5 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <Badge variant="outline" className="text-xs mb-1">
                        {ep.type}
                      </Badge>
                      <p className="text-sm text-foreground truncate">{ep.value}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState variant="contacts" title="No endpoints" description="This contact has no communication endpoints configured." />
          )}
        </TabsContent>

        {/* Notes Tab */}
        <TabsContent value="notes" className="mt-4">
          {contact.notes ? (
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-foreground whitespace-pre-wrap" data-testid="contact-notes">
                  {contact.notes}
                </p>
              </CardContent>
            </Card>
          ) : (
            <EmptyState
              variant="documents"
              title="No notes"
              description="No notes have been added for this contact."
              onAction={() => setEditOpen(true)}
              actionLabel="Add Notes"
            />
          )}
        </TabsContent>

        {/* Activity Tab */}
        <TabsContent value="activity" className="mt-4">
          <EmptyState variant="calendar" title="No activity yet" description="Activity related to this contact will appear here." />
        </TabsContent>
      </Tabs>

      {/* Edit Contact Dialog */}
      <ContactEditDialog open={editOpen} onOpenChange={setEditOpen} contact={contact} isSubmitting={isSubmitting} onSubmit={handleUpdate} />

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-sm" data-testid="delete-confirm-dialog">
          <DialogHeader>
            <DialogTitle>Delete Contact</DialogTitle>
            <DialogDescription>Are you sure you want to delete &quot;{contact.display_name}&quot;? This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} data-testid="confirm-delete-button">
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContactEditDialog - extracted for readability
// ---------------------------------------------------------------------------

interface ContactEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: Contact;
  isSubmitting: boolean;
  onSubmit: (body: ContactBody) => void;
}

function ContactEditDialog({ open, onOpenChange, contact, isSubmitting, onSubmit }: ContactEditDialogProps) {
  const [displayName, setDisplayName] = useState('');
  const [notes, setNotes] = useState('');

  React.useEffect(() => {
    if (open) {
      setDisplayName(contact.display_name);
      setNotes(contact.notes ?? '');
    }
  }, [open, contact]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      displayName: displayName.trim(),
      notes: notes.trim() || undefined,
    });
  };

  const isValid = displayName.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="contact-edit-dialog">
        <DialogHeader>
          <DialogTitle>Edit Contact</DialogTitle>
          <DialogDescription>Update the contact details below.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="edit-contact-name" className="text-sm font-medium">
              Name <span className="text-destructive">*</span>
            </label>
            <Input id="edit-contact-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </div>

          <div className="space-y-2">
            <label htmlFor="edit-contact-notes" className="text-sm font-medium">
              Notes
            </label>
            <Textarea id="edit-contact-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid || isSubmitting}>
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
