/**
 * Keyboard Navigation Context
 * Issue #410: Implement keyboard navigation throughout
 */
import * as React from 'react';
import type { KeyboardNavigationContextValue, KeyboardShortcut } from './types';

const KeyboardNavigationContext = React.createContext<KeyboardNavigationContextValue | undefined>(undefined);

interface KeyboardNavigationProviderProps {
  children: React.ReactNode;
  initialFocusIndex?: number;
}

function isInputElement(element: Element | null): boolean {
  if (!element) return false;
  const tagName = element.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || element.getAttribute('contenteditable') === 'true';
}

export function KeyboardNavigationProvider({ children, initialFocusIndex = -1 }: KeyboardNavigationProviderProps) {
  const [focusedIndex, setFocusedIndex] = React.useState(initialFocusIndex);
  const [isEnabled, setEnabled] = React.useState(true);
  const shortcutsRef = React.useRef<Map<string, KeyboardShortcut>>(new Map());

  const registerShortcut = React.useCallback((shortcut: KeyboardShortcut): (() => void) => {
    const key = shortcut.key.toLowerCase();
    shortcutsRef.current.set(key, shortcut);

    return () => {
      shortcutsRef.current.delete(key);
    };
  }, []);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isEnabled) return;

      // Don't handle shortcuts when typing in input fields
      if (isInputElement(document.activeElement)) {
        return;
      }

      const key = event.key.toLowerCase();
      const shortcut = shortcutsRef.current.get(key);

      if (shortcut) {
        // Check modifiers if required
        if (shortcut.modifiers?.length) {
          const hasAllModifiers = shortcut.modifiers.every((mod) => {
            switch (mod) {
              case 'ctrl':
                return event.ctrlKey;
              case 'alt':
                return event.altKey;
              case 'shift':
                return event.shiftKey;
              case 'meta':
                return event.metaKey;
              default:
                return false;
            }
          });
          if (!hasAllModifiers) return;
        }

        event.preventDefault();
        shortcut.action();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isEnabled]);

  const value: KeyboardNavigationContextValue = React.useMemo(
    () => ({
      focusedIndex,
      setFocusedIndex,
      registerShortcut,
      isEnabled,
      setEnabled,
    }),
    [focusedIndex, registerShortcut, isEnabled],
  );

  return <KeyboardNavigationContext.Provider value={value}>{children}</KeyboardNavigationContext.Provider>;
}

export function useKeyboardNavigation(): KeyboardNavigationContextValue {
  const context = React.useContext(KeyboardNavigationContext);
  if (!context) {
    throw new Error('useKeyboardNavigation must be used within KeyboardNavigationProvider');
  }
  return context;
}
