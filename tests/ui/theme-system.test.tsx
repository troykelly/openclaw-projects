/**
 * @vitest-environment jsdom
 * Tests for theme system refinement.
 * Issue #477: Dark mode and theme system refinement
 *
 * Covers:
 * - Default theme selection (localStorage, system, fallback)
 * - Theme switching (light -> dark -> oled)
 * - System theme detection and reactivity
 * - Theme persistence to localStorage
 * - CSS class application on html element
 * - OLED mode specifics
 * - Transition class management
 * - useTheme hook behaviour
 * - ThemeProvider error handling
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

import { ThemeProvider, useThemeContext, type Theme } from '@/ui/providers/ThemeProvider';
import { useTheme } from '@/ui/hooks/use-theme';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Custom localStorage mock with inspection capabilities. */
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: () => {
      store = {};
    },
    _store: () => ({ ...store }),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  configurable: true,
  writable: true,
});

/** Track matchMedia listeners so we can simulate system theme changes. */
type MediaChangeListener = (e: MediaQueryListEvent) => void;
let mediaListeners: MediaChangeListener[] = [];
let currentMediaMatches = false;

function setupMatchMedia(matches: boolean) {
  currentMediaMatches = matches;
  mediaListeners = [];

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: currentMediaMatches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((_: string, listener: MediaChangeListener) => {
        mediaListeners.push(listener);
      }),
      removeEventListener: vi.fn((_: string, listener: MediaChangeListener) => {
        const index = mediaListeners.indexOf(listener);
        if (index > -1) mediaListeners.splice(index, 1);
      }),
      dispatchEvent: vi.fn(),
    })),
  });
}

/** Simulate a system theme change (prefers-color-scheme). */
function triggerSystemThemeChange(dark: boolean) {
  currentMediaMatches = dark;
  mediaListeners.forEach((fn) => fn({ matches: dark } as MediaQueryListEvent));
}

/** Simple consumer component that exposes all context values for assertions. */
function ThemeConsumer() {
  const ctx = useThemeContext();
  return (
    <div>
      <span data-testid="theme">{ctx.theme}</span>
      <span data-testid="resolved">{ctx.resolvedTheme}</span>
      <span data-testid="is-dark">{ctx.isDark ? 'yes' : 'no'}</span>
      <span data-testid="is-oled">{ctx.isOled ? 'yes' : 'no'}</span>
    </div>
  );
}

/** Consumer using the convenience hook re-export. */
function HookConsumer() {
  const { theme, resolvedTheme, isDark, isOled } = useTheme();
  return (
    <div>
      <span data-testid="hook-theme">{theme}</span>
      <span data-testid="hook-resolved">{resolvedTheme}</span>
      <span data-testid="hook-is-dark">{isDark ? 'yes' : 'no'}</span>
      <span data-testid="hook-is-oled">{isOled ? 'yes' : 'no'}</span>
    </div>
  );
}

/** Consumer that exposes setTheme and toggleTheme actions. */
function ThemeActions() {
  const { setTheme, toggleTheme } = useThemeContext();
  return (
    <div>
      <button data-testid="set-light" onClick={() => setTheme('light')}>
        Light
      </button>
      <button data-testid="set-dark" onClick={() => setTheme('dark')}>
        Dark
      </button>
      <button data-testid="set-oled" onClick={() => setTheme('oled')}>
        OLED
      </button>
      <button data-testid="set-system" onClick={() => setTheme('system')}>
        System
      </button>
      <button data-testid="toggle" onClick={toggleTheme}>
        Toggle
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorageMock.clear();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  document.documentElement.classList.remove('dark', 'oled', 'theme-transition');
  setupMatchMedia(false);
});

