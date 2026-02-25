/**
 * Contact detail page.
 *
 * Displays a full profile for a single contact, with a header showing
 * avatar, name, and contact information, and tabs for:
 * - Endpoints (all communication endpoints) with add/edit/delete (#1702)
 * - Addresses (full CRUD) (#1703)
 * - Dates (birthdays, anniversaries CRUD) (#1704)
 * - Preferences (communication preferences and quiet hours, issue #1269)
 * - Notes (contact notes with inline editing)
 * - Activity (recent activity for this contact)
 *
 * Also includes:
 * - Tags section with add/remove (#1705)
 * - Photo upload/display (#1706)
 *
 * Navigated to via /contacts/:contact_id.
 */

import {
  ArrowLeft, Bell, Brain, Briefcase, Calendar, Cake, Clock, Globe, Heart,
  Link2, Mail, MapPin, MessageSquare, Pencil, Phone,
  Plus, Tag, Trash2, Upload, X, Loader2,
} from 'lucide-react';
import React, { useCallback, useRef, useState } from 'react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { useContactDetail } from '@/ui/hooks/queries/use-contacts';
import { useContactMemories } from '@/ui/hooks/queries/use-memories';
import {
  useUpdateContact,
  useAddContactEndpoint, useUpdateContactEndpoint, useDeleteContactEndpoint,
  useAddContactAddress, useUpdateContactAddress, useDeleteContactAddress,
  useAddContactDate, useUpdateContactDate, useDeleteContactDate,
  useAddContactTags, useRemoveContactTag,
  useUploadContactPhoto, useDeleteContactPhoto,
} from '@/ui/hooks/mutations/use-update-contact';
import { useContactWorkItems } from '@/ui/hooks/queries/use-work-item-contacts';
import { apiClient } from '@/ui/lib/api-client';
import type { CommChannel, Contact, ContactAddress, ContactDate, ContactEndpoint, CreateContactBody, EndpointType, Memory } from '@/ui/lib/api-types';
import { formatContactName, getContactInitials } from '@/ui/lib/format-contact-name';

const CHANNEL_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  email: 'Email',
  sms: 'SMS',
  voice: 'Voice',
};

const ENDPOINT_TYPES: EndpointType[] = [
  'email', 'phone', 'telegram', 'whatsapp', 'signal',
  'discord', 'linkedin', 'twitter', 'mastodon',
  'instagram', 'facebook', 'website', 'sip', 'imessage',
];

const ADDRESS_TYPES = ['home', 'work', 'other'] as const;
const DATE_TYPES = ['birthday', 'anniversary', 'other'] as const;

