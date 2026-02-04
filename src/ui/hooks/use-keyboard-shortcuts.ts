/**
 * Unified keyboard shortcut registration hook.
 *
 * Provides a declarative API for registering global shortcuts, go-to navigation
 * sequences, and list navigation keys. Built on top of the lower-level
 * `useHotkeys` / `useSequentialHotkeys` primitives.
 *
 * @module use-keyboard-shortcuts
 */
import { useCallback, useRef, useEffect, useState } from 'react';
import { useHotkeys, useSequentialHotkeys } from '@/ui/hooks/use-hotkeys';

/** A single shortcut definition for display and registration purposes. */
export interface ShortcutDefinition {
  /** Unique identifier for the shortcut (e.g. 'global.search', 'goto.projects'). */
  id: string;
  /** Human-readable label for the shortcut group (Global, Navigation, etc.). */
  group: string;
  /** Human-readable description of what the shortcut does. */
  description: string;
  /** Display keys (e.g. ['Cmd', 'K'] or ['G', 'P']). */
  keys: string[];
}

/** Callbacks for global shortcuts (Cmd+K, Cmd+N, Cmd+/, Cmd+B, Escape). */
export interface GlobalShortcutCallbacks {
  /** Open command palette. */
  onOpenSearch?: () => void;
  /** Create a new work item (quick add). */
  onNewItem?: () => void;
  /** Toggle the keyboard shortcuts help dialog. */
  onToggleHelp?: () => void;
  /** Toggle the sidebar collapsed/expanded state. */
  onToggleSidebar?: () => void;
}

/** Callbacks for go-to navigation sequences (G then X). */
export interface GoToShortcutCallbacks {
  /** Navigate to a named section ('activity', 'projects', 'people', 'settings', 'dashboard'). */
  onNavigate?: (section: string) => void;
}

/** Callbacks for list-view navigation (J, K, Enter, Escape). */
export interface ListShortcutCallbacks {
  /** Move selection down in a list. */
  onMoveDown?: () => void;
  /** Move selection up in a list. */
  onMoveUp?: () => void;
  /** Open the currently selected item. */
  onOpenSelected?: () => void;
  /** Close the current view or clear selection. */
  onEscape?: () => void;
}

/** Combined callbacks for all keyboard shortcut categories. */
export interface KeyboardShortcutCallbacks
  extends GlobalShortcutCallbacks,
    GoToShortcutCallbacks,
    ListShortcutCallbacks {}

/** Options for the useKeyboardShortcuts hook. */
export interface UseKeyboardShortcutsOptions {
  /** Whether shortcuts are enabled. Defaults to true. */
  enabled?: boolean;
}

/**
 * The complete list of keyboard shortcuts exposed by the application.
 * Used both for registration and for rendering the help dialog.
 */
export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  // Global shortcuts
  {
    id: 'global.search',
    group: 'Global',
    description: 'Open command palette',
    keys: ['\u2318', 'K'],
  },
  {
    id: 'global.new-item',
    group: 'Global',
    description: 'Create new work item',
    keys: ['\u2318', 'N'],
  },
  {
    id: 'global.help',
    group: 'Global',
    description: 'Show keyboard shortcuts',
    keys: ['\u2318', '/'],
  },
  {
    id: 'global.sidebar',
    group: 'Global',
    description: 'Toggle sidebar',
    keys: ['\u2318', 'B'],
  },

  // Go-to navigation
  {
    id: 'goto.dashboard',
    group: 'Navigation',
    description: 'Go to Dashboard',
    keys: ['G', 'D'],
  },
  {
    id: 'goto.activity',
    group: 'Navigation',
    description: 'Go to Activity',
    keys: ['G', 'A'],
  },
  {
    id: 'goto.projects',
    group: 'Navigation',
    description: 'Go to Projects',
    keys: ['G', 'P'],
  },
  {
    id: 'goto.people',
    group: 'Navigation',
    description: 'Go to People',
    keys: ['G', 'E'],
  },
  {
    id: 'goto.settings',
    group: 'Navigation',
    description: 'Go to Settings',
    keys: ['G', 'S'],
  },

  // List navigation
  {
    id: 'list.down',
    group: 'Lists',
    description: 'Move down',
    keys: ['J'],
  },
  {
    id: 'list.up',
    group: 'Lists',
    description: 'Move up',
    keys: ['K'],
  },
  {
    id: 'list.open',
    group: 'Lists',
    description: 'Open selected item',
    keys: ['Enter'],
  },
  {
    id: 'list.close',
    group: 'Lists',
    description: 'Close / clear selection',
    keys: ['Esc'],
  },
];

