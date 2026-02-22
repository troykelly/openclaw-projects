/**
 * Contact detail page.
 *
 * Displays a full profile for a single contact, with a header showing
 * avatar, name, and contact information, and tabs for:
 * - Endpoints (all communication endpoints)
 * - Preferences (communication preferences and quiet hours, issue #1269)
 * - Notes (contact notes with inline editing)
 * - Activity (recent activity for this contact)
 *
 * Navigated to via /people/:contact_id.
 */

import { ArrowLeft, Bell, Calendar, Clock, Globe, Link2, Mail, MessageSquare, Pencil, Phone, Trash2 } from 'lucide-react';
import React, { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { EmptyState, ErrorState, Skeleton, SkeletonText } from '@/ui/components/feedback';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent } from '@/ui/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Input } from '@/ui/components/ui/input';
import { Separator } from '@/ui/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/components/ui/tabs';
import { Textarea } from '@/ui/components/ui/textarea';
import { useContactDetail } from '@/ui/hooks/queries/use-contacts';
import { apiClient } from '@/ui/lib/api-client';
import type { CommChannel, Contact, ContactBody } from '@/ui/lib/api-types';
import { getInitials } from '@/ui/lib/work-item-utils';

const CHANNEL_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  email: 'Email',
  sms: 'SMS',
  voice: 'Voice',
};

