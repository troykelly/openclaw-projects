/**
 * Input with mention autocomplete support
 * Issue #400: Implement @mention support with notifications
 */
import * as React from 'react';
import { cn } from '@/ui/lib/utils';
import { Textarea } from '@/ui/components/ui/textarea';
import { MentionAutocomplete } from './mention-autocomplete';
import {
  createMentionToken,
  findMentionTrigger,
  filterUsers,
  type MentionUser,
} from './mention-utils';

export interface MentionInputProps {
  users: MentionUser[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  rows?: number;
}

export function MentionInput({
  users,
  value,
  onChange,
  placeholder,
  className,
  disabled = false,
  rows = 3,
}: MentionInputProps) {
  const [showAutocomplete, setShowAutocomplete] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [triggerStart, setTriggerStart] = React.useState<number | null>(null);
  const [highlightedIndex, setHighlightedIndex] = React.useState(0);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const filteredUsers = filterUsers(users, query);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart;

    onChange(newValue);

    // Check for mention trigger
    const trigger = findMentionTrigger(newValue, cursorPos);

    if (trigger) {
      setShowAutocomplete(true);
      setQuery(trigger.query);
      setTriggerStart(trigger.start);
      setHighlightedIndex(0);
    } else {
      setShowAutocomplete(false);
      setQuery('');
      setTriggerStart(null);
    }
  };

  const handleSelectUser = (user: MentionUser) => {
    if (triggerStart === null) return;

    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const before = value.slice(0, triggerStart);
    const after = value.slice(cursorPos);
    const mentionToken = createMentionToken(user);

    const newValue = before + mentionToken + ' ' + after;
    onChange(newValue);

    setShowAutocomplete(false);
    setQuery('');
    setTriggerStart(null);

    // Focus textarea and set cursor after mention
    setTimeout(() => {
      textarea.focus();
      const newPos = triggerStart + mentionToken.length + 1;
      textarea.setSelectionRange(newPos, newPos);
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showAutocomplete) return;

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        setShowAutocomplete(false);
        break;

      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < filteredUsers.length - 1 ? prev + 1 : prev
        );
        break;

      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        break;

      case 'Enter':
      case 'Tab':
        if (filteredUsers.length > 0) {
          e.preventDefault();
          handleSelectUser(filteredUsers[highlightedIndex]);
        }
        break;
    }
  };

  return (
    <div className={cn('relative', className)}>
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        className="resize-none"
      />

      <MentionAutocomplete
        users={users}
        onSelect={handleSelectUser}
        onNavigate={setHighlightedIndex}
        query={query}
        visible={showAutocomplete}
        highlightedIndex={highlightedIndex}
        className="top-full left-0 mt-1 min-w-[200px]"
      />
    </div>
  );
}
