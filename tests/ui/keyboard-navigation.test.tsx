/**
 * @vitest-environment jsdom
 * Tests for keyboard navigation
 * Issue #410: Implement keyboard navigation throughout
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// Components to be implemented
import { KeyboardNavigationProvider, useKeyboardNavigation } from '@/ui/components/keyboard-navigation/keyboard-navigation-context';
import { KeyboardNavigableList, type KeyboardNavigableListProps } from '@/ui/components/keyboard-navigation/keyboard-navigable-list';
import { FocusRing, type FocusRingProps } from '@/ui/components/keyboard-navigation/focus-ring';
import { ShortcutHint, type ShortcutHintProps } from '@/ui/components/keyboard-navigation/shortcut-hint';
import type { NavigableItem } from '@/ui/components/keyboard-navigation/types';

// Test component that uses the hook
function TestKeyboardConsumer({ onAction }: { onAction?: (action: string) => void }) {
  const { focusedIndex, setFocusedIndex, registerShortcut } = useKeyboardNavigation();

  React.useEffect(() => {
    const unregister = registerShortcut({
      key: 'n',
      action: () => onAction?.('new'),
      description: 'Create new item',
    });
    return unregister;
  }, [registerShortcut, onAction]);

  return (
    <div data-testid="consumer">
      <span data-testid="focused-index">{focusedIndex}</span>
      <button onClick={() => setFocusedIndex(5)}>Set Focus</button>
    </div>
  );
}

describe('KeyboardNavigationProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should provide context to children', () => {
    render(
      <KeyboardNavigationProvider>
        <TestKeyboardConsumer />
      </KeyboardNavigationProvider>,
    );

    expect(screen.getByTestId('consumer')).toBeInTheDocument();
  });

  it('should track focused index', () => {
    render(
      <KeyboardNavigationProvider>
        <TestKeyboardConsumer />
      </KeyboardNavigationProvider>,
    );

    expect(screen.getByTestId('focused-index')).toHaveTextContent('-1');

    fireEvent.click(screen.getByText('Set Focus'));

    expect(screen.getByTestId('focused-index')).toHaveTextContent('5');
  });

  it('should handle registered shortcuts', () => {
    const onAction = vi.fn();
    render(
      <KeyboardNavigationProvider>
        <TestKeyboardConsumer onAction={onAction} />
      </KeyboardNavigationProvider>,
    );

    fireEvent.keyDown(document, { key: 'n' });

    expect(onAction).toHaveBeenCalledWith('new');
  });

  it('should not trigger shortcuts when input focused', () => {
    const onAction = vi.fn();
    render(
      <KeyboardNavigationProvider>
        <TestKeyboardConsumer onAction={onAction} />
        <input data-testid="input" />
      </KeyboardNavigationProvider>,
    );

    const input = screen.getByTestId('input');
    input.focus();
    fireEvent.keyDown(input, { key: 'n' });

    expect(onAction).not.toHaveBeenCalled();
  });
});

describe('KeyboardNavigableList', () => {
  const mockItems: NavigableItem[] = [
    { id: 'item-1', label: 'Item 1' },
    { id: 'item-2', label: 'Item 2' },
    { id: 'item-3', label: 'Item 3' },
  ];

  const defaultProps: KeyboardNavigableListProps = {
    items: mockItems,
    onSelect: vi.fn(),
    renderItem: (item, index, isFocused) => (
      <div key={item.id} data-focused={isFocused}>
        {item.label}
      </div>
    ),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render all items', () => {
    render(
      <KeyboardNavigationProvider>
        <KeyboardNavigableList {...defaultProps} />
      </KeyboardNavigationProvider>,
    );

    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
    expect(screen.getByText('Item 3')).toBeInTheDocument();
  });

  it('should navigate down with j key', () => {
    render(
      <KeyboardNavigationProvider>
        <KeyboardNavigableList {...defaultProps} />
      </KeyboardNavigationProvider>,
    );

    fireEvent.keyDown(document, { key: 'j' });

    const item1 = screen.getByText('Item 1').closest('[data-focused]');
    expect(item1).toHaveAttribute('data-focused', 'true');
  });

  it('should navigate up with k key', () => {
    render(
      <KeyboardNavigationProvider initialFocusIndex={1}>
        <KeyboardNavigableList {...defaultProps} />
      </KeyboardNavigationProvider>,
    );

    fireEvent.keyDown(document, { key: 'k' });

    const item1 = screen.getByText('Item 1').closest('[data-focused]');
    expect(item1).toHaveAttribute('data-focused', 'true');
  });

  it('should navigate with arrow keys', () => {
    render(
      <KeyboardNavigationProvider>
        <KeyboardNavigableList {...defaultProps} />
      </KeyboardNavigationProvider>,
    );

    fireEvent.keyDown(document, { key: 'ArrowDown' });

    const item1 = screen.getByText('Item 1').closest('[data-focused]');
    expect(item1).toHaveAttribute('data-focused', 'true');
  });

  it('should select item on enter', () => {
    const onSelect = vi.fn();
    render(
      <KeyboardNavigationProvider initialFocusIndex={0}>
        <KeyboardNavigableList {...defaultProps} onSelect={onSelect} />
      </KeyboardNavigationProvider>,
    );

    fireEvent.keyDown(document, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith(mockItems[0]);
  });

  it('should not go below last item', () => {
    render(
      <KeyboardNavigationProvider initialFocusIndex={2}>
        <KeyboardNavigableList {...defaultProps} />
      </KeyboardNavigationProvider>,
    );

    fireEvent.keyDown(document, { key: 'j' });
    fireEvent.keyDown(document, { key: 'j' });

    const item3 = screen.getByText('Item 3').closest('[data-focused]');
    expect(item3).toHaveAttribute('data-focused', 'true');
  });

  it('should not go above first item', () => {
    render(
      <KeyboardNavigationProvider initialFocusIndex={0}>
        <KeyboardNavigableList {...defaultProps} />
      </KeyboardNavigationProvider>,
    );

    fireEvent.keyDown(document, { key: 'k' });

    const item1 = screen.getByText('Item 1').closest('[data-focused]');
    expect(item1).toHaveAttribute('data-focused', 'true');
  });

  it('should go to first item on home key', () => {
    render(
      <KeyboardNavigationProvider initialFocusIndex={2}>
        <KeyboardNavigableList {...defaultProps} />
      </KeyboardNavigationProvider>,
    );

    fireEvent.keyDown(document, { key: 'Home' });

    const item1 = screen.getByText('Item 1').closest('[data-focused]');
    expect(item1).toHaveAttribute('data-focused', 'true');
  });

  it('should go to last item on end key', () => {
    render(
      <KeyboardNavigationProvider initialFocusIndex={0}>
        <KeyboardNavigableList {...defaultProps} />
      </KeyboardNavigationProvider>,
    );

    fireEvent.keyDown(document, { key: 'End' });

    const item3 = screen.getByText('Item 3').closest('[data-focused]');
    expect(item3).toHaveAttribute('data-focused', 'true');
  });
});

describe('FocusRing', () => {
  const defaultProps: FocusRingProps = {
    children: <button>Click me</button>,
  };

  it('should render children', () => {
    render(<FocusRing {...defaultProps} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('should show focus ring when child is focused', () => {
    render(<FocusRing {...defaultProps} />);

    const button = screen.getByRole('button');
    button.focus();

    // Check that focus ring wrapper exists
    const wrapper = button.closest('[data-focus-visible]');
    expect(wrapper).toBeInTheDocument();
  });

  it('should not show focus ring on mouse click', () => {
    render(<FocusRing {...defaultProps} />);

    const button = screen.getByRole('button');
    fireEvent.mouseDown(button);
    fireEvent.click(button);

    const wrapper = button.closest('[data-focus-visible]');
    expect(wrapper).toHaveAttribute('data-focus-visible', 'false');
  });

  it('should apply custom className', () => {
    render(<FocusRing {...defaultProps} className="custom-class" />);

    const wrapper = screen.getByRole('button').closest('.custom-class');
    expect(wrapper).toBeInTheDocument();
  });
});

describe('ShortcutHint', () => {
  const defaultProps: ShortcutHintProps = {
    keys: ['Cmd', 'K'],
    description: 'Open search',
  };

  it('should render shortcut keys', () => {
    render(<ShortcutHint {...defaultProps} />);
    expect(screen.getByText('⌘')).toBeInTheDocument();
    expect(screen.getByText('K')).toBeInTheDocument();
  });

  it('should show description', () => {
    render(<ShortcutHint {...defaultProps} />);
    expect(screen.getByText('Open search')).toBeInTheDocument();
  });

  it('should render single key shortcuts', () => {
    render(<ShortcutHint keys={['J']} description="Move down" />);
    expect(screen.getByText('J')).toBeInTheDocument();
    expect(screen.getByText('Move down')).toBeInTheDocument();
  });

  it('should format modifier keys correctly', () => {
    render(<ShortcutHint keys={['Ctrl', 'Shift', 'P']} description="Command" />);
    expect(screen.getByText('⌃')).toBeInTheDocument();
    expect(screen.getByText('⇧')).toBeInTheDocument();
    expect(screen.getByText('P')).toBeInTheDocument();
  });

  it('should handle compact mode', () => {
    render(<ShortcutHint {...defaultProps} compact />);
    const container = screen.getByTestId('shortcut-hint');
    expect(container).toHaveAttribute('data-compact', 'true');
  });
});