export function ContactDetailPage(): React.JSX.Element {
  const { contact_id } = useParams<{ contact_id: string }>();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [prefsEditOpen, setPrefsEditOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const { data: contact, isLoading, isError, error, refetch } = useContactDetail(contact_id ?? '');

  const handleBack = useCallback(() => {
    navigate('/contacts');
  }, [navigate]);

  const handleUpdate = useCallback(
    async (body: ContactBody) => {
      if (!contact_id) return;
      setIsSubmitting(true);
      try {
        await apiClient.patch(`/api/contacts/${contact_id}`, body);
        setEditOpen(false);
        setPrefsEditOpen(false);
        refetch();
      } catch (err) {
        console.error('Failed to update contact:', err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [contact_id, refetch],
  );

  const handleDelete = useCallback(async () => {
    if (!contact_id) return;
    try {
      await apiClient.delete(`/api/contacts/${contact_id}`);
      navigate('/contacts');
    } catch (err) {
      console.error('Failed to delete contact:', err);
    }
  }, [contact_id, navigate]);

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

  const email = contact.endpoints?.find((ep) => ep.type === 'email')?.value;
  const phone = contact.endpoints?.find((ep) => ep.type === 'phone')?.value;
  const hasPrefs = contact.preferred_channel || contact.quiet_hours_start || contact.urgency_override_channel || contact.notification_notes;

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
          <TabsTrigger value="preferences" className="gap-1">
            <Bell className="size-3" />
            Preferences
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
          {(contact.endpoints?.length ?? 0) > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {contact.endpoints!.map((ep, idx) => (
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

        {/* Preferences Tab (Issue #1269) */}
        <TabsContent value="preferences" className="mt-4" data-testid="preferences-tab">
          {hasPrefs ? (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => setPrefsEditOpen(true)} data-testid="edit-prefs-button">
                  <Pencil className="mr-1 size-3" />
                  Edit Preferences
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {contact.preferred_channel && (
                  <Card>
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                        <Bell className="size-5 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Preferred Channel</p>
                        <p className="text-sm font-medium">{CHANNEL_LABELS[contact.preferred_channel] ?? contact.preferred_channel}</p>
                      </div>
                    </CardContent>
                  </Card>
                )}
                {contact.quiet_hours_start && contact.quiet_hours_end && (
                  <Card>
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                        <Clock className="size-5 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Quiet Hours</p>
                        <p className="text-sm font-medium">
                          {contact.quiet_hours_start.slice(0, 5)} – {contact.quiet_hours_end.slice(0, 5)}
                        </p>
                        {contact.quiet_hours_timezone && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Globe className="size-3" />
                            {contact.quiet_hours_timezone}
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}
                {contact.urgency_override_channel && (
                  <Card>
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                        <Phone className="size-5 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Urgency Override</p>
                        <p className="text-sm font-medium">{CHANNEL_LABELS[contact.urgency_override_channel] ?? contact.urgency_override_channel}</p>
                      </div>
                    </CardContent>
                  </Card>
                )}
                {contact.notification_notes && (
                  <Card className="sm:col-span-2">
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground mb-1">Notification Notes</p>
                      <p className="text-sm text-foreground whitespace-pre-wrap">{contact.notification_notes}</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          ) : (
            <EmptyState
              variant="notifications"
              title="No preferences set"
              description="Configure preferred communication channel, quiet hours, and notification preferences for this contact."
              onAction={() => setPrefsEditOpen(true)}
              actionLabel="Set Preferences"
            />
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

      {/* Edit Communication Preferences Dialog (Issue #1269) */}
      <CommPrefsEditDialog open={prefsEditOpen} onOpenChange={setPrefsEditOpen} contact={contact} isSubmitting={isSubmitting} onSubmit={handleUpdate} />

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
  const [display_name, setDisplayName] = useState('');
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
      display_name: display_name.trim(),
      notes: notes.trim() || undefined,
    });
  };

  const isValid = display_name.trim().length > 0;

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
            <Input id="edit-contact-name" value={display_name} onChange={(e) => setDisplayName(e.target.value)} required />
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

// ---------------------------------------------------------------------------
// CommPrefsEditDialog - Communication preferences editor (Issue #1269)
// ---------------------------------------------------------------------------

const CHANNEL_OPTIONS: Array<{ value: CommChannel; label: string }> = [
  { value: 'telegram', label: 'Telegram' },
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'voice', label: 'Voice' },
];

interface CommPrefsEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: Contact;
  isSubmitting: boolean;
  onSubmit: (body: ContactBody) => void;
}

function CommPrefsEditDialog({ open, onOpenChange, contact, isSubmitting, onSubmit }: CommPrefsEditDialogProps) {
  const [preferredChannel, setPreferredChannel] = useState<CommChannel | ''>('');
  const [quietStart, setQuietStart] = useState('');
  const [quietEnd, setQuietEnd] = useState('');
  const [quietTimezone, setQuietTimezone] = useState('');
  const [urgencyChannel, setUrgencyChannel] = useState<CommChannel | ''>('');
  const [notifNotes, setNotifNotes] = useState('');

  React.useEffect(() => {
    if (open) {
      setPreferredChannel(contact.preferred_channel ?? '');
      setQuietStart(contact.quiet_hours_start?.slice(0, 5) ?? '');
      setQuietEnd(contact.quiet_hours_end?.slice(0, 5) ?? '');
      setQuietTimezone(contact.quiet_hours_timezone ?? '');
      setUrgencyChannel(contact.urgency_override_channel ?? '');
      setNotifNotes(contact.notification_notes ?? '');
    }
  }, [open, contact]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      display_name: contact.display_name,
      preferred_channel: (preferredChannel as CommChannel) || null,
      quiet_hours_start: quietStart || null,
      quiet_hours_end: quietEnd || null,
      quiet_hours_timezone: quietTimezone.trim() || null,
      urgency_override_channel: (urgencyChannel as CommChannel) || null,
      notification_notes: notifNotes.trim() || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="comm-prefs-edit-dialog">
        <DialogHeader>
          <DialogTitle>Communication Preferences</DialogTitle>
          <DialogDescription>Configure how and when to reach this contact.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="pref-channel" className="text-sm font-medium">
              Preferred Channel
            </label>
            <select
              id="pref-channel"
              value={preferredChannel}
              onChange={(e) => setPreferredChannel(e.target.value as CommChannel | '')}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">None</option>
              {CHANNEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <Separator />

          <div className="space-y-2">
            <p className="text-sm font-medium">Quiet Hours</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="quiet-start" className="text-xs text-muted-foreground">
                  Start
                </label>
                <Input id="quiet-start" type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label htmlFor="quiet-end" className="text-xs text-muted-foreground">
                  End
                </label>
                <Input id="quiet-end" type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor="quiet-tz" className="text-xs text-muted-foreground">
                Timezone (IANA)
              </label>
              <Input id="quiet-tz" placeholder="e.g. Australia/Sydney" value={quietTimezone} onChange={(e) => setQuietTimezone(e.target.value)} />
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <label htmlFor="urgency-channel" className="text-sm font-medium">
              Urgency Override Channel
            </label>
            <select
              id="urgency-channel"
              value={urgencyChannel}
              onChange={(e) => setUrgencyChannel(e.target.value as CommChannel | '')}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">None</option>
              {CHANNEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="notif-notes" className="text-sm font-medium">
              Notification Notes
            </label>
            <Textarea
              id="notif-notes"
              value={notifNotes}
              onChange={(e) => setNotifNotes(e.target.value)}
              rows={2}
              placeholder="e.g. Prefers voice for bad news"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              Save Preferences
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