afterEach(() => {
  document.documentElement.classList.remove('dark', 'oled', 'theme-transition');
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ThemeProvider — default theme selection', () => {
  it('defaults to system when no localStorage value exists', () => {
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('system');
  });

  it('resolves to light when system prefers light and theme is system', () => {
    setupMatchMedia(false);

    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    expect(screen.getByTestId('is-dark')).toHaveTextContent('no');
  });

  it('reads initial theme from localStorage', () => {
    localStorageMock.setItem('openclaw-theme', 'dark');

    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('is-dark')).toHaveTextContent('yes');
  });

  it('falls back to defaultTheme prop when localStorage is empty', () => {
    render(
      <ThemeProvider defaultTheme="dark">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('is-dark')).toHaveTextContent('yes');
  });

  it('uses light as ultimate fallback (system prefers light, no stored value)', () => {
    setupMatchMedia(false);

    render(
      <ThemeProvider defaultTheme="system">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
  });

  it('ignores invalid localStorage values and uses defaultTheme', () => {
    localStorageMock.setItem('openclaw-theme', 'invalid-value');

    render(
      <ThemeProvider defaultTheme="light">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('light');
  });
});

describe('ThemeProvider — theme switching', () => {
  it('switches from light to dark', () => {
    render(
      <ThemeProvider defaultTheme="light">
        <ThemeConsumer />
        <ThemeActions />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('resolved')).toHaveTextContent('light');

    fireEvent.click(screen.getByTestId('set-dark'));

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(screen.getByTestId('is-dark')).toHaveTextContent('yes');
  });

  it('switches from dark to oled', () => {
    render(
      <ThemeProvider defaultTheme="dark">
        <ThemeConsumer />
        <ThemeActions />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByTestId('set-oled'));

    expect(screen.getByTestId('theme')).toHaveTextContent('oled');
    expect(screen.getByTestId('is-oled')).toHaveTextContent('yes');
    expect(screen.getByTestId('is-dark')).toHaveTextContent('yes');
  });

  it('switches from oled to light', () => {
    render(
      <ThemeProvider defaultTheme="oled">
        <ThemeConsumer />
        <ThemeActions />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByTestId('set-light'));

    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(screen.getByTestId('is-dark')).toHaveTextContent('no');
    expect(screen.getByTestId('is-oled')).toHaveTextContent('no');
  });

  it('toggleTheme switches from light to dark', () => {
    render(
      <ThemeProvider defaultTheme="light">
        <ThemeConsumer />
        <ThemeActions />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByTestId('toggle'));

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('is-dark')).toHaveTextContent('yes');
  });

  it('toggleTheme switches from dark to light', () => {
    render(
      <ThemeProvider defaultTheme="dark">
        <ThemeConsumer />
        <ThemeActions />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByTestId('toggle'));

    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(screen.getByTestId('is-dark')).toHaveTextContent('no');
  });
});