export function ContactDetailPage(): React.JSX.Element {
  const { contact_id } = useParams<{ contact_id: string }>();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [prefsEditOpen, setPrefsEditOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // #1702: Endpoint management
  const [endpointDialogOpen, setEndpointDialogOpen] = useState(false);
  const [editingEndpoint, setEditingEndpoint] = useState<ContactEndpoint | null>(null);

  // #1703: Address management
  const [addressDialogOpen, setAddressDialogOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<ContactAddress | null>(null);

  // #1704: Date management
  const [dateDialogOpen, setDateDialogOpen] = useState(false);
  const [editingDate, setEditingDate] = useState<ContactDate | null>(null);

  // #1705: Tag management
  const [tagInput, setTagInput] = useState('');

  // Load with all includes
  const { data: contact, isLoading, isError, error, refetch } = useContactDetail(
    contact_id ?? '',
    'endpoints,addresses,dates,tags',
  );
  const { data: memoriesData } = useContactMemories(contact_id ?? '');
  const { data: linkedWorkItemsData } = useContactWorkItems(contact_id ?? '');

  const updateMutation = useUpdateContact();
  const addEndpoint = useAddContactEndpoint();
  const updateEndpoint = useUpdateContactEndpoint();
  const deleteEndpoint = useDeleteContactEndpoint();
  const addAddress = useAddContactAddress();
  const updateAddress = useUpdateContactAddress();
  const deleteAddress = useDeleteContactAddress();
  const addDate = useAddContactDate();
  const updateDate = useUpdateContactDate();
  const deleteDate = useDeleteContactDate();
  const addTags = useAddContactTags();
  const removeTag = useRemoveContactTag();
  const uploadPhoto = useUploadContactPhoto();
  const deletePhoto = useDeleteContactPhoto();

  const photoInputRef = useRef<HTMLInputElement>(null);

  const handleBack = useCallback(() => {
    navigate('/contacts');
  }, [navigate]);

  const handleUpdate = useCallback(
    async (body: CreateContactBody) => {
      if (!contact_id) return;
      try {
        await updateMutation.mutateAsync({ id: contact_id, body });
        setEditOpen(false);
        setPrefsEditOpen(false);
        refetch();
      } catch (err) {
        console.error('Failed to update contact:', err);
      }
    },
    [contact_id, updateMutation, refetch],
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

  // #1706: Photo upload handler
  const handlePhotoUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !contact_id) return;
    try {
      await uploadPhoto.mutateAsync({ contactId: contact_id, file });
      refetch();
    } catch (err) {
      console.error('Failed to upload photo:', err);
    }
  }, [contact_id, uploadPhoto, refetch]);

  const handlePhotoDelete = useCallback(async () => {
    if (!contact_id) return;
    try {
      await deletePhoto.mutateAsync({ contactId: contact_id });
      refetch();
    } catch (err) {
      console.error('Failed to delete photo:', err);
    }
  }, [contact_id, deletePhoto, refetch]);

  // #1705: Tag add handler
  const handleAddTag = useCallback(async () => {
    if (!contact_id || !tagInput.trim()) return;
    try {
      await addTags.mutateAsync({ contactId: contact_id, tags: [tagInput.trim()] });
      setTagInput('');
      refetch();
    } catch (err) {
      console.error('Failed to add tag:', err);
    }
  }, [contact_id, tagInput, addTags, refetch]);

  const handleRemoveTag = useCallback(async (tag: string) => {
    if (!contact_id) return;
    try {
      await removeTag.mutateAsync({ contactId: contact_id, tag });
      refetch();
    } catch (err) {
      console.error('Failed to remove tag:', err);
    }
  }, [contact_id, removeTag, refetch]);

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

  const name = formatContactName(contact) || contact.display_name || '';
  const initials = getContactInitials(contact) || (contact.display_name ? contact.display_name.split(/\s+/).map(p => p[0]).join('').toUpperCase().slice(0, 2) : '');
  const email = contact.endpoints?.find((ep) => ep.type === 'email')?.value;
  const phone = contact.endpoints?.find((ep) => ep.type === 'phone')?.value;
  const hasPrefs = contact.preferred_channel || contact.quiet_hours_start || contact.urgency_override_channel || contact.notification_notes;
  const tags = Array.isArray(contact.tags) ? contact.tags : [];
  const addresses = Array.isArray(contact.addresses) ? contact.addresses : [];
  const dates = Array.isArray(contact.dates) ? contact.dates : [];

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
          {/* #1706: Photo/Avatar with upload */}
          <div className="relative group">
            {contact.photo_url ? (
              <img
                src={contact.photo_url}
                alt={name}
                className="size-16 rounded-full object-cover"
                data-testid="contact-avatar-image"
              />
            ) : (
              <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-medium text-primary">
                {initials}
              </div>
            )}
            <button
              onClick={() => photoInputRef.current?.click()}
              className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
              data-testid="upload-photo-button"
              title="Upload photo"
            >
              <Upload className="size-5" />
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoUpload}
              data-testid="photo-file-input"
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold text-foreground">{name}</h1>
              {contact.contact_kind && contact.contact_kind !== 'person' && (
                <Badge variant="outline">{contact.contact_kind}</Badge>
              )}
            </div>
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

      {/* #1705: Tags section */}
      <div className="mb-4" data-testid="contact-tags-section">
        <div className="flex items-center gap-2 flex-wrap">
          <Tag className="size-4 text-muted-foreground" />
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs gap-1">
              {tag}
              <button
                onClick={() => handleRemoveTag(tag)}
                className="ml-1 hover:text-destructive"
                data-testid={`remove-tag-${tag}`}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          <div className="flex items-center gap-1">
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="Add tag..."
              className="h-7 w-24 text-xs"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddTag();
                }
              }}
              data-testid="tag-input"
            />
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleAddTag} data-testid="add-tag-button">
              <Plus className="size-3" />
            </Button>
          </div>
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
          <TabsTrigger value="addresses" className="gap-1">
            <MapPin className="size-3" />
            Addresses
          </TabsTrigger>
          <TabsTrigger value="dates" className="gap-1">
            <Calendar className="size-3" />
            Dates
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
          <TabsTrigger value="memories" className="gap-1">
            <Brain className="size-3" />
            Memories
          </TabsTrigger>
          <TabsTrigger value="work-items" className="gap-1">
            <Briefcase className="size-3" />
            Work Items
          </TabsTrigger>
        </TabsList>

        {/* #1702: Endpoints Tab with add/edit/delete */}
        <TabsContent value="endpoints" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setEditingEndpoint(null); setEndpointDialogOpen(true); }}
              data-testid="add-endpoint-button"
            >
              <Plus className="mr-1 size-3" />
              Add Endpoint
            </Button>
          </div>
          {(contact.endpoints?.length ?? 0) > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {contact.endpoints!.map((ep, idx) => (
                <Card key={ep.id ?? idx} data-testid="endpoint-card">
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
                      {ep.label && <p className="text-xs text-muted-foreground">{ep.label}</p>}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => { setEditingEndpoint(ep); setEndpointDialogOpen(true); }}
                        data-testid="endpoint-edit-button"
                      >
                        <Pencil className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-destructive hover:text-destructive"
                        onClick={async () => {
                          if (!contact_id || !ep.id) return;
                          await deleteEndpoint.mutateAsync({ contactId: contact_id, endpointId: ep.id });
                          refetch();
                        }}
                        data-testid="endpoint-delete-button"
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState variant="contacts" title="No endpoints" description="This contact has no communication endpoints configured." />
          )}
        </TabsContent>

        {/* #1703: Addresses Tab */}
        <TabsContent value="addresses" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setEditingAddress(null); setAddressDialogOpen(true); }}
              data-testid="add-address-button"
            >
              <Plus className="mr-1 size-3" />
              Add Address
            </Button>
          </div>
          {addresses.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {addresses.map((addr) => (
                <Card key={addr.id} data-testid="address-card">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <Badge variant="outline" className="text-xs">{addr.address_type}</Badge>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => { setEditingAddress(addr); setAddressDialogOpen(true); }}
                          data-testid="address-edit-button"
                        >
                          <Pencil className="size-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-destructive hover:text-destructive"
                          onClick={async () => {
                            if (!contact_id) return;
                            await deleteAddress.mutateAsync({ contactId: contact_id, addressId: addr.id });
                            refetch();
                          }}
                          data-testid="address-delete-button"
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="text-sm space-y-0.5">
                      {addr.street_address && <p>{addr.street_address}</p>}
                      {addr.extended_address && <p>{addr.extended_address}</p>}
                      <p>
                        {[addr.city, addr.region, addr.postal_code].filter(Boolean).join(', ')}
                      </p>
                      {addr.country && <p>{addr.country}</p>}
                    </div>
                    {addr.is_primary && (
                      <Badge variant="secondary" className="text-xs mt-2">Primary</Badge>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState
              variant="contacts"
              title="No addresses"
              description="This contact has no addresses configured."
              onAction={() => { setEditingAddress(null); setAddressDialogOpen(true); }}
              actionLabel="Add Address"
            />
          )}
        </TabsContent>

        {/* #1704: Dates Tab */}
        <TabsContent value="dates" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setEditingDate(null); setDateDialogOpen(true); }}
              data-testid="add-date-button"
            >
              <Plus className="mr-1 size-3" />
              Add Date
            </Button>
          </div>
          {dates.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {dates.map((d) => (
                <Card key={d.id} data-testid="date-card">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                      {d.date_type === 'birthday' && <Cake className="size-5 text-muted-foreground" />}
                      {d.date_type === 'anniversary' && <Heart className="size-5 text-muted-foreground" />}
                      {d.date_type === 'other' && <Calendar className="size-5 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <Badge variant="outline" className="text-xs mb-1 capitalize">
                        {d.date_type === 'birthday' ? 'Birthday' : d.date_type === 'anniversary' ? 'Anniversary' : d.label || 'Other'}
                      </Badge>
                      <p className="text-sm text-foreground">{d.date_value}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => { setEditingDate(d); setDateDialogOpen(true); }}
                        data-testid="date-edit-button"
                      >
                        <Pencil className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-destructive hover:text-destructive"
                        onClick={async () => {
                          if (!contact_id) return;
                          await deleteDate.mutateAsync({ contactId: contact_id, dateId: d.id });
                          refetch();
                        }}
                        data-testid="date-delete-button"
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState
              variant="calendar"
              title="No dates"
              description="No important dates have been added for this contact."
              onAction={() => { setEditingDate(null); setDateDialogOpen(true); }}
              actionLabel="Add Date"
            />
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

        {/* Memories Tab (#1723) */}
        <TabsContent value="memories" className="mt-4" data-testid="contact-memories-tab">
          {Array.isArray(memoriesData?.memories) && memoriesData.memories.length > 0 ? (
            <div className="space-y-2">
              {memoriesData.memories.map((mem: Memory) => (
                <Card key={mem.id} className="cursor-pointer hover:bg-accent/30" onClick={() => navigate(`/memory/${mem.id}`)}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-medium">{mem.title}</h4>
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{mem.content}</p>
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0 ml-2">
                        {mem.memory_type ?? mem.type ?? 'memory'}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState variant="documents" title="No memories" description="No memories are linked to this contact." />
          )}
        </TabsContent>

        {/* Work Items Tab (#1720) */}
        <TabsContent value="work-items" className="mt-4" data-testid="linked-work-items-tab">
          {(linkedWorkItemsData?.work_items ?? []).length > 0 ? (
            <div className="space-y-2">
              {linkedWorkItemsData!.work_items.map((wi) => (
                <Card key={wi.id}>
                  <CardContent className="p-4 flex items-center gap-3">
                    <Briefcase className="size-5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <a href={`/app/work-items/${wi.work_item_id}`} className="text-sm font-medium hover:underline truncate block">
                        {wi.title}
                      </a>
                      <div className="flex gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">{wi.kind}</Badge>
                        <Badge variant="secondary" className="text-xs">{wi.status}</Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState variant="documents" title="No linked work items" description="Work items linked to this contact will appear here." />
          )}
        </TabsContent>
      </Tabs>

      {/* Edit Contact Dialog */}
      <ContactEditDialog open={editOpen} onOpenChange={setEditOpen} contact={contact} isSubmitting={updateMutation.isPending} onSubmit={handleUpdate} />

      {/* Edit Communication Preferences Dialog (Issue #1269) */}
      <CommPrefsEditDialog open={prefsEditOpen} onOpenChange={setPrefsEditOpen} contact={contact} isSubmitting={updateMutation.isPending} onSubmit={handleUpdate} />

      {/* #1702: Endpoint Dialog */}
      <EndpointDialog
        open={endpointDialogOpen}
        onOpenChange={setEndpointDialogOpen}
        contactId={contact_id ?? ''}
        endpoint={editingEndpoint}
        onSave={async (data) => {
          if (editingEndpoint?.id) {
            await updateEndpoint.mutateAsync({
              contactId: contact_id ?? '',
              endpointId: editingEndpoint.id,
              label: data.label,
              is_primary: data.is_primary,
            });
          } else {
            await addEndpoint.mutateAsync({
              contactId: contact_id ?? '',
              type: data.type,
              value: data.value,
              label: data.label,
              is_primary: data.is_primary,
            });
          }
          setEndpointDialogOpen(false);
          refetch();
        }}
        isPending={addEndpoint.isPending || updateEndpoint.isPending}
      />

      {/* #1703: Address Dialog */}
      <AddressDialog
        open={addressDialogOpen}
        onOpenChange={setAddressDialogOpen}
        contactId={contact_id ?? ''}
        address={editingAddress}
        onSave={async (data) => {
          if (editingAddress) {
            await updateAddress.mutateAsync({
              contactId: contact_id ?? '',
              addressId: editingAddress.id,
              ...data,
            });
          } else {
            await addAddress.mutateAsync({
              contactId: contact_id ?? '',
              ...data,
            });
          }
          setAddressDialogOpen(false);
          refetch();
        }}
        isPending={addAddress.isPending || updateAddress.isPending}
      />

      {/* #1704: Date Dialog */}
      <DateDialog
        open={dateDialogOpen}
        onOpenChange={setDateDialogOpen}
        contactId={contact_id ?? ''}
        date={editingDate}
        onSave={async (data) => {
          if (editingDate) {
            await updateDate.mutateAsync({
              contactId: contact_id ?? '',
              dateId: editingDate.id,
              ...data,
            });
          } else {
            await addDate.mutateAsync({
              contactId: contact_id ?? '',
              ...data,
            });
          }
          setDateDialogOpen(false);
          refetch();
        }}
        isPending={addDate.isPending || updateDate.isPending}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-sm" data-testid="delete-confirm-dialog">
          <DialogHeader>
            <DialogTitle>Delete Contact</DialogTitle>
            <DialogDescription>Are you sure you want to delete &quot;{name}&quot;? This action cannot be undone.</DialogDescription>
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
  onSubmit: (body: CreateContactBody) => void;
}

function ContactEditDialog({ open, onOpenChange, contact, isSubmitting, onSubmit }: ContactEditDialogProps) {
  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [displayNameField, setDisplayNameField] = useState('');
  const [notes, setNotes] = useState('');

  React.useEffect(() => {
    if (open) {
      setGivenName(contact.given_name ?? '');
      setFamilyName(contact.family_name ?? '');
      setDisplayNameField(contact.display_name ?? '');
      setNotes(contact.notes ?? '');
    }
  }, [open, contact]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: CreateContactBody = {
      given_name: givenName.trim() || undefined,
      family_name: familyName.trim() || undefined,
      display_name: displayNameField.trim() || [givenName.trim(), familyName.trim()].filter(Boolean).join(' ') || undefined,
      notes: notes.trim() || undefined,
    };
    onSubmit(body);
  };

  const isValid = givenName.trim().length > 0 || familyName.trim().length > 0 || displayNameField.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="contact-edit-dialog">
        <DialogHeader>
          <DialogTitle>Edit Contact</DialogTitle>
          <DialogDescription>Update the contact details below.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label htmlFor="edit-given-name" className="text-sm font-medium">First Name</label>
              <Input id="edit-given-name" value={givenName} onChange={(e) => setGivenName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label htmlFor="edit-family-name" className="text-sm font-medium">Last Name</label>
              <Input id="edit-family-name" value={familyName} onChange={(e) => setFamilyName(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="edit-display-name" className="text-sm font-medium">Display Name</label>
            <Input id="edit-display-name" value={displayNameField} onChange={(e) => setDisplayNameField(e.target.value)} placeholder="Auto-generated from name fields" />
          </div>

          <div className="space-y-2">
            <label htmlFor="edit-contact-notes" className="text-sm font-medium">Notes</label>
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
// #1702: Endpoint Dialog
// ---------------------------------------------------------------------------

interface EndpointDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  endpoint: ContactEndpoint | null;
  onSave: (data: { type: string; value: string; label?: string | null; is_primary?: boolean }) => void;
  isPending: boolean;
}

function EndpointDialog({ open, onOpenChange, endpoint, onSave, isPending }: EndpointDialogProps) {
  const [type, setType] = useState<string>('email');
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);

  React.useEffect(() => {
    if (open) {
      setType(endpoint?.type ?? 'email');
      setValue(endpoint?.value ?? '');
      setLabel(endpoint?.label ?? '');
      setIsPrimary(endpoint?.is_primary ?? false);
    }
  }, [open, endpoint]);

  const isEditing = !!endpoint?.id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="endpoint-dialog">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Endpoint' : 'Add Endpoint'}</DialogTitle>
          <DialogDescription>{isEditing ? 'Update endpoint details.' : 'Add a new communication endpoint.'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!isEditing && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Type</label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger data-testid="endpoint-type-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENDPOINT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Value</label>
                <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. alice@example.com" data-testid="endpoint-value-input" />
              </div>
            </>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium">Label</label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Work, Personal" data-testid="endpoint-label-input" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => onSave({ type, value, label: label.trim() || null, is_primary: isPrimary })}
            disabled={isPending || (!isEditing && !value.trim())}
          >
            {isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {isEditing ? 'Save' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// #1703: Address Dialog
// ---------------------------------------------------------------------------

interface AddressDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  address: ContactAddress | null;
  onSave: (data: Partial<ContactAddress>) => void;
  isPending: boolean;
}

function AddressDialog({ open, onOpenChange, address, onSave, isPending }: AddressDialogProps) {
  const [addressType, setAddressType] = useState<string>('home');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [region, setRegion] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);

  React.useEffect(() => {
    if (open) {
      setAddressType(address?.address_type ?? 'home');
      setStreet(address?.street_address ?? '');
      setCity(address?.city ?? '');
      setRegion(address?.region ?? '');
      setPostalCode(address?.postal_code ?? '');
      setCountry(address?.country ?? '');
      setIsPrimary(address?.is_primary ?? false);
    }
  }, [open, address]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="address-dialog">
        <DialogHeader>
          <DialogTitle>{address ? 'Edit Address' : 'Add Address'}</DialogTitle>
          <DialogDescription>{address ? 'Update address details.' : 'Add a new address.'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">Type</label>
            <Select value={addressType} onValueChange={setAddressType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ADDRESS_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Street</label>
            <Input value={street} onChange={(e) => setStreet(e.target.value)} placeholder="123 Main St" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">City</label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Region</label>
              <Input value={region} onChange={(e) => setRegion(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Postal Code</label>
              <Input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Country</label>
              <Input value={country} onChange={(e) => setCountry(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => onSave({
              address_type: addressType as ContactAddress['address_type'],
              street_address: street.trim() || null,
              city: city.trim() || null,
              region: region.trim() || null,
              postal_code: postalCode.trim() || null,
              country: country.trim() || null,
              is_primary: isPrimary,
            })}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {address ? 'Save' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// #1704: Date Dialog
// ---------------------------------------------------------------------------

interface DateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  date: ContactDate | null;
  onSave: (data: { date_type?: string; label?: string; date_value: string }) => void;
  isPending: boolean;
}

function DateDialog({ open, onOpenChange, date, onSave, isPending }: DateDialogProps) {
  const [dateType, setDateType] = useState<string>('birthday');
  const [dateLabel, setDateLabel] = useState('');
  const [dateValue, setDateValue] = useState('');

  React.useEffect(() => {
    if (open) {
      setDateType(date?.date_type ?? 'birthday');
      setDateLabel(date?.label ?? '');
      setDateValue(date?.date_value ?? '');
    }
  }, [open, date]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="date-dialog">
        <DialogHeader>
          <DialogTitle>{date ? 'Edit Date' : 'Add Date'}</DialogTitle>
          <DialogDescription>{date ? 'Update date details.' : 'Add an important date.'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">Type</label>
            <Select value={dateType} onValueChange={setDateType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DATE_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {dateType === 'other' && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Label</label>
              <Input value={dateLabel} onChange={(e) => setDateLabel(e.target.value)} placeholder="e.g. Graduation" />
            </div>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium">Date</label>
            <Input type="date" value={dateValue} onChange={(e) => setDateValue(e.target.value)} data-testid="date-value-input" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => onSave({
              date_type: dateType,
              label: dateLabel.trim() || undefined,
              date_value: dateValue,
            })}
            disabled={isPending || !dateValue}
          >
            {isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {date ? 'Save' : 'Add'}
          </Button>
        </DialogFooter>
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
  onSubmit: (body: CreateContactBody) => void;
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
      display_name: contact.display_name ?? undefined,
      preferred_channel: (preferredChannel as CommChannel) || null,
      quiet_hours_start: quietStart || null,
      quiet_hours_end: quietEnd || null,
      quiet_hours_timezone: quietTimezone.trim() || null,
      urgency_override_channel: (urgencyChannel as string) || null,
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
