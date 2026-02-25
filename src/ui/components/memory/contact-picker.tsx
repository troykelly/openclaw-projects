/**
 * Contact picker for linking memories to contacts.
 * Issue #1751: Memory contact/relationship scoping
 */
import * as React from 'react';
import { User, X } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/components/ui/popover';
import { Input } from '@/ui/components/ui/input';
import { ScrollArea } from '@/ui/components/ui/scroll-area';

export interface ContactOption {
  id: string;
  display_name: string;
}

export interface ContactPickerProps {
  contacts: ContactOption[];
  selectedContactId: string | null;
  onSelect: (contactId: string | null) => void;
  className?: string;
}

export function ContactPicker({ contacts, selectedContactId, onSelect, className }: ContactPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const selectedContact = selectedContactId ? contacts.find((c) => c.id === selectedContactId) : null;

  const filtered = React.useMemo(() => {
    if (!search.trim()) return contacts;
    const q = search.toLowerCase();
    return contacts.filter((c) => c.display_name.toLowerCase().includes(q));
  }, [contacts, search]);

  const handleSelect = (contactId: string) => {
    onSelect(contactId);
    setOpen(false);
    setSearch('');
  };

  const handleClear = () => {
    onSelect(null);
  };

  return (
    <div className={className}>
      {selectedContact ? (
        <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm" data-testid="selected-contact">
          <User className="size-4 text-muted-foreground" />
          <span className="flex-1">{selectedContact.display_name}</span>
          <Button variant="ghost" size="icon" className="size-6" onClick={handleClear}>
            <X className="size-3" />
          </Button>
        </div>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="w-full justify-start text-muted-foreground" data-testid="contact-picker-trigger">
              <User className="mr-2 size-4" />
              Link to contact...
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start">
            <div className="p-2 border-b">
              <Input
                placeholder="Search contacts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8"
                data-testid="contact-picker-search"
              />
            </div>
            <ScrollArea className="max-h-48">
              <div className="p-1" role="listbox">
                {filtered.map((contact) => (
                  <button
                    key={contact.id}
                    role="option"
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-muted transition-colors text-left"
                    onClick={() => handleSelect(contact.id)}
                  >
                    <User className="size-3 text-muted-foreground" />
                    <span className="truncate">{contact.display_name}</span>
                  </button>
                ))}
                {filtered.length === 0 && (
                  <div className="px-2 py-4 text-center text-sm text-muted-foreground">No contacts found</div>
                )}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
