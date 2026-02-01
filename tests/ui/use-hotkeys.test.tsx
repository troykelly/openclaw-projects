/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHotkeys, useSequentialHotkeys, HotkeysProvider, useHotkeysContext } from '@/ui/hooks/use-hotkeys';

describe('useHotkeys', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls handler on matching keypress', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys('n', handler));

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('handles modifier keys correctly', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys('ctrl+s', handler));

    // Without modifier - should not trigger
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
    });
    expect(handler).not.toHaveBeenCalled();

    // With modifier - should trigger
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('handles meta key (cmd)', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys('meta+k', handler));

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not trigger when typing in input', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys('n', handler));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    });

    expect(handler).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('does not trigger when typing in textarea', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys('n', handler));

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    });

    expect(handler).not.toHaveBeenCalled();
    document.body.removeChild(textarea);
  });

  it('handles case-insensitive keys', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys('N', handler));

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('cleans up event listeners on unmount', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useHotkeys('n', handler));

    unmount();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('handles escape key', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys('escape', handler));

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('useSequentialHotkeys', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('triggers on correct key sequence', () => {
    const handler = vi.fn();
    renderHook(() => useSequentialHotkeys(['g', 'a'], handler));

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not trigger on wrong sequence', () => {
    const handler = vi.fn();
    renderHook(() => useSequentialHotkeys(['g', 'a'], handler));

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('resets sequence after timeout', () => {
    const handler = vi.fn();
    renderHook(() => useSequentialHotkeys(['g', 'a'], handler, { timeout: 1000 }));

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
    });

    // Wait for timeout
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not trigger when typing in input', () => {
    const handler = vi.fn();
    renderHook(() => useSequentialHotkeys(['g', 'a'], handler));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    });

    expect(handler).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });
});

describe('HotkeysProvider', () => {
  it('provides context to children', () => {
    let contextValue: ReturnType<typeof useHotkeysContext> | undefined;

    function TestChild() {
      contextValue = useHotkeysContext();
      return null;
    }

    renderHook(() => null, {
      wrapper: ({ children }) => (
        <HotkeysProvider>
          <TestChild />
          {children}
        </HotkeysProvider>
      ),
    });

    expect(contextValue).toBeDefined();
    expect(contextValue?.isEnabled).toBe(true);
  });

  it('allows disabling hotkeys globally', () => {
    const handler = vi.fn();
    let contextValue: ReturnType<typeof useHotkeysContext> | undefined;

    function TestChild() {
      contextValue = useHotkeysContext();
      useHotkeys('n', handler);
      return null;
    }

    renderHook(() => null, {
      wrapper: ({ children }) => (
        <HotkeysProvider>
          <TestChild />
          {children}
        </HotkeysProvider>
      ),
    });

    // Disable hotkeys
    act(() => {
      contextValue?.setEnabled(false);
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));
    });

    expect(handler).not.toHaveBeenCalled();
  });
});
