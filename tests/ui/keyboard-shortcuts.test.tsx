/**
 * @vitest-environment jsdom
 *
 * Tests for the keyboard shortcuts system (Issue #476).
 *
 * Covers:
 * - useKeyboardShortcuts hook: global shortcuts, go-to sequences, list nav
 * - KeyboardShortcutsDialog: rendering shortcut groups and descriptions
 * - Input-field suppression: shortcuts must not fire when the user is typing
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, renderHook } from '@testing-library/react';
import '@testing-library/jest-dom';

import {
  useKeyboardShortcuts,
  SHORTCUT_DEFINITIONS,
  type KeyboardShortcutCallbacks,
} from '@/ui/hooks/use-keyboard-shortcuts';
import { KeyboardShortcutsDialog } from '@/ui/components/keyboard-shortcuts/KeyboardShortcutsDialog';

// ---------------------------------------------------------------------------
// Mock api-client (required by convention even though these tests don't call it)
// ---------------------------------------------------------------------------
vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helper: render the hook inside a wrapper that exposes callbacks
// ---------------------------------------------------------------------------
function HookWrapper({
  callbacks,
  onHelpOpen,
}: {
  callbacks: KeyboardShortcutCallbacks;
  onHelpOpen?: (open: boolean) => void;
}) {
  const { helpOpen, setHelpOpen, shortcuts } = useKeyboardShortcuts(callbacks);

  React.useEffect(() => {
    onHelpOpen?.(helpOpen);
  }, [helpOpen, onHelpOpen]);

  return (
    <div data-testid="hook-wrapper">
      <span data-testid="help-open">{String(helpOpen)}</span>
      <button data-testid="close-help" onClick={() => setHelpOpen(false)}>
        Close
      </button>
      <KeyboardShortcutsDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        shortcuts={shortcuts}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- Global shortcuts ---

  it('fires onOpenSearch on Cmd+K', () => {
    const onOpenSearch = vi.fn();
    render(<HookWrapper callbacks={{ onOpenSearch }} />);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true }),
      );
    });

    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it('fires onOpenSearch on Ctrl+K', () => {
    const onOpenSearch = vi.fn();
    render(<HookWrapper callbacks={{ onOpenSearch }} />);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }),
      );
    });

    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it('fires onNewItem on Cmd+N', () => {
    const onNewItem = vi.fn();
    render(<HookWrapper callbacks={{ onNewItem }} />);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', metaKey: true }),
      );
    });

    expect(onNewItem).toHaveBeenCalledTimes(1);
  });

  it('fires onNewItem on Ctrl+N', () => {
    const onNewItem = vi.fn();
    render(<HookWrapper callbacks={{ onNewItem }} />);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }),
      );
    });

    expect(onNewItem).toHaveBeenCalledTimes(1);
  });

  it('toggles helpOpen on Cmd+/', () => {
    render(<HookWrapper callbacks={{}} />);

    // Initially closed
    expect(screen.getByTestId('help-open')).toHaveTextContent('false');

    // Open
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: '/', metaKey: true }),
      );
    });
    expect(screen.getByTestId('help-open')).toHaveTextContent('true');

    // Close
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: '/', metaKey: true }),
      );
    });
    expect(screen.getByTestId('help-open')).toHaveTextContent('false');
  });

  it('fires onToggleSidebar on Cmd+B', () => {
    const onToggleSidebar = vi.fn();
    render(<HookWrapper callbacks={{ onToggleSidebar }} />);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'b', metaKey: true }),
      );
    });

    expect(onToggleSidebar).toHaveBeenCalledTimes(1);
  });

  // --- Go-to navigation sequences ---

  it('navigates to activity on G then A', () => {
    const onNavigate = vi.fn();
    render(<HookWrapper callbacks={{ onNavigate }} />);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });

    expect(onNavigate).toHaveBeenCalledWith('activity');
  });

  it('navigates to projects on G then P', () => {
    const onNavigate = vi.fn();
    render(<HookWrapper callbacks={{ onNavigate }} />);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
    });

    expect(onNavigate).toHaveBeenCalledWith('projects');
  });

  it('navigates to people on G then E', () => {
    const onNavigate = vi.fn();
    render(<HookWrapper callbacks={{ onNavigate }} />);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
    });

    expect(onNavigate).toHaveBeenCalledWith('people');
  });

  it('navigates to settings on G then S', () => {
    const onNavigate = vi.fn();
    render(<HookWrapper callbacks={{ onNavigate }} />);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
    });

    expect(onNavigate).toHaveBeenCalledWith('settings');
  });

  it('navigates to dashboard on G then D', () => {
    const onNavigate = vi.fn();
    render(<HookWrapper callbacks={{ onNavigate }} />);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    });

    expect(onNavigate).toHaveBeenCalledWith('dashboard');
  });

  // --- List navigation ---

  it('fires onMoveDown on J key', () => {
    const onMoveDown = vi.fn();
    render(<HookWrapper callbacks={{ onMoveDown }} />);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
    });

    expect(onMoveDown).toHaveBeenCalledTimes(1);
  });

  it('fires onMoveUp on K key', () => {
    const onMoveUp = vi.fn();
    render(<HookWrapper callbacks={{ onMoveUp }} />);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));
    });

    expect(onMoveUp).toHaveBeenCalledTimes(1);
  });

  it('fires onOpenSelected on Enter key', () => {
    const onOpenSelected = vi.fn();
    render(<HookWrapper callbacks={{ onOpenSelected }} />);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    });

    expect(onOpenSelected).toHaveBeenCalledTimes(1);
  });

  it('fires onEscape on Escape key', () => {
    const onEscape = vi.fn();
    render(<HookWrapper callbacks={{ onEscape }} />);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  // --- Input field suppression ---

  it('does not fire shortcuts when typing in an input field', () => {
    const onMoveDown = vi.fn();
    const onNewItem = vi.fn();
    render(<HookWrapper callbacks={{ onMoveDown, onNewItem }} />);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'j', bubbles: true }),
      );
    });
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', metaKey: true, bubbles: true }),
      );
    });

    expect(onMoveDown).not.toHaveBeenCalled();
    expect(onNewItem).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('does not fire shortcuts when typing in a textarea', () => {
    const onMoveUp = vi.fn();
    render(<HookWrapper callbacks={{ onMoveUp }} />);

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', bubbles: true }),
      );
    });

    expect(onMoveUp).not.toHaveBeenCalled();
    document.body.removeChild(textarea);
  });

  it('does not fire go-to sequence when typing in a select element', () => {
    const onNavigate = vi.fn();
    render(<HookWrapper callbacks={{ onNavigate }} />);

    const select = document.createElement('select');
    const option = document.createElement('option');
    option.value = 'test';
    select.appendChild(option);
    document.body.appendChild(select);
    select.focus();

    act(() => {
      select.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'g', bubbles: true }),
      );
    });
    act(() => {
      select.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'a', bubbles: true }),
      );
    });

    expect(onNavigate).not.toHaveBeenCalled();
    document.body.removeChild(select);
  });

  // --- Disabled state ---

  it('does not fire shortcuts when disabled', () => {
    const onOpenSearch = vi.fn();

    function DisabledWrapper() {
      useKeyboardShortcuts({ onOpenSearch }, { enabled: false });
      return <div data-testid="disabled-wrapper" />;
    }

    render(<DisabledWrapper />);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true }),
      );
    });

    expect(onOpenSearch).not.toHaveBeenCalled();
  });
});

describe('KeyboardShortcutsDialog', () => {
  it('renders nothing when closed', () => {
    render(
      <KeyboardShortcutsDialog
        open={false}
        onOpenChange={vi.fn()}
        shortcuts={SHORTCUT_DEFINITIONS}
      />,
    );

    expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument();
  });

  it('renders the dialog title when open', () => {
    render(
      <KeyboardShortcutsDialog
        open={true}
        onOpenChange={vi.fn()}
        shortcuts={SHORTCUT_DEFINITIONS}
      />,
    );

    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
  });

  it('displays all shortcut groups', () => {
    render(
      <KeyboardShortcutsDialog
        open={true}
        onOpenChange={vi.fn()}
        shortcuts={SHORTCUT_DEFINITIONS}
      />,
    );

    expect(screen.getByText('Global')).toBeInTheDocument();
    expect(screen.getByText('Navigation')).toBeInTheDocument();
    expect(screen.getByText('Lists')).toBeInTheDocument();
  });

  it('displays individual shortcut descriptions', () => {
    render(
      <KeyboardShortcutsDialog
        open={true}
        onOpenChange={vi.fn()}
        shortcuts={SHORTCUT_DEFINITIONS}
      />,
    );

    expect(screen.getByText('Open command palette')).toBeInTheDocument();
    expect(screen.getByText('Create new work item')).toBeInTheDocument();
    expect(screen.getByText('Show keyboard shortcuts')).toBeInTheDocument();
    expect(screen.getByText('Toggle sidebar')).toBeInTheDocument();
    expect(screen.getByText('Go to Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Go to Activity')).toBeInTheDocument();
    expect(screen.getByText('Go to Projects')).toBeInTheDocument();
    expect(screen.getByText('Go to People')).toBeInTheDocument();
    expect(screen.getByText('Go to Settings')).toBeInTheDocument();
    expect(screen.getByText('Move down')).toBeInTheDocument();
    expect(screen.getByText('Move up')).toBeInTheDocument();
    expect(screen.getByText('Open selected item')).toBeInTheDocument();
    expect(screen.getByText('Close / clear selection')).toBeInTheDocument();
  });

  it('shows the disabled-in-text-fields note', () => {
    render(
      <KeyboardShortcutsDialog
        open={true}
        onOpenChange={vi.fn()}
        shortcuts={SHORTCUT_DEFINITIONS}
      />,
    );

    expect(
      screen.getByText('Shortcuts are disabled when typing in text fields'),
    ).toBeInTheDocument();
  });

  it('calls onOpenChange when dialog is closed', () => {
    const onOpenChange = vi.fn();
    render(
      <KeyboardShortcutsDialog
        open={true}
        onOpenChange={onOpenChange}
        shortcuts={SHORTCUT_DEFINITIONS}
      />,
    );

    // Close using the X button (Radix Dialog renders a close button)
    const closeButton = screen.getByRole('button', { name: /close/i });
    if (closeButton) {
      fireEvent.click(closeButton);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    }
  });
});

describe('SHORTCUT_DEFINITIONS', () => {
  it('contains at least 13 shortcuts', () => {
    expect(SHORTCUT_DEFINITIONS.length).toBeGreaterThanOrEqual(13);
  });

  it('has unique IDs for every shortcut', () => {
    const ids = SHORTCUT_DEFINITIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every shortcut has a non-empty description and keys', () => {
    for (const shortcut of SHORTCUT_DEFINITIONS) {
      expect(shortcut.description.length).toBeGreaterThan(0);
      expect(shortcut.keys.length).toBeGreaterThan(0);
    }
  });
});
