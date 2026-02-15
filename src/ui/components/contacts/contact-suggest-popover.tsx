/**
 * Popover for suggesting and linking contacts to unlinked messages (Issue #1270).
 *
 * Uses the command palette pattern for quick contact search and selection.
 */
import { Link2, Plus, UserSearch } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/ui/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/components/ui/popover';
import { apiClient } from '@/ui/lib/api-client';
import type { ContactMatch } from '@/ui/lib/api-types';
import { useContactSuggestMatch } from '@/ui/hooks/queries/use-contact-suggest-match';

interface ContactSuggestPopoverProps {
  /** The message ID to link. */
  messageId: string;
  /** Sender phone number, if available. */
  phone?: string;
  /** Sender email, if available. */
  email?: string;
  /** Sender name, if available. */
  name?: string;
  /** Called after a contact is successfully linked. */
  onLinked?: (contactId: string) => void;
}

export function ContactSuggestPopover({ messageId, phone, email, name, onLinked }: ContactSuggestPopoverProps) {
  const [open, setOpen] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const { data } = useContactSuggestMatch({ phone, email, name });
  const matches = data?.matches ?? [];

  const handleSelect = async (contactId: string) => {
    setIsLinking(true);
    try {
      await apiClient.post(`/api/messages/${messageId}/link-contact`, { contact_id: contactId });
      onLinked?.(contactId);
      setOpen(false);
    } catch (err) {
      console.error('Failed to link contact:', err);
    } finally {
      setIsLinking(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Badge
          variant="outline"
          className="cursor-pointer gap-1 hover:bg-accent transition-colors text-xs"
          data-testid="link-contact-badge"
        >
          <Link2 className="size-3" />
          Link contact?
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search contacts..." />
          <CommandList>
            <CommandEmpty>No contacts found.</CommandEmpty>
            {matches.length > 0 && (
              <CommandGroup heading="Suggested matches">
                {matches.map((match) => (
                  <ContactMatchItem
                    key={match.contact_id}
                    match={match}
                    disabled={isLinking}
                    onSelect={() => handleSelect(match.contact_id)}
                  />
                ))}
              </CommandGroup>
            )}
            <CommandGroup>
              <CommandItem disabled={isLinking}>
                <Plus className="size-4 mr-2" />
                Create new contact
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ContactMatchItem({
  match,
  disabled,
  onSelect,
}: {
  match: ContactMatch;
  disabled: boolean;
  onSelect: () => void;
}) {
  const primaryEndpoint = match.endpoints?.[0];

  return (
    <CommandItem onSelect={onSelect} disabled={disabled} data-testid="contact-match-item">
      <UserSearch className="size-4 mr-2 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{match.display_name}</div>
        {primaryEndpoint && (
          <div className="text-xs text-muted-foreground truncate">
            {primaryEndpoint.value}
          </div>
        )}
      </div>
      <Badge variant="secondary" className="ml-auto text-xs shrink-0">
        {Math.round(match.confidence * 100)}%
      </Badge>
    </CommandItem>
  );
}