/**
 * State and helpers returned by useKeyboardShortcuts.
 */
export interface UseKeyboardShortcutsReturn {
  /** Whether the shortcuts help dialog is currently open. */
  helpOpen: boolean;
  /** Open or close the help dialog programmatically. */
  setHelpOpen: (open: boolean) => void;
  /** The full list of shortcut definitions for rendering in the help dialog. */
  shortcuts: ShortcutDefinition[];
}

/**
 * Register all application-wide keyboard shortcuts and return state
 * for the help dialog. This hook is intended to be called once at
 * the layout level (e.g. in AppLayout).
 *
 * @param callbacks - Handler functions invoked when shortcuts fire
 * @param options   - Configuration (enable/disable)
 * @returns Help dialog state and shortcut definitions
 */
export function useKeyboardShortcuts(
  callbacks: KeyboardShortcutCallbacks,
  options: UseKeyboardShortcutsOptions = {},
): UseKeyboardShortcutsReturn {
  const { enabled = true } = options;

  const [helpOpen, setHelpOpen] = useState(false);

  // Keep stable refs for callbacks to avoid re-registering listeners
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  // --- Global shortcuts ---

  // Cmd+K / Ctrl+K -> open search / command palette
  useHotkeys('meta+k', () => cbRef.current.onOpenSearch?.(), { enabled });
  useHotkeys('ctrl+k', () => cbRef.current.onOpenSearch?.(), { enabled });

  // Cmd+N / Ctrl+N -> create new work item
  useHotkeys('meta+n', () => cbRef.current.onNewItem?.(), { enabled });
  useHotkeys('ctrl+n', () => cbRef.current.onNewItem?.(), { enabled });

  // Cmd+/ / Ctrl+/ -> toggle help
  const toggleHelp = useCallback(() => {
    setHelpOpen((prev) => !prev);
    cbRef.current.onToggleHelp?.();
  }, []);
  useHotkeys('meta+/', toggleHelp, { enabled });
  useHotkeys('ctrl+/', toggleHelp, { enabled });

  // Cmd+B / Ctrl+B -> toggle sidebar
  useHotkeys('meta+b', () => cbRef.current.onToggleSidebar?.(), { enabled });
  useHotkeys('ctrl+b', () => cbRef.current.onToggleSidebar?.(), { enabled });

  // --- Go-to navigation sequences ---

  const goTo = useCallback(
    (section: string) => () => cbRef.current.onNavigate?.(section),
    [],
  );

  useSequentialHotkeys(['g', 'd'], goTo('dashboard'), { enabled });
  useSequentialHotkeys(['g', 'a'], goTo('activity'), { enabled });
  useSequentialHotkeys(['g', 'p'], goTo('projects'), { enabled });
  useSequentialHotkeys(['g', 'e'], goTo('people'), { enabled });
  useSequentialHotkeys(['g', 's'], goTo('settings'), { enabled });

  // --- List navigation ---

  useHotkeys('j', () => cbRef.current.onMoveDown?.(), { enabled });
  useHotkeys('k', () => cbRef.current.onMoveUp?.(), { enabled });
  useHotkeys('enter', () => cbRef.current.onOpenSelected?.(), { enabled });
  useHotkeys('escape', () => cbRef.current.onEscape?.(), { enabled });

  return {
    helpOpen,
    setHelpOpen,
    shortcuts: SHORTCUT_DEFINITIONS,
  };
}
