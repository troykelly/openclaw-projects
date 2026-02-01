/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { KeyboardShortcutsHandler } from '@/ui/components/keyboard-shortcuts-handler';

describe('KeyboardShortcutsHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Navigation shortcuts (G then X)', () => {
    it('navigates to Activity on G then A', () => {
      const onNavigate = vi.fn();
      render(<KeyboardShortcutsHandler onNavigate={onNavigate} />);

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
      });
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      });

      expect(onNavigate).toHaveBeenCalledWith('activity');
    });

    it('navigates to Projects on G then P', () => {
      const onNavigate = vi.fn();
      render(<KeyboardShortcutsHandler onNavigate={onNavigate} />);

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
      });
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
      });

      expect(onNavigate).toHaveBeenCalledWith('projects');
    });

    it('navigates to Timeline on G then T', () => {
      const onNavigate = vi.fn();
      render(<KeyboardShortcutsHandler onNavigate={onNavigate} />);

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
      });
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 't' }));
      });

      expect(onNavigate).toHaveBeenCalledWith('timeline');
    });

    it('navigates to Contacts on G then C', () => {
      const onNavigate = vi.fn();
      render(<KeyboardShortcutsHandler onNavigate={onNavigate} />);

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
      });
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }));
      });

      expect(onNavigate).toHaveBeenCalledWith('people');
    });

    it('navigates to Settings on G then S', () => {
      const onNavigate = vi.fn();
      render(<KeyboardShortcutsHandler onNavigate={onNavigate} />);

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
      });
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
      });

      expect(onNavigate).toHaveBeenCalledWith('settings');
    });
  });

  describe('List navigation', () => {
    it('calls onMoveDown on J', () => {
      const onMoveDown = vi.fn();
      render(<KeyboardShortcutsHandler onMoveDown={onMoveDown} />);

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
      });

      expect(onMoveDown).toHaveBeenCalledTimes(1);
    });

    it('calls onMoveUp on K', () => {
      const onMoveUp = vi.fn();
      render(<KeyboardShortcutsHandler onMoveUp={onMoveUp} />);

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));
      });

      expect(onMoveUp).toHaveBeenCalledTimes(1);
    });

    it('calls onOpenSelected on Enter', () => {
      const onOpenSelected = vi.fn();
      render(<KeyboardShortcutsHandler onOpenSelected={onOpenSelected} />);

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      });

      expect(onOpenSelected).toHaveBeenCalledTimes(1);
    });

    it('calls onBack on Backspace', () => {
      const onBack = vi.fn();
      render(<KeyboardShortcutsHandler onBack={onBack} />);

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
      });

      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('Action shortcuts', () => {
    it('calls onNewItem on N', () => {
      const onNewItem = vi.fn();
      render(<KeyboardShortcutsHandler onNewItem={onNewItem} />);

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));
      });

      expect(onNewItem).toHaveBeenCalledTimes(1);
    });

    it('calls onEdit on E', () => {
      const onEdit = vi.fn();
      render(<KeyboardShortcutsHandler onEdit={onEdit} />);

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));
      });

      expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it('calls onDelete on D', () => {
      const onDelete = vi.fn();
      render(<KeyboardShortcutsHandler onDelete={onDelete} />);

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
      });

      expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it('calls onChangeStatus on S', () => {
      const onChangeStatus = vi.fn();
      render(<KeyboardShortcutsHandler onChangeStatus={onChangeStatus} />);

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
      });

      expect(onChangeStatus).toHaveBeenCalledTimes(1);
    });

    it('calls onSelect on Space', () => {
      const onSelect = vi.fn();
      render(<KeyboardShortcutsHandler onSelect={onSelect} />);

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
      });

      expect(onSelect).toHaveBeenCalledTimes(1);
    });
  });

  describe('Global shortcuts', () => {
    it('calls onSearch on Cmd+K', () => {
      const onSearch = vi.fn();
      render(<KeyboardShortcutsHandler onSearch={onSearch} />);

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
      });

      expect(onSearch).toHaveBeenCalledTimes(1);
    });

    it('calls onSearch on Ctrl+K', () => {
      const onSearch = vi.fn();
      render(<KeyboardShortcutsHandler onSearch={onSearch} />);

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
      });

      expect(onSearch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Input field handling', () => {
    it('does not trigger shortcuts when typing in input', () => {
      const onNewItem = vi.fn();
      render(<KeyboardShortcutsHandler onNewItem={onNewItem} />);

      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      act(() => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
      });

      expect(onNewItem).not.toHaveBeenCalled();
      document.body.removeChild(input);
    });
  });
});