describe('ThemeProvider — system theme detection', () => {
  it('resolves to dark when system prefers dark and theme is system', () => {
    setupMatchMedia(true);

    render(
      <ThemeProvider defaultTheme="system">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(screen.getByTestId('is-dark')).toHaveTextContent('yes');
  });

  it('reacts to system theme changes when theme is system', () => {
    setupMatchMedia(false);

    render(
      <ThemeProvider defaultTheme="system">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('resolved')).toHaveTextContent('light');

    // Simulate system switching to dark
    act(() => {
      triggerSystemThemeChange(true);
    });

    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(screen.getByTestId('is-dark')).toHaveTextContent('yes');
  });

  it('ignores system changes when theme is explicitly set to light', () => {
    setupMatchMedia(false);

    render(
      <ThemeProvider defaultTheme="light">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    // Simulate system switching to dark
    act(() => {
      triggerSystemThemeChange(true);
    });

    // Should still be light because theme is explicitly 'light', not 'system'
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    expect(screen.getByTestId('is-dark')).toHaveTextContent('no');
  });

  it('ignores system changes when theme is explicitly set to dark', () => {
    setupMatchMedia(true);

    render(
      <ThemeProvider defaultTheme="dark">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    // Simulate system switching to light
    act(() => {
      triggerSystemThemeChange(false);
    });

    // Should still be dark because theme is explicitly 'dark'
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(screen.getByTestId('is-dark')).toHaveTextContent('yes');
  });
});

describe('ThemeProvider — localStorage persistence', () => {
  it('persists theme to localStorage on setTheme', () => {
    render(
      <ThemeProvider>
        <ThemeActions />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByTestId('set-dark'));

    expect(localStorageMock.getItem('openclaw-theme')).toBe('dark');
  });

  it('uses custom storage key', () => {
    render(
      <ThemeProvider storageKey="custom-theme-key">
        <ThemeActions />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByTestId('set-oled'));

    expect(localStorageMock.getItem('custom-theme-key')).toBe('oled');
  });

  it('reads from custom storage key on init', () => {
    localStorageMock.setItem('my-app-theme', 'oled');

    render(
      <ThemeProvider storageKey="my-app-theme">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('oled');
    expect(screen.getByTestId('is-oled')).toHaveTextContent('yes');
  });

  it('persists each theme change', () => {
    render(
      <ThemeProvider>
        <ThemeActions />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByTestId('set-dark'));
    expect(localStorageMock.getItem('openclaw-theme')).toBe('dark');

    fireEvent.click(screen.getByTestId('set-light'));
    expect(localStorageMock.getItem('openclaw-theme')).toBe('light');

    fireEvent.click(screen.getByTestId('set-oled'));
    expect(localStorageMock.getItem('openclaw-theme')).toBe('oled');
  });
});

describe('ThemeProvider — CSS class application', () => {
  it('adds .dark class for dark theme', () => {
    render(
      <ThemeProvider defaultTheme="dark">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('oled')).toBe(false);
  });

  it('adds .dark and .oled classes for oled theme', () => {
    render(
      <ThemeProvider defaultTheme="oled">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('oled')).toBe(true);
  });

  it('removes all theme classes for light theme', () => {
    // Start with dark classes
    document.documentElement.classList.add('dark', 'oled');

    render(
      <ThemeProvider defaultTheme="light">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.classList.contains('oled')).toBe(false);
  });

  it('adds .dark class when system prefers dark and theme is system', () => {
    setupMatchMedia(true);

    render(
      <ThemeProvider defaultTheme="system">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes .dark class when system prefers light and theme is system', () => {
    setupMatchMedia(false);
    document.documentElement.classList.add('dark');

    render(
      <ThemeProvider defaultTheme="system">
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('updates classes when theme is switched', () => {
    render(
      <ThemeProvider defaultTheme="light">
        <ThemeConsumer />
        <ThemeActions />
      </ThemeProvider>,
    );

    expect(document.documentElement.classList.contains('dark')).toBe(false);

    fireEvent.click(screen.getByTestId('set-dark'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    fireEvent.click(screen.getByTestId('set-oled'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('oled')).toBe(true);

    fireEvent.click(screen.getByTestId('set-light'));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.classList.contains('oled')).toBe(false);
  });
});

describe('ThemeProvider — transitions', () => {
  it('adds theme-transition class when enableTransitions is true (default)', () => {
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(document.documentElement.classList.contains('theme-transition')).toBe(true);
  });

  it('does not add theme-transition class when enableTransitions is false', () => {
    render(
      <ThemeProvider enableTransitions={false}>
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(document.documentElement.classList.contains('theme-transition')).toBe(false);
  });
});

describe('useTheme hook', () => {
  it('re-exports work identically to useThemeContext', () => {
    render(
      <ThemeProvider defaultTheme="dark">
        <HookConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('hook-theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('hook-resolved')).toHaveTextContent('dark');
    expect(screen.getByTestId('hook-is-dark')).toHaveTextContent('yes');
    expect(screen.getByTestId('hook-is-oled')).toHaveTextContent('no');
  });

  it('throws when used outside ThemeProvider', () => {
    // Suppress React error boundary console output
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    function BadConsumer() {
      useThemeContext();
      return <div />;
    }

    expect(() => {
      render(<BadConsumer />);
    }).toThrow('useThemeContext must be used within a ThemeProvider');

    consoleError.mockRestore();
  });
});

describe('ThemeProvider — backward compatibility', () => {
  it('re-exported useTheme from dark-mode module works', async () => {
    // Dynamic import to verify the re-export path works
    const { useTheme: useThemeFromDarkMode } = await import('@/ui/components/dark-mode/theme-provider');

    function DarkModeConsumer() {
      const { theme, resolvedTheme } = useThemeFromDarkMode();
      return (
        <div>
          <span data-testid="dm-theme">{theme}</span>
          <span data-testid="dm-resolved">{resolvedTheme}</span>
        </div>
      );
    }

    render(
      <ThemeProvider defaultTheme="oled">
        <DarkModeConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('dm-theme')).toHaveTextContent('oled');
    expect(screen.getByTestId('dm-resolved')).toHaveTextContent('dark');
  });
});
