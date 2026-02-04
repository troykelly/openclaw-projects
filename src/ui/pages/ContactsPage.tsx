/**
 * Contacts list page.
 *
 * Displays a searchable list of contacts with a slide-out detail panel,
 * create/edit form, and delete confirmation. Uses the typed API client
 * for all contact CRUD operations.
 */
import React, { useState, useCallback, useEffect } from 'react';
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
import { Badge } from '@/ui/components/ui/badge';
import { Card, CardContent } from '@/ui/components/ui/card';
import { ScrollArea } from '@/ui/components/ui/scroll-area';

/** Get primary email from contact endpoints. */
function getPrimaryEmail(contact: Contact): string | null {
  const emailEndpoint = contact.endpoints.find((e) => e.type === 'email');
  return emailEndpoint?.value || null;
}

export function ContactsPage(): React.JSX.Element {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'loaded'; contacts: Contact[]; total: number }
  >({ kind: 'loading' });

  const [search, setSearch] = useState('');
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchContacts = useCallback(async (searchQuery?: string) => {
    try {
      const url = searchQuery
        ? `/api/contacts?search=${encodeURIComponent(searchQuery)}`
        : '/api/contacts';
      const data = await apiClient.get<ContactsResponse>(url);
      setState({ kind: 'loaded', contacts: data.contacts, total: data.total });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setState({ kind: 'error', message });
    }
  }, []);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchContacts(search || undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, fetchContacts]);

  const handleContactClick = (contact: Contact) => {
    setSelectedContact(contact);
    setDetailOpen(true);
  };

  const handleCreateContact = async (data: ContactBody) => {
    setIsSubmitting(true);
    try {
      await apiClient.post('/api/contacts', data);
      setFormOpen(false);
      fetchContacts(search || undefined);
    } catch (err) {
      console.error('Failed to create contact:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateContact = async (data: ContactBody) => {
    if (!editingContact) return;
    setIsSubmitting(true);
    try {
      await apiClient.patch(`/api/contacts/${editingContact.id}`, data);
      setFormOpen(false);
      setEditingContact(null);
      setDetailOpen(false);
      fetchContacts(search || undefined);
    } catch (err) {
      console.error('Failed to update contact:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteContact = async (contact: Contact) => {
    if (!confirm(`Delete contact "${contact.display_name}"?`)) return;
    try {
      await apiClient.delete(`/api/contacts/${contact.id}`);
      setDetailOpen(false);
      setSelectedContact(null);
      fetchContacts(search || undefined);
    } catch (err) {
      console.error('Failed to delete contact:', err);
    }
  };

  const handleEdit = (contact: Contact) => {
    setEditingContact(contact);
    setDetailOpen(false);
    setFormOpen(true);
  };

  const handleAddNew = () => {
    setEditingContact(null);
    setFormOpen(true);
  };

  if (state.kind === 'loading') {
    return (
      <div data-testid="page-contacts" className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <Skeleton width={200} height={32} />
          <Skeleton width={120} height={36} />
        </div>
        <Skeleton width="100%" height={40} className="mb-4" />
        <SkeletonList count={5} variant="card" />
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div data-testid="page-contacts" className="p-6">
        <ErrorState
          type="generic"
          title="Failed to load contacts"
          description={state.message}
          onRetry={() => {
            setState({ kind: 'loading' });
            fetchContacts();
          }}
        />
      </div>
    );
  }

  return (
    <div data-testid="page-contacts" className="p-6 h-full flex flex-col">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">People</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {state.total} contact{state.total !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={handleAddNew}>Add Contact</Button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search contacts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md px-4 py-2 border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Contacts List */}
      {state.contacts.length === 0 ? (
        <Card>
          <CardContent className="p-8">
            <EmptyState
              variant="no-data"
              title={search ? 'No contacts found' : 'No contacts yet'}
              description={
                search
                  ? 'Try a different search term.'
                  : 'Add your first contact to get started.'
              }
              action={
                !search
                  ? { label: 'Add Contact', onClick: handleAddNew }
                  : undefined
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card className="flex-1">
          <CardContent className="p-0">
            <ScrollArea className="h-[calc(100vh-280px)]">
              <div className="divide-y">
                {state.contacts.map((contact) => {
                  const email = getPrimaryEmail(contact);
                  return (
                    <button
                      key={contact.id}
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
                        {email && (
                          <p className="text-sm text-muted-foreground truncate">{email}</p>
                        )}
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        {contact.endpoints.length} endpoint
                        {contact.endpoints.length !== 1 ? 's' : ''}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Contact Detail Sheet */}
      {selectedContact && (
        <div
          className={`fixed inset-0 z-50 ${detailOpen ? '' : 'pointer-events-none'}`}
        >
          <div
            className={`absolute inset-0 bg-black/50 transition-opacity ${
              detailOpen ? 'opacity-100' : 'opacity-0'
            }`}
            onClick={() => setDetailOpen(false)}
          />
          <div
            className={`absolute right-0 top-0 h-full w-96 max-w-full bg-background shadow-lg transform transition-transform ${
              detailOpen ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            <div className="p-6 h-full overflow-auto">
              <div className="flex items-start gap-4 mb-6">
                <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-xl font-medium text-primary">
                  {getInitials(selectedContact.display_name)}
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-semibold">
                    {selectedContact.display_name}
                  </h2>
                  {getPrimaryEmail(selectedContact) && (
                    <p className="text-sm text-muted-foreground">
                      {getPrimaryEmail(selectedContact)}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-2 mb-6">
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

              {selectedContact.notes && (
                <div className="mb-6">
                  <h3 className="text-sm font-medium mb-2">Notes</h3>
                  <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
                    {selectedContact.notes}
                  </p>
                </div>
              )}

              <div>
                <h3 className="text-sm font-medium mb-2">Endpoints</h3>
                {selectedContact.endpoints.length > 0 ? (
                  <div className="space-y-2">
                    {selectedContact.endpoints.map((ep, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <Badge variant="outline" className="text-xs">
                          {ep.type}
                        </Badge>
                        <span className="text-muted-foreground">{ep.value}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No endpoints</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Contact Form Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setFormOpen(false)}
          />
          <div className="relative bg-background rounded-lg shadow-lg p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-semibold mb-4">
              {editingContact ? 'Edit Contact' : 'Add Contact'}
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const body: ContactBody = {
                  displayName: formData.get('displayName') as string,
                  notes: (formData.get('notes') as string) || undefined,
                };
                if (editingContact) {
                  handleUpdateContact(body);
                } else {
                  handleCreateContact(body);
                }
              }}
            >
              <div className="space-y-4">
                <div>
                  <label htmlFor="displayName" className="block text-sm font-medium mb-1">
                    Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    id="displayName"
                    name="displayName"
                    type="text"
                    required
                    defaultValue={editingContact?.display_name || ''}
                    className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="John Doe"
                  />
                </div>
                <div>
                  <label htmlFor="notes" className="block text-sm font-medium mb-1">
                    Notes
                  </label>
                  <textarea
                    id="notes"
                    name="notes"
                    rows={3}
                    defaultValue={editingContact?.notes || ''}
                    className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Additional notes..."
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {editingContact ? 'Save Changes' : 'Add Contact'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
