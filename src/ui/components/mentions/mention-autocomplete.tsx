/**
 * Mention autocomplete dropdown
 * Issue #400: Implement @mention support with notifications
 */
import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { filterUsers, getInitials, type MentionUser } from './mention-utils';

export interface MentionAutocompleteProps {
  users: MentionUser[];
  onSelect: (user: MentionUser) => void;
  onNavigate?: (index: number) => void;
  query: string;
  visible: boolean;
  highlightedIndex?: number;
  loading?: boolean;
  className?: string;
}

export function MentionAutocomplete({
  users,
  onSelect,
  onNavigate,
  query,
  visible,
  highlightedIndex = 0,
  loading = false,
  className,
}: MentionAutocompleteProps) {
  if (!visible) {
    return null;
  }

  const filteredUsers = filterUsers(users, query);

  if (loading) {
    return (
      <div
        data-testid="mention-loading"
        className={cn(
          'absolute z-50 bg-popover border rounded-md shadow-md p-2',
          className
        )}
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading users...</span>
        </div>
      </div>
    );
  }

  if (filteredUsers.length === 0) {
    return (
      <div
        className={cn(
          'absolute z-50 bg-popover border rounded-md shadow-md p-2',
          className
        )}
      >
        <div className="text-sm text-muted-foreground px-2 py-1">
          No users found
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'absolute z-50 bg-popover border rounded-md shadow-md py-1 max-h-60 overflow-y-auto',
        className
      )}
    >
      {filteredUsers.map((user, index) => {
        const isHighlighted = index === highlightedIndex;

        return (
          <button
            key={user.id}
            type="button"
            data-testid={`mention-option-${index}`}
            data-highlighted={isHighlighted}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors',
              isHighlighted ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
            )}
            onClick={() => onSelect(user)}
            onMouseEnter={() => onNavigate?.(index)}
          >
            {user.avatar ? (
              <img
                src={user.avatar}
                alt={user.name}
                className="h-6 w-6 rounded-full object-cover"
              />
            ) : (
              <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                {getInitials(user.name)}
              </div>
            )}
            <span>{user.name}</span>
          </button>
        );
      })}
    </div>
  );
}
