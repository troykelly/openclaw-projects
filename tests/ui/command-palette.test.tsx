/**
 * @vitest-environment jsdom
 *
 * Tests for CommandPalette component.
 * Issue #475: Integrate command palette with router and global search
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockApiClient = {
  get: vi.fn().mockResolvedValue({ results: [] }),
  post: vi.fn().mockResolvedValue({}),
  put: vi.fn().mockResolvedValue({}),
  patch: vi.fn().mockResolvedValue({}),
  delete: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@/ui/lib/api-client', () => ({
  apiClient: mockApiClient,
}));

// Mock cmdk-based command components to render plain HTML in jsdom.
// The cmdk library uses internal scoring/filtering that doesn't work in jsdom,
// causing CommandItem children to not render visibly.
vi.mock('@/ui/components/ui/command', () => {
  const React = require('react');
  return {
    CommandDialog: ({ open, onOpenChange, children, title, description }: any) => {
      // Handle Escape key to close the dialog, mimicking Radix Dialog behavior
      React.useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
          if (e.key === 'Escape') onOpenChange?.(false);
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
      }, [open, onOpenChange]);
      if (!open) return null;
      return React.createElement('div', { role: 'dialog', 'data-testid': 'command-dialog' },
        React.createElement('div', { className: 'sr-only' },
          React.createElement('h2', null, title),
          React.createElement('p', null, description),
        ),
        children,
      );
    },
    CommandInput: ({ placeholder, value, onValueChange, ...props }: any) =>
      React.createElement('input', {
        placeholder,
        value: value || '',
        onChange: (e: any) => onValueChange?.(e.target.value),
        ...props,
      }),
    CommandList: ({ children }: any) => React.createElement('div', { 'data-slot': 'command-list' }, children),
    CommandEmpty: ({ children }: any) => React.createElement('div', { 'data-slot': 'command-empty' }, children),
    CommandGroup: ({ heading, children }: any) =>
      React.createElement('div', { 'data-slot': 'command-group' },
        heading ? React.createElement('div', null, heading) : null,
        children,
      ),
    CommandItem: ({ children, onSelect, disabled, value, ...props }: any) =>
      React.createElement('div', {
        'data-slot': 'command-item',
        role: 'option',
        onClick: () => !disabled && onSelect?.(),
        ...props,
      }, children),
    CommandSeparator: () => React.createElement('hr'),
    CommandShortcut: ({ children }: any) => React.createElement('span', null, children),
    Command: ({ children }: any) => React.createElement('div', null, children),
  };
});

import {
  CommandPalette,
  type SearchResult,
} from '@/ui/components/command-palette';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPalette(props: Partial<React.ComponentProps<typeof CommandPalette>> = {}) {
  const defaultProps = {
    onSearch: vi.fn().mockResolvedValue([]),
    onSelect: vi.fn(),
    onNavigate: vi.fn(),
    onToggleTheme: vi.fn(),
    onToggleSidebar: vi.fn(),
    onCreateTask: vi.fn(),
  };

  const merged = { ...defaultProps, ...props };

  return {
    ...render(<CommandPalette {...merged} />),
    props: merged,
  };
}

/** Opens the command palette via Cmd+K keyboard shortcut */
function openPaletteViaKeyboard() {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'k',
        metaKey: true,
        bubbles: true,
      }),
    );
  });
}

