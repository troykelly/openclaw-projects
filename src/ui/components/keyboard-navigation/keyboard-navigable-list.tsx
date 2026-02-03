/**
 * Keyboard Navigable List component
 * Issue #410: Implement keyboard navigation throughout
 */
import * as React from 'react';
import { useKeyboardNavigation } from './keyboard-navigation-context';
import type { NavigableItem } from './types';

export interface KeyboardNavigableListProps {
  items: NavigableItem[];
  onSelect?: (item: NavigableItem) => void;
  renderItem: (
    item: NavigableItem,
    index: number,
    isFocused: boolean
  ) => React.ReactNode;
  className?: string;
}

export function KeyboardNavigableList({
  items,
  onSelect,
  renderItem,
  className,
}: KeyboardNavigableListProps) {
  const { focusedIndex, setFocusedIndex, registerShortcut } =
    useKeyboardNavigation();

  // Register navigation shortcuts
  React.useEffect(() => {
    const unregisterJ = registerShortcut({
      key: 'j',
      action: () => {
        setFocusedIndex(Math.min(focusedIndex + 1, items.length - 1));
      },
      description: 'Move down',
    });

    const unregisterK = registerShortcut({
      key: 'k',
      action: () => {
        setFocusedIndex(Math.max(focusedIndex - 1, 0));
      },
      description: 'Move up',
    });

    const unregisterDown = registerShortcut({
      key: 'ArrowDown',
      action: () => {
        setFocusedIndex(Math.min(focusedIndex + 1, items.length - 1));
      },
      description: 'Move down',
    });

    const unregisterUp = registerShortcut({
      key: 'ArrowUp',
      action: () => {
        setFocusedIndex(Math.max(focusedIndex - 1, 0));
      },
      description: 'Move up',
    });

    const unregisterHome = registerShortcut({
      key: 'Home',
      action: () => {
        setFocusedIndex(0);
      },
      description: 'Go to first item',
    });

    const unregisterEnd = registerShortcut({
      key: 'End',
      action: () => {
        setFocusedIndex(items.length - 1);
      },
      description: 'Go to last item',
    });

    const unregisterEnter = registerShortcut({
      key: 'Enter',
      action: () => {
        if (focusedIndex >= 0 && focusedIndex < items.length) {
          onSelect?.(items[focusedIndex]);
        }
      },
      description: 'Select item',
    });

    return () => {
      unregisterJ();
      unregisterK();
      unregisterDown();
      unregisterUp();
      unregisterHome();
      unregisterEnd();
      unregisterEnter();
    };
  }, [focusedIndex, items, onSelect, registerShortcut, setFocusedIndex]);

  // Initialize focus on first item if not set
  React.useEffect(() => {
    if (focusedIndex === -1 && items.length > 0) {
      // Don't auto-focus, wait for user to press j/k
    }
  }, [focusedIndex, items.length]);

  return (
    <div className={className} role="listbox" tabIndex={0}>
      {items.map((item, index) => renderItem(item, index, index === focusedIndex))}
    </div>
  );
}
