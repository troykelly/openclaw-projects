/**
 * Contacts list page.
 *
 * Displays a searchable, sortable grid of contact cards with avatar,
 * name, email, phone, company, role, and linked item counts. Supports
 * creating and editing contacts via a dialog, viewing details in a
 * slide-out sheet, and navigating to the full contact detail page.
 *
 * Uses the typed API client and TanStack Query hooks for data fetching.
 *
 * Covers issues:
 * - #1701: Structured name fields + contact kind in forms
 * - #1705: Tag display on cards
 * - #1709: Contact merge UI
 * - #1711: Import/export UI
 * - #1713: Bulk selection + action bar
 */
import React, { useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import {
  Search, UserPlus, ArrowUpDown, Grid3X3, List, Mail, Phone,
  Link2, Merge, Upload, Download, FileDown, FileUp, Loader2,
} from 'lucide-react';
import { apiClient } from '@/ui/lib/api-client';
import type { Contact, ContactsResponse, CreateContactBody, ContactKind, ImportResult } from '@/ui/lib/api-types';
import { formatContactName, getContactInitials } from '@/ui/lib/format-contact-name';
import { Skeleton, SkeletonList, ErrorState, EmptyState } from '@/ui/components/feedback';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Badge } from '@/ui/components/ui/badge';
import { Card, CardContent } from '@/ui/components/ui/card';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { Separator } from '@/ui/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/ui/components/ui/dialog';
import { Textarea } from '@/ui/components/ui/textarea';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/ui/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { Checkbox } from '@/ui/components/ui/checkbox';
import { useContacts } from '@/ui/hooks/queries/use-contacts';
import { useCreateContact, useUpdateContact, useMergeContacts, useImportContacts } from '@/ui/hooks/mutations/use-update-contact';

/** Sort options for the contacts list. */
type SortField = 'name' | 'recent' | 'endpoints';

/** View mode for the contacts list. */
type ViewMode = 'grid' | 'list';

/** Contact kind labels. */
const CONTACT_KIND_LABELS: Record<ContactKind, string> = {
  person: 'Person',
  organisation: 'Organisation',
  group: 'Group',
  agent: 'Agent',
};

/** Get primary endpoint value by type. */
function getEndpointValue(contact: Contact, type: string): string | null {
  const ep = contact.endpoints?.find((e) => e.type === type);
  return ep?.value ?? null;
}

/** Sort contacts by the chosen field. */
function sortContacts(contacts: Contact[], field: SortField): Contact[] {
  const sorted = [...contacts];
  switch (field) {
    case 'name':
      return sorted.sort((a, b) => (a.display_name ?? '').localeCompare(b.display_name ?? ''));
    case 'recent':
      return sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    case 'endpoints':
      return sorted.sort((a, b) => (b.endpoints?.length ?? 0) - (a.endpoints?.length ?? 0));
    default:
      return sorted;
  }
}

/** Get display name for a contact using formatContactName. */
function displayName(contact: Contact): string {
  return formatContactName(contact) || contact.display_name || '';
}

/** Get initials for a contact avatar. */
function contactInitials(contact: Contact): string {
  return getContactInitials(contact) || (contact.display_name ? contact.display_name.split(/\s+/).map(p => p[0]).join('').toUpperCase().slice(0, 2) : '');
}