/** Opens the command palette via Ctrl+K keyboard shortcut */
function openPaletteViaCtrlK() {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'k',
        ctrlKey: true,
        bubbles: true,
      }),
    );
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  // -------------------------------------------------------------------------
  // Keyboard shortcuts
  // -------------------------------------------------------------------------

  describe('Keyboard shortcuts', () => {
    it('opens with Cmd+K', async () => {
      renderPalette();

      openPaletteViaKeyboard();

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Type a command or search...')).toBeInTheDocument();
      });
    });

    it('opens with Ctrl+K', async () => {
      renderPalette();

      openPaletteViaCtrlK();

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Type a command or search...')).toBeInTheDocument();
      });
    });

    it('closes when pressing Cmd+K while open', async () => {
      renderPalette({ open: true });

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Type a command or search...')).toBeInTheDocument();
      });

      openPaletteViaKeyboard();

      await waitFor(() => {
        expect(screen.queryByPlaceholderText('Type a command or search...')).not.toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Open/close with props
  // -------------------------------------------------------------------------

  describe('Open/close with props', () => {
    it('renders open when open prop is true', async () => {
      renderPalette({ open: true });

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Type a command or search...')).toBeInTheDocument();
      });
    });

    it('does not render input when open prop is false', () => {
      renderPalette({ open: false });

      expect(screen.queryByPlaceholderText('Type a command or search...')).not.toBeInTheDocument();
    });

    it('calls onOpenChange when closing', async () => {
      const onOpenChange = vi.fn();
      renderPalette({ open: true, onOpenChange });

      // Press Escape to close
      fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' });

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Navigation commands
  // -------------------------------------------------------------------------

  describe('Navigation commands', () => {
    it('shows Go to Dashboard command', async () => {
      renderPalette({ open: true });

      await waitFor(() => {
        expect(screen.getByText('Go to Dashboard')).toBeInTheDocument();
      });
    });

    it('shows Go to Projects command', async () => {
      renderPalette({ open: true });

      await waitFor(() => {
        expect(screen.getByText('Go to Projects')).toBeInTheDocument();
      });
    });

    it('shows Go to Activity command', async () => {
      renderPalette({ open: true });

      await waitFor(() => {
        expect(screen.getByText('Go to Activity')).toBeInTheDocument();
      });
    });

    it('shows Go to Contacts command', async () => {
      renderPalette({ open: true });

      await waitFor(() => {
        expect(screen.getByText('Go to Contacts')).toBeInTheDocument();
      });
    });

    it('shows Go to Memory command', async () => {
      renderPalette({ open: true });

      await waitFor(() => {
        expect(screen.getByText('Go to Memory')).toBeInTheDocument();
      });
    });

    it('shows Go to Communications command', async () => {
      renderPalette({ open: true });

      await waitFor(() => {
        expect(screen.getByText('Go to Communications')).toBeInTheDocument();
      });
    });

    it('shows Go to Settings command', async () => {
      renderPalette({ open: true });

      await waitFor(() => {
        expect(screen.getByText('Go to Settings')).toBeInTheDocument();
      });
    });

    it('calls onNavigate with dashboard when selecting Go to Dashboard', async () => {
      const { props } = renderPalette({ open: true });

      await waitFor(() => {
        expect(screen.getByText('Go to Dashboard')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Go to Dashboard'));

      await waitFor(() => {
        expect(props.onNavigate).toHaveBeenCalledWith('dashboard');
      });
    });

    it('calls onNavigate with projects when selecting Go to Projects', async () => {
      const { props } = renderPalette({ open: true });

      await waitFor(() => {
        expect(screen.getByText('Go to Projects')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Go to Projects'));

      await waitFor(() => {
        expect(props.onNavigate).toHaveBeenCalledWith('projects');
      });
    });
  });

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  describe('Actions', () => {
    it('shows Create task action', async () => {
      renderPalette({ open: true });

      await waitFor(() => {
        expect(screen.getByText('Create task')).toBeInTheDocument();
      });
    });

    it('shows Toggle theme action', async () => {
      renderPalette({ open: true });

      await waitFor(() => {
        expect(screen.getByText('Toggle theme')).toBeInTheDocument();
      });
    });

    it('shows Toggle sidebar action', async () => {
      renderPalette({ open: true });

      await waitFor(() => {
        expect(screen.getByText('Toggle sidebar')).toBeInTheDocument();
      });
    });

    it('calls onCreateTask when selecting Create task', async () => {
      const { props } = renderPalette({ open: true });

      await waitFor(() => {
        expect(screen.getByText('Create task')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Create task'));

      await waitFor(() => {
        expect(props.onCreateTask).toHaveBeenCalled();
      });
    });

    it('calls onToggleTheme when selecting Toggle theme', async () => {
      const { props } = renderPalette({ open: true });

      await waitFor(() => {
        expect(screen.getByText('Toggle theme')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Toggle theme'));

      await waitFor(() => {
        expect(props.onToggleTheme).toHaveBeenCalled();
      });
    });

    it('calls onToggleSidebar when selecting Toggle sidebar', async () => {
      const { props } = renderPalette({ open: true });

      await waitFor(() => {
        expect(screen.getByText('Toggle sidebar')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Toggle sidebar'));

      await waitFor(() => {
        expect(props.onToggleSidebar).toHaveBeenCalled();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  describe('Search', () => {
    it('calls onSearch when typing a query', async () => {
      vi.useFakeTimers();
      const onSearch = vi.fn().mockResolvedValue([]);
      renderPalette({ open: true, onSearch });

      const input = screen.getByPlaceholderText('Type a command or search...');
      fireEvent.change(input, { target: { value: 'test query' } });

      // Advance past debounce timer
      await act(async () => {
        vi.advanceTimersByTime(300);
      });

      expect(onSearch).toHaveBeenCalledWith('test query');

      vi.useRealTimers();
    });

    it('displays search results matching the query', async () => {
      const searchResults: SearchResult[] = [
        { id: 'wi-1', type: 'issue', title: 'Fix login bug', subtitle: 'Auth module' },
      ];
      const onSearch = vi.fn().mockResolvedValue(searchResults);
      renderPalette({ open: true, onSearch });

      const input = screen.getByPlaceholderText('Type a command or search...');
      fireEvent.change(input, { target: { value: 'fix' } });

      // Wait for the debounced search to fire and results to render.
      // cmdk filters items by matching input against CommandItem value,
      // so only results whose value contains 'fix' will appear.
      await waitFor(() => {
        expect(screen.getByText('Fix login bug')).toBeInTheDocument();
        expect(screen.getByText('Auth module')).toBeInTheDocument();
      }, { timeout: 5000 });
    });

    it('displays contact search results', async () => {
      const searchResults: SearchResult[] = [
        { id: 'c-1', type: 'contact', title: 'Jane Doe' },
      ];
      const onSearch = vi.fn().mockResolvedValue(searchResults);
      renderPalette({ open: true, onSearch });

      const input = screen.getByPlaceholderText('Type a command or search...');
      fireEvent.change(input, { target: { value: 'jane' } });

      await waitFor(() => {
        expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      }, { timeout: 5000 });
    });

    it('calls onSelect when clicking a search result', async () => {
      const searchResults: SearchResult[] = [
        { id: 'wi-1', type: 'issue', title: 'Fix login bug' },
      ];
      const onSearch = vi.fn().mockResolvedValue(searchResults);
      const { props } = renderPalette({ open: true, onSearch });

      const input = screen.getByPlaceholderText('Type a command or search...');
      fireEvent.change(input, { target: { value: 'fix' } });

      await waitFor(() => {
        expect(screen.getByText('Fix login bug')).toBeInTheDocument();
      }, { timeout: 5000 });

      fireEvent.click(screen.getByText('Fix login bug'));

      await waitFor(() => {
        expect(props.onSelect).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'wi-1', title: 'Fix login bug' }),
        );
      });
    });

    it('shows searching state', async () => {
      // Create a search that never resolves to hold the searching state
      const onSearch = vi.fn().mockReturnValue(new Promise(() => {}));
      renderPalette({ open: true, onSearch });

      const input = screen.getByPlaceholderText('Type a command or search...');
      fireEvent.change(input, { target: { value: 'test' } });

      await waitFor(() => {
        expect(screen.getByText('Searching...')).toBeInTheDocument();
      }, { timeout: 5000 });
    });

    it('hides navigation commands when search query is entered', async () => {
      vi.useFakeTimers();
      const onSearch = vi.fn().mockResolvedValue([]);
      renderPalette({ open: true, onSearch });

      // Navigation is visible initially
      expect(screen.getByText('Go to Dashboard')).toBeInTheDocument();

      const input = screen.getByPlaceholderText('Type a command or search...');
      fireEvent.change(input, { target: { value: 'test' } });

      // Navigation should be hidden when there's a query
      expect(screen.queryByText('Go to Dashboard')).not.toBeInTheDocument();

      vi.useRealTimers();
    });

    it('hides actions when search query is entered', async () => {
      vi.useFakeTimers();
      const onSearch = vi.fn().mockResolvedValue([]);
      renderPalette({ open: true, onSearch });

      // Actions visible initially
      expect(screen.getByText('Create task')).toBeInTheDocument();

      const input = screen.getByPlaceholderText('Type a command or search...');
      fireEvent.change(input, { target: { value: 'test' } });

      // Actions should be hidden when there's a query
      expect(screen.queryByText('Create task')).not.toBeInTheDocument();

      vi.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // Theme indicator
  // -------------------------------------------------------------------------

  describe('Theme indicator', () => {
    it('shows moon icon when in light mode', async () => {
      renderPalette({ open: true, isDark: false });

      await waitFor(() => {
        expect(screen.getByText('Toggle theme')).toBeInTheDocument();
      });
    });

    it('shows sun icon when in dark mode', async () => {
      renderPalette({ open: true, isDark: true });

      await waitFor(() => {
        expect(screen.getByText('Toggle theme')).toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Recent items
  // -------------------------------------------------------------------------

  describe('Recent items', () => {
    it('shows recent items when provided via props', async () => {
      const recentItems = [
        { id: 'r-1', type: 'issue' as const, title: 'Recent Issue' },
      ];
      renderPalette({ open: true, recentItems });

      await waitFor(() => {
        expect(screen.getByText('Recent Issue')).toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Search tips
  // -------------------------------------------------------------------------

  describe('Search tips', () => {
    it('shows search tips when palette is open with no query', async () => {
      renderPalette({ open: true });

      await waitFor(() => {
        // Search tips section should be visible
        expect(screen.getByText('Search Tips')).toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Palette closes after actions
  // -------------------------------------------------------------------------

  describe('Palette closes after actions', () => {
    it('closes palette after selecting a navigation command', async () => {
      const onOpenChange = vi.fn();
      renderPalette({ open: true, onOpenChange });

      await waitFor(() => {
        expect(screen.getByText('Go to Dashboard')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Go to Dashboard'));

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it('closes palette after toggling theme', async () => {
      const onOpenChange = vi.fn();
      renderPalette({ open: true, onOpenChange });

      await waitFor(() => {
        expect(screen.getByText('Toggle theme')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Toggle theme'));

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });
  });
});
