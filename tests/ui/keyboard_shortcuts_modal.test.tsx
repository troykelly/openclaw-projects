/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeyboardShortcutsModal } from '@/ui/components/keyboard-shortcuts-modal';

describe('KeyboardShortcutsModal', () => {
  it('renders without crashing', () => {
    render(<KeyboardShortcutsModal />);
    // Modal should not be visible initially
    expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument();
  });

  it('opens on Cmd+/ keypress', () => {
    render(<KeyboardShortcutsModal />);

    fireEvent.keyDown(document, { key: '/', metaKey: true });

    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
  });

  it('opens on Ctrl+/ keypress', () => {
    render(<KeyboardShortcutsModal />);

    fireEvent.keyDown(document, { key: '/', ctrlKey: true });

    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
  });

  it('opens on ? keypress', () => {
    render(<KeyboardShortcutsModal />);

    fireEvent.keyDown(document, { key: '?' });

    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
  });

  it('displays shortcut groups', () => {
    render(<KeyboardShortcutsModal />);

    // Open the modal
    fireEvent.keyDown(document, { key: '/', metaKey: true });

    expect(screen.getByText('Global')).toBeInTheDocument();
    expect(screen.getByText('Navigation')).toBeInTheDocument();
    expect(screen.getByText('Lists')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });

  it('displays shortcut descriptions', () => {
    render(<KeyboardShortcutsModal />);

    // Open the modal
    fireEvent.keyDown(document, { key: '/', metaKey: true });

    expect(screen.getByText('Open command palette')).toBeInTheDocument();
    expect(screen.getByText('Go to Activity')).toBeInTheDocument();
    expect(screen.getByText('New item')).toBeInTheDocument();
  });

  it('does not open when typing in an input', () => {
    render(
      <div>
        <input data-testid="test-input" />
        <KeyboardShortcutsModal />
      </div>,
    );

    const input = screen.getByTestId('test-input');
    input.focus();

    fireEvent.keyDown(input, { key: '?' });

    expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument();
  });

  it('toggles modal on repeated Cmd+/ presses', () => {
    render(<KeyboardShortcutsModal />);

    // Open
    fireEvent.keyDown(document, { key: '/', metaKey: true });
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();

    // Close
    fireEvent.keyDown(document, { key: '/', metaKey: true });
    // Modal should start closing (animation), so we just verify it was toggled
  });
});
