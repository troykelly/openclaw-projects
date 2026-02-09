/**
 * Keyboard shortcuts hook for notes.
 * Part of Epic #338, Issue #358
 */

import { useEffect, useCallback, useRef } from 'react';

export interface NoteKeyboardShortcuts {
  onSave?: () => void;
  onNew?: () => void;
  onDelete?: () => void;
  onSearch?: () => void;
  onTogglePreview?: () => void;
  onToggleMarkdown?: () => void;
  onBold?: () => void;
  onItalic?: () => void;
  onUnderline?: () => void;
  onStrikethrough?: () => void;
  onHeading1?: () => void;
  onHeading2?: () => void;
  onHeading3?: () => void;
  onBulletList?: () => void;
  onNumberedList?: () => void;
  onCode?: () => void;
  onQuote?: () => void;
  onLink?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

export interface UseNoteKeyboardShortcutsOptions {
  /** Shortcuts to enable */
  shortcuts: NoteKeyboardShortcuts;
  /** Whether shortcuts are enabled */
  enabled?: boolean;
  /** Element to scope shortcuts to (default: window) */
  scope?: React.RefObject<HTMLElement>;
}

export interface ShortcutDefinition {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  description: string;
  category: 'file' | 'edit' | 'format' | 'view' | 'navigation';
}

export const NOTE_SHORTCUTS: Record<keyof NoteKeyboardShortcuts, ShortcutDefinition> = {
  onSave: { key: 's', ctrl: true, description: 'Save note', category: 'file' },
  onNew: { key: 'n', ctrl: true, description: 'New note', category: 'file' },
  onDelete: { key: 'Backspace', ctrl: true, shift: true, description: 'Delete note', category: 'file' },
  onSearch: { key: '/', ctrl: true, description: 'Search notes', category: 'navigation' },
  onTogglePreview: { key: 'p', ctrl: true, shift: true, description: 'Toggle preview', category: 'view' },
  onToggleMarkdown: { key: 'm', ctrl: true, shift: true, description: 'Toggle markdown', category: 'view' },
  onBold: { key: 'b', ctrl: true, description: 'Bold', category: 'format' },
  onItalic: { key: 'i', ctrl: true, description: 'Italic', category: 'format' },
  onUnderline: { key: 'u', ctrl: true, description: 'Underline', category: 'format' },
  onStrikethrough: { key: 's', ctrl: true, shift: true, description: 'Strikethrough', category: 'format' },
  onHeading1: { key: '1', ctrl: true, alt: true, description: 'Heading 1', category: 'format' },
  onHeading2: { key: '2', ctrl: true, alt: true, description: 'Heading 2', category: 'format' },
  onHeading3: { key: '3', ctrl: true, alt: true, description: 'Heading 3', category: 'format' },
  onBulletList: { key: '8', ctrl: true, shift: true, description: 'Bullet list', category: 'format' },
  onNumberedList: { key: '7', ctrl: true, shift: true, description: 'Numbered list', category: 'format' },
  onCode: { key: '`', ctrl: true, description: 'Code', category: 'format' },
  onQuote: { key: "'", ctrl: true, shift: true, description: 'Quote', category: 'format' },
  onLink: { key: 'k', ctrl: true, description: 'Insert link', category: 'format' },
  onUndo: { key: 'z', ctrl: true, description: 'Undo', category: 'edit' },
  onRedo: { key: 'z', ctrl: true, shift: true, description: 'Redo', category: 'edit' },
};

function matchesShortcut(event: KeyboardEvent, shortcut: ShortcutDefinition): boolean {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  // On Mac, use meta (Cmd); on others, use ctrl
  const modifierKey = isMac ? event.metaKey : event.ctrlKey;

  const expectedCtrl = shortcut.ctrl || shortcut.meta;
  const expectedShift = shortcut.shift ?? false;
  const expectedAlt = shortcut.alt ?? false;

  return (
    event.key.toLowerCase() === shortcut.key.toLowerCase() && modifierKey === expectedCtrl && event.shiftKey === expectedShift && event.altKey === expectedAlt
  );
}

export function useNoteKeyboardShortcuts({ shortcuts, enabled = true, scope }: UseNoteKeyboardShortcutsOptions): void {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Don't trigger shortcuts when typing in inputs (except for save)
      const target = event.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Check each shortcut
      for (const [action, shortcut] of Object.entries(NOTE_SHORTCUTS)) {
        const handler = shortcutsRef.current[action as keyof NoteKeyboardShortcuts];

        if (!handler) continue;

        if (matchesShortcut(event, shortcut)) {
          // Allow save and formatting in inputs
          const allowInInput = action === 'onSave' || shortcut.category === 'format' || shortcut.category === 'edit';

          if (!isInput || allowInInput) {
            event.preventDefault();
            handler();
            return;
          }
        }
      }
    },
    [enabled],
  );

  useEffect(() => {
    const target = scope?.current || window;

    target.addEventListener('keydown', handleKeyDown as EventListener);
    return () => {
      target.removeEventListener('keydown', handleKeyDown as EventListener);
    };
  }, [handleKeyDown, scope]);
}

/**
 * Get a formatted shortcut string for display.
 */
export function formatShortcut(shortcut: ShortcutDefinition): string {
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const parts: string[] = [];

  if (shortcut.ctrl || shortcut.meta) {
    parts.push(isMac ? '⌘' : 'Ctrl');
  }
  if (shortcut.alt) {
    parts.push(isMac ? '⌥' : 'Alt');
  }
  if (shortcut.shift) {
    parts.push(isMac ? '⇧' : 'Shift');
  }

  // Format special keys
  let key = shortcut.key.toUpperCase();
  if (key === 'BACKSPACE') key = '⌫';
  if (key === '/') key = '/';
  if (key === '`') key = '`';
  if (key === "'") key = "'";

  parts.push(key);

  return parts.join(isMac ? '' : '+');
}

/**
 * Get all shortcuts grouped by category.
 */
export function getShortcutsByCategory(): Record<string, Array<{ action: string; shortcut: ShortcutDefinition }>> {
  const grouped: Record<string, Array<{ action: string; shortcut: ShortcutDefinition }>> = {};

  for (const [action, shortcut] of Object.entries(NOTE_SHORTCUTS)) {
    if (!grouped[shortcut.category]) {
      grouped[shortcut.category] = [];
    }
    grouped[shortcut.category].push({ action, shortcut });
  }

  return grouped;
}
