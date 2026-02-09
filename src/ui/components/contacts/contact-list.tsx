import * as React from 'react';
import { useState, useMemo } from 'react';
import { Search, Plus, UserPlus } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { ContactCard } from './contact-card';
import type { Contact } from './types';

export interface ContactListProps {
  contacts: Contact[];
  onContactClick?: (contact: Contact) => void;
  onAddContact?: () => void;
  className?: string;
}

export function ContactList({ contacts, onContactClick, onAddContact, className }: ContactListProps) {
  const [search, setSearch] = useState('');

  const filteredContacts = useMemo(() => {
    if (!search.trim()) return contacts;

    const query = search.toLowerCase();
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        c.email.toLowerCase().includes(query) ||
        c.company?.toLowerCase().includes(query) ||
        c.role?.toLowerCase().includes(query),
    );
  }, [contacts, search]);

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-lg font-semibold">Contacts</h2>
        {onAddContact && (
          <Button size="sm" onClick={onAddContact}>
            <UserPlus className="mr-1 size-4" />
            Add Contact
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="border-b p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search contacts..." className="pl-9" />
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-4">
          {filteredContacts.map((contact) => (
            <ContactCard key={contact.id} contact={contact} onClick={onContactClick} />
          ))}

          {filteredContacts.length === 0 && (
            <div className="py-12 text-center">
              <UserPlus className="mx-auto size-12 text-muted-foreground/50" />
              <p className="mt-4 text-muted-foreground">{search ? 'No contacts found' : 'No contacts yet'}</p>
              {!search && onAddContact && (
                <Button variant="outline" size="sm" className="mt-4" onClick={onAddContact}>
                  Add your first contact
                </Button>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
