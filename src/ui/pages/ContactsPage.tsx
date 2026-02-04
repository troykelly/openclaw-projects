/**
 * Contacts list page.
 *
 * Displays a searchable, sortable grid of contact cards with avatar,
 * name, email, phone, company, role, and linked item counts. Supports
 * creating and editing contacts via a dialog, viewing details in a
 * slide-out sheet, and navigating to the full contact detail page.
 *
 * Uses the typed API client and TanStack Query hooks for data fetching.
 */
import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router';
import {
  Search,
  UserPlus,
  ArrowUpDown,
  Grid3X3,
  List,
  Mail,
  Phone,
  Building,
  Briefcase,
  Link2,
} from 'lucide-react';
import { apiClient } from '@/ui/lib/api-client';
import type { Contact, ContactsResponse, ContactBody } from '@/ui/lib/api-types';
import { getInitials } from '@/ui/lib/work-item-utils';
import {
  Skeleton,
  SkeletonList,
  ErrorState,
  EmptyState,
} from '@/ui/components/feedback';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Badge } from '@/ui/components/ui/badge';
import { Card, CardContent } from '@/ui/components/ui/card';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { Separator } from '@/ui/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/ui/components/ui/dialog';
import { Textarea } from '@/ui/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/ui/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/components/ui/dropdown-menu';
import { useContacts } from '@/ui/hooks/queries/use-contacts';

/** Sort options for the contacts list. */
type SortField = 'name' | 'recent' | 'endpoints';

/** View mode for the contacts list. */
type ViewMode = 'grid' | 'list';

/** Get primary endpoint value by type. */
function getEndpointValue(contact: Contact, type: string): string | null {
  const ep = contact.endpoints.find((e) => e.type === type);
  return ep?.value ?? null;
}