export function ContactsPage(): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);

  // #1709: Merge state
  const [mergeOpen, setMergeOpen] = useState(false);

  // #1711: Import state
  const [importOpen, setImportOpen] = useState(false);

  // #1713: Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const navigate = useNavigate();

  // Debounced search with TanStack Query
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isError, error, refetch } = useContacts(debouncedSearch || undefined);
  const createMutation = useCreateContact();
  const updateMutation = useUpdateContact();

  /** Sorted contacts list. */
  const sortedContacts = useMemo(() => {
    if (!data?.contacts) return [];
    return sortContacts(data.contacts, sortField);
  }, [data?.contacts, sortField]);

  const handleContactClick = useCallback((contact: Contact) => {
    setSelectedContact(contact);
    setDetailOpen(true);
  }, []);

  const handleNavigateToDetail = useCallback(
    (contact: Contact) => {
      navigate(`/contacts/${contact.id}`);
    },
    [navigate],
  );

  const handleCreateContact = useCallback(
    async (body: CreateContactBody) => {
      try {
        await createMutation.mutateAsync(body);
        setFormOpen(false);
        setEditingContact(null);
      } catch (err) {
        console.error('Failed to create contact:', err);
      }
    },
    [createMutation],
  );

  const handleUpdateContact = useCallback(
    async (body: CreateContactBody) => {
      if (!editingContact) return;
      try {
        await updateMutation.mutateAsync({ id: editingContact.id, body });
        setFormOpen(false);
        setEditingContact(null);
        setDetailOpen(false);
        setSelectedContact(null);
      } catch (err) {
        console.error('Failed to update contact:', err);
      }
    },
    [editingContact, updateMutation],
  );

  const handleDeleteContact = useCallback(
    async (contact: Contact) => {
      try {
        await apiClient.delete(`/api/contacts/${contact.id}`);
        setDetailOpen(false);
        setSelectedContact(null);
        refetch();
      } catch (err) {
        console.error('Failed to delete contact:', err);
      }
    },
    [refetch],
  );

  const handleEdit = useCallback((contact: Contact) => {
    setEditingContact(contact);
    setDetailOpen(false);
    setFormOpen(true);
  }, []);

  const handleAddNew = useCallback(() => {
    setEditingContact(null);
    setFormOpen(true);
  }, []);

  // #1713: Bulk selection handlers
  const handleToggleSelect = useCallback((contactId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) {
        next.delete(contactId);
      } else {
        next.add(contactId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === sortedContacts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedContacts.map((c) => c.id)));
    }
  }, [selectedIds.size, sortedContacts]);

  const handleDeselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // #1711: Export handler
  const handleExport = useCallback(async (format: 'csv' | 'json') => {
    try {
      const response = await fetch(`/api/contacts/export?format=${format}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `contacts.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export contacts:', err);
    }
  }, []);

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  // Loading state
  if (isLoading) {
    return (
      <div data-testid="page-contacts" className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <Skeleton width={200} height={32} />
          <Skeleton width={120} height={36} />
        </div>
        <Skeleton width="100%" height={40} className="mb-4" />
        <SkeletonList count={6} variant="card" />
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div data-testid="page-contacts" className="p-6">
        <ErrorState
          type="generic"
          title="Failed to load contacts"
          description={error instanceof Error ? error.message : 'Unknown error'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const total = data?.total ?? 0;

  return (
    <div data-testid="page-contacts" className="p-6 h-full flex flex-col">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">People</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total} contact{total !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* #1711: Import/Export buttons */}
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} data-testid="import-contacts-button">
            <Upload className="mr-1 size-4" />
            Import
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport('csv')} data-testid="export-contacts-button">
            <Download className="mr-1 size-4" />
            Export
          </Button>
          {/* #1709: Merge button */}
          <Button variant="outline" size="sm" onClick={() => setMergeOpen(true)} data-testid="merge-contacts-button">
            <Merge className="mr-1 size-4" />
            Merge
          </Button>
          <Button onClick={handleAddNew} data-testid="add-contact-button">
            <UserPlus className="mr-2 size-4" />
            Add Contact
          </Button>
        </div>
      </div>

      {/* Search and Controls */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search contacts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="contact-search-input"
          />
        </div>

        <div className="flex items-center gap-2">
          {/* #1713: Select All checkbox */}
          <div className="flex items-center gap-2" data-testid="select-all-checkbox">
            <Checkbox
              checked={sortedContacts.length > 0 && selectedIds.size === sortedContacts.length}
              onCheckedChange={handleSelectAll}
              aria-label="Select all contacts"
            />
            <span className="text-xs text-muted-foreground">All</span>
          </div>

          {/* Sort */}
          <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
            <SelectTrigger className="w-[150px]" data-testid="sort-select">
              <ArrowUpDown className="mr-2 size-4" />
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="recent">Most Recent</SelectItem>
              <SelectItem value="endpoints">Endpoints</SelectItem>
            </SelectContent>
          </Select>

          {/* View mode toggle */}
          <div className="flex rounded-md border">
            <Button
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              size="icon"
              className="rounded-r-none size-9"
              onClick={() => setViewMode('grid')}
              title="Grid view"
              data-testid="view-grid"
            >
              <Grid3X3 className="size-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="icon"
              className="rounded-l-none size-9"
              onClick={() => setViewMode('list')}
              title="List view"
              data-testid="view-list"
            >
              <List className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* #1713: Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-primary/10 p-3" data-testid="bulk-action-bar">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Button variant="outline" size="sm" onClick={handleDeselectAll}>
            Deselect All
          </Button>
          <Button variant="destructive" size="sm" onClick={() => {
            // Bulk delete would go here
          }}>
            Delete
          </Button>
        </div>
      )}

      {/* Contacts List / Grid */}
      {sortedContacts.length === 0 ? (
        <Card>
          <CardContent className="p-8">
            <EmptyState
              variant="contacts"
              title={search ? 'No contacts found' : 'No contacts yet'}
              description={search ? 'Try a different search term.' : 'Add your first contact to get started.'}
              onAction={!search ? handleAddNew : undefined}
              actionLabel="Add Contact"
            />
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="flex-1">
          {viewMode === 'grid' ? (
            /* Grid View */
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="contacts-grid">
              {sortedContacts.map((contact) => {
                const email = getEndpointValue(contact, 'email');
                const phone = getEndpointValue(contact, 'phone');
                const name = displayName(contact);
                const initials = contactInitials(contact);
                const isOrg = contact.contact_kind && contact.contact_kind !== 'person';
                const tags = Array.isArray(contact.tags) ? contact.tags : [];
                return (
                  <Card
                    key={contact.id}
                    data-testid="contact-card"
                    className="cursor-pointer transition-colors hover:bg-muted/50"
                    onClick={() => handleContactClick(contact)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        {/* #1713: Checkbox */}
                        <div className="pt-1" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(contact.id)}
                            onCheckedChange={() => handleToggleSelect(contact.id)}
                            aria-label={`Select ${name}`}
                          />
                        </div>
                        <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                          {initials}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium text-foreground truncate">{name}</h3>
                            {/* #1701: Contact kind badge */}
                            {isOrg && contact.contact_kind && (
                              <Badge variant="outline" className="text-xs shrink-0">
                                {CONTACT_KIND_LABELS[contact.contact_kind]}
                              </Badge>
                            )}
                          </div>
                          {email && (
                            <p className="flex items-center gap-1 text-sm text-muted-foreground truncate mt-0.5">
                              <Mail className="size-3 shrink-0" />
                              {email}
                            </p>
                          )}
                          {phone && (
                            <p className="flex items-center gap-1 text-sm text-muted-foreground truncate mt-0.5">
                              <Phone className="size-3 shrink-0" />
                              {phone}
                            </p>
                          )}
                        </div>
                      </div>
                      {/* #1705: Tags + endpoint count */}
                      <div className="mt-3 flex items-center gap-2 flex-wrap">
                        {tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                        {(contact.endpoints?.length ?? 0) > 0 && (
                          <Badge variant="secondary" className="text-xs gap-1">
                            <Link2 className="size-3" />
                            {contact.endpoints!.length} endpoint
                            {contact.endpoints!.length !== 1 ? 's' : ''}
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            /* List View */
            <Card data-testid="contacts-list">
              <CardContent className="p-0">
                <div className="divide-y">
                  {sortedContacts.map((contact) => {
                    const email = getEndpointValue(contact, 'email');
                    const phone = getEndpointValue(contact, 'phone');
                    const name = displayName(contact);
                    const initials = contactInitials(contact);
                    const isOrg = contact.contact_kind && contact.contact_kind !== 'person';
                    const tags = Array.isArray(contact.tags) ? contact.tags : [];
                    return (
                      <div
                        key={contact.id}
                        data-testid="contact-row"
                        className="w-full p-4 text-left hover:bg-muted/50 transition-colors flex items-center gap-3"
                      >
                        {/* #1713: Checkbox */}
                        <div onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(contact.id)}
                            onCheckedChange={() => handleToggleSelect(contact.id)}
                            aria-label={`Select ${name}`}
                          />
                        </div>
                        <button
                          onClick={() => handleContactClick(contact)}
                          className="flex-1 flex items-center gap-3 text-left"
                        >
                          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                            {initials}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-foreground truncate">{name}</p>
                              {isOrg && contact.contact_kind && (
                                <Badge variant="outline" className="text-xs shrink-0">
                                  {CONTACT_KIND_LABELS[contact.contact_kind]}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5">
                              {email && (
                                <span className="flex items-center gap-1 truncate">
                                  <Mail className="size-3 shrink-0" />
                                  {email}
                                </span>
                              )}
                              {phone && (
                                <span className="flex items-center gap-1 truncate">
                                  <Phone className="size-3 shrink-0" />
                                  {phone}
                                </span>
                              )}
                            </div>
                            {/* #1705: Tags */}
                            {tags.length > 0 && (
                              <div className="flex items-center gap-1 mt-1 flex-wrap">
                                {tags.map((tag) => (
                                  <Badge key={tag} variant="secondary" className="text-xs">
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                          <Badge variant="secondary" className="shrink-0">
                            {contact.endpoints?.length ?? 0} endpoint
                            {(contact.endpoints?.length ?? 0) !== 1 ? 's' : ''}
                          </Badge>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </ScrollArea>
      )}

      {/* Contact Detail Sheet (slide-out panel) */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-96 sm:max-w-md" data-testid="contact-detail-sheet">
          <SheetHeader>
            <SheetTitle className="sr-only">Contact Details</SheetTitle>
            <SheetDescription className="sr-only">View contact information and endpoints</SheetDescription>
          </SheetHeader>

          {selectedContact && (
            <ScrollArea className="h-full">
              <div className="space-y-6 pb-6">
                {/* Header */}
                <div className="flex items-start gap-4">
                  <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-xl font-medium text-primary">
                    {contactInitials(selectedContact)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold">{displayName(selectedContact)}</h2>
                    {getEndpointValue(selectedContact, 'email') && (
                      <p className="text-sm text-muted-foreground">{getEndpointValue(selectedContact, 'email')}</p>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleNavigateToDetail(selectedContact)} data-testid="view-full-detail">
                    View Full Profile
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleEdit(selectedContact)}>
                    Edit
                  </Button>
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDeleteContact(selectedContact)}>
                    Delete
                  </Button>
                </div>

                <Separator />

                {/* Notes */}
                {selectedContact.notes && (
                  <>
                    <div>
                      <h3 className="text-sm font-medium mb-2">Notes</h3>
                      <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">{selectedContact.notes}</p>
                    </div>
                    <Separator />
                  </>
                )}

                {/* Endpoints */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium">Endpoints</h3>
                    <Badge variant="secondary" className="text-xs">
                      {selectedContact.endpoints?.length ?? 0}
                    </Badge>
                  </div>
                  {(selectedContact.endpoints?.length ?? 0) > 0 ? (
                    <div className="space-y-2">
                      {selectedContact.endpoints!.map((ep, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-sm p-2 rounded-md bg-muted/30">
                          {ep.type === 'email' && <Mail className="size-4 text-muted-foreground" />}
                          {ep.type === 'phone' && <Phone className="size-4 text-muted-foreground" />}
                          {ep.type !== 'email' && ep.type !== 'phone' && (
                            <Badge variant="outline" className="text-xs">
                              {ep.type}
                            </Badge>
                          )}
                          <span className="text-foreground">{ep.value}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground py-4 text-center">No endpoints</p>
                  )}
                </div>
              </div>
            </ScrollArea>
          )}
        </SheetContent>
      </Sheet>

      {/* #1701: Create/Edit Contact Dialog with structured name fields */}
      <ContactFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingContact(null);
        }}
        contact={editingContact}
        isSubmitting={isSubmitting}
        onSubmit={(body) => {
          if (editingContact) {
            handleUpdateContact(body);
          } else {
            handleCreateContact(body);
          }
        }}
      />

      {/* #1709: Contact Merge Dialog */}
      <ContactMergeDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        contacts={sortedContacts}
        onMergeComplete={() => refetch()}
      />

      {/* #1711: Import Dialog */}
      <ContactImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImportComplete={() => refetch()}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// #1701: ContactFormDialog with structured name fields + contact kind
// ---------------------------------------------------------------------------

interface ContactFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: Contact | null;
  isSubmitting: boolean;
  onSubmit: (body: CreateContactBody) => void;
}

function ContactFormDialog({ open, onOpenChange, contact, isSubmitting, onSubmit }: ContactFormDialogProps) {
  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [nickname, setNickname] = useState('');
  const [displayNameField, setDisplayNameField] = useState('');
  const [contactKind, setContactKind] = useState<ContactKind>('person');
  const [notes, setNotes] = useState('');

  // Reset form when dialog opens/closes or contact changes
  React.useEffect(() => {
    if (open) {
      setGivenName(contact?.given_name ?? '');
      setFamilyName(contact?.family_name ?? '');
      setMiddleName(contact?.middle_name ?? '');
      setPrefix(contact?.name_prefix ?? '');
      setSuffix(contact?.name_suffix ?? '');
      setNickname(contact?.nickname ?? '');
      setDisplayNameField(contact?.display_name ?? '');
      setContactKind(contact?.contact_kind ?? 'person');
      setNotes(contact?.notes ?? '');
    }
  }, [open, contact]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: CreateContactBody = {
      contact_kind: contactKind,
      notes: notes.trim() || undefined,
    };

    if (contactKind === 'person') {
      body.given_name = givenName.trim() || undefined;
      body.family_name = familyName.trim() || undefined;
      body.middle_name = middleName.trim() || undefined;
      body.name_prefix = prefix.trim() || undefined;
      body.name_suffix = suffix.trim() || undefined;
      body.nickname = nickname.trim() || undefined;
      // Compute display_name from structured fields if not explicitly set
      const computed = [givenName.trim(), familyName.trim()].filter(Boolean).join(' ');
      body.display_name = displayNameField.trim() || computed || undefined;
    } else {
      // Non-person contacts use display_name directly
      body.display_name = displayNameField.trim() || undefined;
    }

    onSubmit(body);
  };

  const isValid = contactKind === 'person'
    ? (givenName.trim().length > 0 || familyName.trim().length > 0 || displayNameField.trim().length > 0)
    : displayNameField.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="contact-form-dialog">
        <DialogHeader>
          <DialogTitle>{contact ? 'Edit Contact' : 'Add Contact'}</DialogTitle>
          <DialogDescription>{contact ? 'Update the contact details below.' : 'Fill in the details to add a new contact.'}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Contact Kind selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Type</label>
            <Select value={contactKind} onValueChange={(v) => setContactKind(v as ContactKind)}>
              <SelectTrigger data-testid="contact-kind-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="person">Person</SelectItem>
                <SelectItem value="organisation">Organisation</SelectItem>
                <SelectItem value="group">Group</SelectItem>
                <SelectItem value="agent">Agent</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {contactKind === 'person' ? (
            <>
              {/* Structured name fields */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label htmlFor="contact-given-name" className="text-sm font-medium">
                    First Name
                  </label>
                  <Input
                    id="contact-given-name"
                    value={givenName}
                    onChange={(e) => setGivenName(e.target.value)}
                    placeholder="Alice"
                    data-testid="contact-given-name"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="contact-family-name" className="text-sm font-medium">
                    Last Name
                  </label>
                  <Input
                    id="contact-family-name"
                    value={familyName}
                    onChange={(e) => setFamilyName(e.target.value)}
                    placeholder="Johnson"
                    data-testid="contact-family-name"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <label htmlFor="contact-prefix" className="text-sm font-medium text-muted-foreground">
                    Prefix
                  </label>
                  <Input
                    id="contact-prefix"
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                    placeholder="Dr."
                    data-testid="contact-prefix"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="contact-middle-name" className="text-sm font-medium text-muted-foreground">
                    Middle Name
                  </label>
                  <Input
                    id="contact-middle-name"
                    value={middleName}
                    onChange={(e) => setMiddleName(e.target.value)}
                    placeholder="Marie"
                    data-testid="contact-middle-name"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="contact-suffix" className="text-sm font-medium text-muted-foreground">
                    Suffix
                  </label>
                  <Input
                    id="contact-suffix"
                    value={suffix}
                    onChange={(e) => setSuffix(e.target.value)}
                    placeholder="PhD"
                    data-testid="contact-suffix"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="contact-nickname" className="text-sm font-medium text-muted-foreground">
                  Nickname
                </label>
                <Input
                  id="contact-nickname"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="Al"
                  data-testid="contact-nickname"
                />
              </div>
            </>
          ) : (
            /* Non-person: just display_name */
            <div className="space-y-2">
              <label htmlFor="contact-display-name" className="text-sm font-medium">
                Name <span className="text-destructive">*</span>
              </label>
              <Input
                id="contact-display-name"
                value={displayNameField}
                onChange={(e) => setDisplayNameField(e.target.value)}
                placeholder={contactKind === 'organisation' ? 'Acme Corp' : 'Team Alpha'}
                required
                data-testid="contact-name-input"
              />
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="contact-notes" className="text-sm font-medium">
              Notes
            </label>
            <Textarea
              id="contact-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes about this contact..."
              rows={3}
              data-testid="contact-notes-input"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid || isSubmitting} data-testid="contact-form-submit">
              {contact ? 'Save Changes' : 'Add Contact'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// #1709: Contact Merge Dialog
// ---------------------------------------------------------------------------

interface ContactMergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: Contact[];
  onMergeComplete: () => void;
}

function ContactMergeDialog({ open, onOpenChange, contacts, onMergeComplete }: ContactMergeDialogProps) {
  const [survivorId, setSurvivorId] = useState<string>('');
  const [loserId, setLoserId] = useState<string>('');
  const mergeMutation = useMergeContacts();

  React.useEffect(() => {
    if (open) {
      setSurvivorId('');
      setLoserId('');
    }
  }, [open]);

  const handleMerge = async () => {
    if (!survivorId || !loserId || survivorId === loserId) return;
    try {
      await mergeMutation.mutateAsync({ survivor_id: survivorId, loser_id: loserId });
      onOpenChange(false);
      onMergeComplete();
    } catch (err) {
      console.error('Failed to merge contacts:', err);
    }
  };

  const survivor = contacts.find((c) => c.id === survivorId);
  const loser = contacts.find((c) => c.id === loserId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="merge-dialog">
        <DialogHeader>
          <DialogTitle>Merge Contacts</DialogTitle>
          <DialogDescription>Select two contacts to merge. The survivor keeps all data; the other is removed.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Keep (Survivor)</label>
            <Select value={survivorId} onValueChange={setSurvivorId}>
              <SelectTrigger data-testid="merge-survivor-select">
                <SelectValue placeholder="Select contact to keep" />
              </SelectTrigger>
              <SelectContent>
                {contacts.map((c) => (
                  <SelectItem key={c.id} value={c.id} disabled={c.id === loserId}>
                    {displayName(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Remove (Merge Into Survivor)</label>
            <Select value={loserId} onValueChange={setLoserId}>
              <SelectTrigger data-testid="merge-loser-select">
                <SelectValue placeholder="Select contact to merge" />
              </SelectTrigger>
              <SelectContent>
                {contacts.map((c) => (
                  <SelectItem key={c.id} value={c.id} disabled={c.id === survivorId}>
                    {displayName(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {survivor && loser && (
            <div className="grid grid-cols-2 gap-4 p-3 bg-muted/50 rounded-md">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Keeping</p>
                <p className="text-sm font-medium">{displayName(survivor)}</p>
                <p className="text-xs text-muted-foreground">{survivor.endpoints?.length ?? 0} endpoints</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Removing</p>
                <p className="text-sm font-medium">{displayName(loser)}</p>
                <p className="text-xs text-muted-foreground">{loser.endpoints?.length ?? 0} endpoints</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleMerge}
            disabled={!survivorId || !loserId || survivorId === loserId || mergeMutation.isPending}
          >
            {mergeMutation.isPending ? <><Loader2 className="mr-2 size-4 animate-spin" />Merging...</> : 'Merge Contacts'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// #1711: Contact Import Dialog
// ---------------------------------------------------------------------------

interface ContactImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete: () => void;
}

function ContactImportDialog({ open, onOpenChange, onImportComplete }: ContactImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const importMutation = useImportContacts();
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setFile(null);
      setResult(null);
    }
  }, [open]);

  const handleImport = async () => {
    if (!file) return;
    try {
      const text = await file.text();
      let contacts: Array<Record<string, unknown>>;
      if (file.name.endsWith('.json')) {
        contacts = JSON.parse(text);
      } else {
        // Simple CSV parsing
        const lines = text.split('\n').filter((l) => l.trim());
        if (lines.length < 2) return;
        const headers = lines[0].split(',').map((h) => h.trim());
        contacts = lines.slice(1).map((line) => {
          const values = line.split(',').map((v) => v.trim());
          const obj: Record<string, unknown> = {};
          headers.forEach((h, i) => {
            obj[h] = values[i] ?? '';
          });
          return obj;
        });
      }
      const res = await importMutation.mutateAsync({ contacts });
      setResult(res);
      onImportComplete();
    } catch (err) {
      console.error('Failed to import contacts:', err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="import-dialog">
        <DialogHeader>
          <DialogTitle>Import Contacts</DialogTitle>
          <DialogDescription>Upload a CSV or JSON file to import contacts.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm"
              data-testid="import-file-input"
            />
          </div>

          {result && (
            <div className="text-sm p-3 bg-muted/50 rounded-md">
              <p>Created: {result.created}</p>
              <p>Updated: {result.updated}</p>
              {result.skipped > 0 && <p>Skipped: {result.skipped}</p>}
              {result.failed > 0 && <p className="text-destructive">Failed: {result.failed}</p>}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={!file || importMutation.isPending}>
            {importMutation.isPending ? <><Loader2 className="mr-2 size-4 animate-spin" />Importing...</> : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
