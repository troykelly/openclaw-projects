/**
 * Command Palette
 * Issue #475: Integrate command palette with router and global search
 *
 * Full-featured command palette with:
 * - Navigation commands (Dashboard, Projects, Activity, Contacts, Memory, Communications, Settings)
 * - Search work items by title (via existing API)
 * - Search contacts by name
 * - Actions: Create task, Toggle theme, Toggle sidebar
 * - Keyboard shortcut: Cmd+K / Ctrl+K
 */
import * as React from 'react';
import { useState, useEffect, useCallback } from 'react';
import {
  Bell,
  Folder,
  Calendar,
  Users,
  Search,
  Plus,
  FileText,
  User,
  Clock,
  Hash,
  LayoutDashboard,
  Brain,
  MessageSquare,
  Settings,
  Moon,
  Sun,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from '@/ui/components/ui/command';

export interface SearchResult {
  id: string;
  type: 'project' | 'issue' | 'contact' | 'epic' | 'initiative';
  title: string;
  subtitle?: string;
  href?: string;
}

export interface RecentItem {
  id: string;
  type: 'project' | 'issue' | 'contact';
  title: string;
  timestamp?: Date;
}

export interface CommandPaletteProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSearch?: (query: string) => Promise<SearchResult[]>;
  onSelect?: (result: SearchResult | string) => void;
  onNavigate?: (section: string) => void;
  onToggleTheme?: () => void;
  onToggleSidebar?: () => void;
  onCreateTask?: () => void;
  isDark?: boolean;
  sidebarCollapsed?: boolean;
  recentItems?: RecentItem[];
}

const STORAGE_KEY = 'command-palette-recent';
const MAX_RECENT = 5;

function getTypeIcon(type: string) {
  switch (type) {
    case 'project':
      return <Folder className="size-4" />;
    case 'issue':
      return <FileText className="size-4" />;
    case 'contact':
      return <User className="size-4" />;
    case 'epic':
      return <Hash className="size-4" />;
    case 'initiative':
      return <Folder className="size-4" />;
    default:
      return <FileText className="size-4" />;
  }
}

