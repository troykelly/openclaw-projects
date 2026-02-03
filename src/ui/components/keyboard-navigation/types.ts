/**
 * Types for keyboard navigation
 * Issue #410: Implement keyboard navigation throughout
 */

export interface NavigableItem {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface KeyboardShortcut {
  key: string;
  modifiers?: Array<'ctrl' | 'alt' | 'shift' | 'meta'>;
  action: () => void;
  description: string;
  scope?: string;
}

export interface KeyboardNavigationContextValue {
  focusedIndex: number;
  setFocusedIndex: (index: number) => void;
  registerShortcut: (shortcut: KeyboardShortcut) => () => void;
  isEnabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

export type ModifierKey = 'Cmd' | 'Ctrl' | 'Alt' | 'Shift' | 'Meta';

export const MODIFIER_SYMBOLS: Record<string, string> = {
  Cmd: '⌘',
  Meta: '⌘',
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
};