/** Sort contacts by the chosen field. */
function sortContacts(contacts: Contact[], field: SortField): Contact[] {
  const sorted = [...contacts];
  switch (field) {
    case 'name':
      return sorted.sort((a, b) =>
        a.display_name.localeCompare(b.display_name),
      );
    case 'recent':
      return sorted.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    case 'endpoints':
      return sorted.sort(
        (a, b) => b.endpoints.length - a.endpoints.length,
      );
    default:
      return sorted;
  }
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  // Debounced search with TanStack Query
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useContacts(debouncedSearch || undefined);

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
      navigate(`/people/${contact.id}`);
    },
    [navigate],
  );

  const handleCreateContact = useCallback(
    async (body: ContactBody) => {
      setIsSubmitting(true);
      try {
        await apiClient.post('/api/contacts', body);
        setFormOpen(false);
        setEditingContact(null);
        refetch();
      } catch (err) {
        console.error('Failed to create contact:', err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [refetch],
  );

  const handleUpdateContact = useCallback(
    async (body: ContactBody) => {
      if (!editingContact) return;
      setIsSubmitting(true);
      try {
        await apiClient.patch(`/api/contacts/${editingContact.id}`, body);
        setFormOpen(false);
        setEditingContact(null);
        setDetailOpen(false);
        setSelectedContact(null);
        refetch();
      } catch (err) {
        console.error('Failed to update contact:', err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [editingContact, refetch],
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
        <Button onClick={handleAddNew} data-testid="add-contact-button">
          <UserPlus className="mr-2 size-4" />
          Add Contact
        </Button>
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
          {/* Sort */}
          <Select
            value={sortField}
            onValueChange={(v) => setSortField(v as SortField)}
          >
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

      {/* Contacts List / Grid */}
      {sortedContacts.length === 0 ? (
        <Card>
          <CardContent className="p-8">
            <EmptyState
              variant="contacts"
              title={search ? 'No contacts found' : 'No contacts yet'}
              description={
                search
                  ? 'Try a different search term.'
                  : 'Add your first contact to get started.'
              }
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
                return (
                  <Card
                    key={contact.id}
                    data-testid="contact-card"
                    className="cursor-pointer transition-colors hover:bg-muted/50"
                    onClick={() => handleContactClick(contact)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                          {getInitials(contact.display_name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-medium text-foreground truncate">
                            {contact.display_name}
                          </h3>
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
                      {contact.endpoints.length > 0 && (
                        <div className="mt-3 flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs gap-1">
                            <Link2 className="size-3" />
                            {contact.endpoints.length} endpoint
                            {contact.endpoints.length !== 1 ? 's' : ''}
                          </Badge>
                        </div>
                      )}
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
                    return (
                      <button
                        key={contact.id}
                        data-testid="contact-row"
                        onClick={() => handleContactClick(contact)}
                        className="w-full p-4 text-left hover:bg-muted/50 transition-colors flex items-center gap-3"
                      >
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                          {getInitials(contact.display_name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground truncate">
                            {contact.display_name}
                          </p>
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
                        </div>
                        <Badge variant="secondary" className="shrink-0">
                          {contact.endpoints.length} endpoint
                          {contact.endpoints.length !== 1 ? 's' : ''}
                        </Badge>
                      </button>
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
            <SheetDescription className="sr-only">
              View contact information and endpoints
            </SheetDescription>
          </SheetHeader>

          {selectedContact && (
            <ScrollArea className="h-full">
              <div className="space-y-6 pb-6">
                {/* Header */}
                <div className="flex items-start gap-4">
                  <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-xl font-medium text-primary">
                    {getInitials(selectedContact.display_name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold">
                      {selectedContact.display_name}
                    </h2>
                    {getEndpointValue(selectedContact, 'email') && (
                      <p className="text-sm text-muted-foreground">
                        {getEndpointValue(selectedContact, 'email')}
                      </p>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleNavigateToDetail(selectedContact)}
                    data-testid="view-full-detail"
                  >
                    View Full Profile
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(selectedContact)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDeleteContact(selectedContact)}
                  >
                    Delete
                  </Button>
                </div>

                <Separator />

                {/* Notes */}
                {selectedContact.notes && (
                  <>
                    <div>
                      <h3 className="text-sm font-medium mb-2">Notes</h3>
                      <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
                        {selectedContact.notes}
                      </p>
                    </div>
                    <Separator />
                  </>
                )}

                {/* Endpoints */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium">Endpoints</h3>
                    <Badge variant="secondary" className="text-xs">
                      {selectedContact.endpoints.length}
                    </Badge>
                  </div>
                  {selectedContact.endpoints.length > 0 ? (
                    <div className="space-y-2">
                      {selectedContact.endpoints.map((ep, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 text-sm p-2 rounded-md bg-muted/30"
                        >
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
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      No endpoints
                    </p>
                  )}
                </div>
              </div>
            </ScrollArea>
          )}
        </SheetContent>
      </Sheet>

      {/* Create/Edit Contact Dialog */}
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContactFormDialog - extracted to keep the page component readable
// ---------------------------------------------------------------------------

interface ContactFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: Contact | null;
  isSubmitting: boolean;
  onSubmit: (body: ContactBody) => void;
}

function ContactFormDialog({
  open,
  onOpenChange,
  contact,
  isSubmitting,
  onSubmit,
}: ContactFormDialogProps) {
  const [displayName, setDisplayName] = useState('');
  const [notes, setNotes] = useState('');

  // Reset form when dialog opens/closes or contact changes
  React.useEffect(() => {
    if (open) {
      setDisplayName(contact?.display_name ?? '');
      setNotes(contact?.notes ?? '');
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
      <DialogContent className="sm:max-w-md" data-testid="contact-form-dialog">
        <DialogHeader>
          <DialogTitle>{contact ? 'Edit Contact' : 'Add Contact'}</DialogTitle>
          <DialogDescription>
            {contact
              ? 'Update the contact details below.'
              : 'Fill in the details to add a new contact.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="contact-name" className="text-sm font-medium">
              Name <span className="text-destructive">*</span>
            </label>
            <Input
              id="contact-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="John Doe"
              required
              data-testid="contact-name-input"
            />
          </div>

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
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!isValid || isSubmitting}
              data-testid="contact-form-submit"
            >
              {contact ? 'Save Changes' : 'Add Contact'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