export function CommandPalette({
  open,
  onOpenChange,
  onSearch,
  onSelect,
  onNavigate,
  onToggleTheme,
  onToggleSidebar,
  onCreateTask,
  isDark = false,
  sidebarCollapsed = false,
  recentItems: propRecentItems,
}: CommandPaletteProps) {
  const [isOpen, setIsOpen] = useState(open ?? false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [recentItems, setRecentItems] = useState<RecentItem[]>(() => {
    if (propRecentItems) return propRecentItems;
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? (JSON.parse(stored) as RecentItem[]) : [];
    } catch {
      return [];
    }
  });

  // Sync with prop
  useEffect(() => {
    if (open !== undefined) {
      setIsOpen(open);
    }
  }, [open]);

  // Handle keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Debounced search
  useEffect(() => {
    if (!query.trim() || !onSearch) {
      setResults([]);
      return;
    }

    const timeoutId = setTimeout(async () => {
      setIsSearching(true);
      try {
        const searchResults = await onSearch(query);
        setResults(searchResults);
      } catch (error) {
        console.error('Search failed:', error);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [query, onSearch]);

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      setIsOpen(newOpen);
      onOpenChange?.(newOpen);
      if (!newOpen) {
        setQuery('');
        setResults([]);
      }
    },
    [onOpenChange],
  );

  const handleSelect = useCallback(
    (item: SearchResult | RecentItem) => {
      // Add to recent items
      const newRecent = [
        { id: item.id, type: item.type, title: item.title, timestamp: new Date() },
        ...recentItems.filter((r) => r.id !== item.id),
      ].slice(0, MAX_RECENT);

      setRecentItems(newRecent);
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newRecent));
      }

      onSelect?.(item as SearchResult);
      handleOpenChange(false);
    },
    [recentItems, onSelect, handleOpenChange],
  );

  const handleNavigate = useCallback(
    (section: string) => {
      onNavigate?.(section);
      handleOpenChange(false);
    },
    [onNavigate, handleOpenChange],
  );

  const handleAction = useCallback(
    (action: string) => {
      if (action === 'toggle-theme') {
        onToggleTheme?.();
        handleOpenChange(false);
        return;
      }
      if (action === 'toggle-sidebar') {
        onToggleSidebar?.();
        handleOpenChange(false);
        return;
      }
      if (action === 'create-task') {
        onCreateTask?.();
        handleOpenChange(false);
        return;
      }
      onSelect?.(action);
      handleOpenChange(false);
    },
    [onSelect, onToggleTheme, onToggleSidebar, onCreateTask, handleOpenChange],
  );

  // Parse type prefix from query
  const { typeFilter } = React.useMemo(() => {
    const prefixMatch = query.match(/^(@|#|!)(\S*)\s*(.*)/);
    if (prefixMatch) {
      const [, prefix] = prefixMatch;
      let type: string | undefined;
      if (prefix === '@') type = 'contact';
      else if (prefix === '#') type = 'project';
      else if (prefix === '!') type = 'issue';
      return { filteredQuery: prefixMatch[3] || '', typeFilter: type };
    }
    return { filteredQuery: query, typeFilter: undefined };
  }, [query]);

  // Filter results by type if prefix used
  const filteredResults = typeFilter
    ? results.filter((r) => r.type === typeFilter)
    : results;

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={handleOpenChange}
      title="Command Palette"
      description="Search for commands, projects, issues, or contacts"
      shouldFilter={false}
    >
      <CommandInput
        placeholder="Type a command or search..."
        value={query}
        onValueChange={setQuery}
        data-testid="command-palette-input"
      />
      <CommandList>
        <CommandEmpty>
          {isSearching ? 'Searching...' : 'No results found.'}
        </CommandEmpty>

        {/* Search Results */}
        {filteredResults.length > 0 && (
          <CommandGroup heading={typeFilter ? `${typeFilter}s` : 'Search Results'}>
            {filteredResults.map((result) => (
              <CommandItem
                key={`${result.type}-${result.id}`}
                value={`${result.type}-${result.id}-${result.title}`}
                onSelect={() => handleSelect(result)}
              >
                {getTypeIcon(result.type)}
                <div className="flex flex-col">
                  <span>{result.title}</span>
                  {result.subtitle && (
                    <span className="text-xs text-muted-foreground">
                      {result.subtitle}
                    </span>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Recent Items (shown when no query) */}
        {!query && recentItems.length > 0 && (
          <>
            <CommandGroup heading="Recent">
              {recentItems.map((item) => (
                <CommandItem
                  key={`recent-${item.type}-${item.id}`}
                  value={`recent-${item.type}-${item.id}-${item.title}`}
                  onSelect={() => handleSelect(item)}
                >
                  <Clock className="size-4 text-muted-foreground" />
                  {getTypeIcon(item.type)}
                  <span>{item.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {/* Navigation */}
        {!query && (
          <>
            <CommandGroup heading="Navigate">
              <CommandItem
                value="go-to-dashboard"
                onSelect={() => handleNavigate('dashboard')}
              >
                <LayoutDashboard className="size-4" />
                <span>Go to Dashboard</span>
              </CommandItem>
              <CommandItem
                value="go-to-projects"
                onSelect={() => handleNavigate('projects')}
              >
                <Folder className="size-4" />
                <span>Go to Projects</span>
              </CommandItem>
              <CommandItem
                value="go-to-activity"
                onSelect={() => handleNavigate('activity')}
              >
                <Bell className="size-4" />
                <span>Go to Activity</span>
              </CommandItem>
              <CommandItem
                value="go-to-contacts"
                onSelect={() => handleNavigate('people')}
              >
                <Users className="size-4" />
                <span>Go to Contacts</span>
              </CommandItem>
              <CommandItem
                value="go-to-memory"
                onSelect={() => handleNavigate('memory')}
              >
                <Brain className="size-4" />
                <span>Go to Memory</span>
              </CommandItem>
              <CommandItem
                value="go-to-communications"
                onSelect={() => handleNavigate('communications')}
              >
                <MessageSquare className="size-4" />
                <span>Go to Communications</span>
              </CommandItem>
              <CommandItem
                value="go-to-settings"
                onSelect={() => handleNavigate('settings')}
              >
                <Settings className="size-4" />
                <span>Go to Settings</span>
              </CommandItem>
            </CommandGroup>
          </>
        )}

        {/* Actions */}
        {!query && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Actions">
              <CommandItem
                value="create-task"
                onSelect={() => handleAction('create-task')}
              >
                <Plus className="size-4" />
                <span>Create task</span>
                <CommandShortcut>N</CommandShortcut>
              </CommandItem>
              <CommandItem
                value="toggle-theme"
                onSelect={() => handleAction('toggle-theme')}
              >
                {isDark ? (
                  <Sun className="size-4" />
                ) : (
                  <Moon className="size-4" />
                )}
                <span>Toggle theme</span>
              </CommandItem>
              <CommandItem
                value="toggle-sidebar"
                onSelect={() => handleAction('toggle-sidebar')}
              >
                {sidebarCollapsed ? (
                  <PanelLeft className="size-4" />
                ) : (
                  <PanelLeftClose className="size-4" />
                )}
                <span>Toggle sidebar</span>
              </CommandItem>
            </CommandGroup>
          </>
        )}

        {/* Type Hints */}
        {!query && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Search Tips">
              <CommandItem disabled>
                <span className="text-muted-foreground">
                  <kbd className="rounded border bg-muted px-1 text-xs">@</kbd> contacts
                  <kbd className="ml-2 rounded border bg-muted px-1 text-xs">#</kbd> projects
                  <kbd className="ml-2 rounded border bg-muted px-1 text-xs">!</kbd> issues
                </span>
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
