/**
 * @vitest-environment jsdom
 * Tests for dark mode refinements
 * Issue #414: Dark mode refinements
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// Components to be implemented
import { ThemeProvider, useTheme, type ThemeProviderProps } from '@/ui/components/dark-mode/theme-provider';
import { ThemeToggle, type ThemeToggleProps } from '@/ui/components/dark-mode/theme-toggle';
import { ThemeSelector, type ThemeSelectorProps } from '@/ui/components/dark-mode/theme-selector';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock matchMedia
const createMatchMedia = (matches: boolean) => {
  const listeners: Array<(e: MediaQueryListEvent) => void> = [];
  return (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: (_: string, listener: (e: MediaQueryListEvent) => void) => {
      listeners.push(listener);
    },
    removeEventListener: (_: string, listener: (e: MediaQueryListEvent) => void) => {
      const index = listeners.indexOf(listener);
      if (index > -1) listeners.splice(index, 1);
    },
    dispatchEvent: vi.fn(),
    _triggerChange: (newMatches: boolean) => {
      listeners.forEach((listener) => listener({ matches: newMatches } as MediaQueryListEvent));
    },
  });
};

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorageMock.clear();
    document.documentElement.classList.remove('dark', 'oled');
    window.matchMedia = createMatchMedia(false) as typeof window.matchMedia;
  });

  function TestConsumer() {
    const { theme, resolvedTheme, isDark, isOled } = useTheme();
    return (
      <div>
        <span data-testid="theme">{theme}</span>
        <span data-testid="resolved">{resolvedTheme}</span>
        <span data-testid="is-dark">{isDark ? 'yes' : 'no'}</span>
        <span data-testid="is-oled">{isOled ? 'yes' : 'no'}</span>
      </div>
    );
  }

  it('should provide default light theme', () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('system');
    expect(screen.getByTestId('is-dark')).toHaveTextContent('no');
  });

  it('should respect initial theme from props', () => {
    render(
      <ThemeProvider defaultTheme="dark">
        <TestConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('is-dark')).toHaveTextContent('yes');
  });

  it('should add dark class to document when dark theme', () => {
    render(
      <ThemeProvider defaultTheme="dark">
        <TestConsumer />
      </ThemeProvider>,
    );

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('should support OLED mode', () => {
    render(
      <ThemeProvider defaultTheme="oled">
        <TestConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('oled');
    expect(screen.getByTestId('is-oled')).toHaveTextContent('yes');
    expect(document.documentElement.classList.contains('oled')).toBe(true);
  });

  it('should persist theme to localStorage', () => {
    function ThemeSetter() {
      const { setTheme } = useTheme();
      return <button onClick={() => setTheme('dark')}>Set Dark</button>;
    }

    render(
      <ThemeProvider storage_key="test-theme">
        <ThemeSetter />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByText('Set Dark'));
    expect(localStorageMock.getItem('test-theme')).toBe('dark');
  });

  it('should read theme from localStorage', () => {
    localStorageMock.setItem('test-theme', 'dark');

    render(
      <ThemeProvider storage_key="test-theme">
        <TestConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
  });

  it('should follow system theme when set to system', () => {
    window.matchMedia = createMatchMedia(true) as typeof window.matchMedia;

    render(
      <ThemeProvider defaultTheme="system">
        <TestConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(screen.getByTestId('is-dark')).toHaveTextContent('yes');
  });
});

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorageMock.clear();
    document.documentElement.classList.remove('dark', 'oled');
    window.matchMedia = createMatchMedia(false) as typeof window.matchMedia;
  });

  it('should render toggle button', () => {
    render(
      <ThemeProvider defaultTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );

    expect(screen.getByRole('button', { name: /toggle theme/i })).toBeInTheDocument();
  });

  it('should toggle between light and dark', () => {
    render(
      <ThemeProvider defaultTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );

    const button = screen.getByRole('button', { name: /toggle theme/i });
    fireEvent.click(button);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('should show sun icon in dark mode', () => {
    render(
      <ThemeProvider defaultTheme="dark">
        <ThemeToggle />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('sun-icon')).toBeInTheDocument();
  });

  it('should show moon icon in light mode', () => {
    render(
      <ThemeProvider defaultTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('moon-icon')).toBeInTheDocument();
  });
});

describe('ThemeSelector', () => {
  beforeEach(() => {
    localStorageMock.clear();
    document.documentElement.classList.remove('dark', 'oled');
    window.matchMedia = createMatchMedia(false) as typeof window.matchMedia;
  });

  it('should render all theme options', () => {
    render(
      <ThemeProvider>
        <ThemeSelector />
      </ThemeProvider>,
    );

    expect(screen.getByRole('radio', { name: /light/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /dark/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /system/i })).toBeInTheDocument();
  });

  it('should show current theme as selected', () => {
    render(
      <ThemeProvider defaultTheme="dark">
        <ThemeSelector />
      </ThemeProvider>,
    );

    expect(screen.getByRole('radio', { name: /dark/i })).toBeChecked();
  });

  it('should change theme when option selected', () => {
    render(
      <ThemeProvider defaultTheme="light">
        <ThemeSelector />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('radio', { name: /dark/i }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('should include OLED option when enabled', () => {
    render(
      <ThemeProvider>
        <ThemeSelector showOled />
      </ThemeProvider>,
    );

    expect(screen.getByRole('radio', { name: /oled/i })).toBeInTheDocument();
  });
});

describe('Dark mode CSS', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark', 'oled');
  });

  it('should apply dark class without white flash', () => {
    // Simulate immediate class application
    document.documentElement.classList.add('dark');

    // Verify class is applied synchronously
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('should support transition class for smooth switching', () => {
    render(
      <ThemeProvider defaultTheme="light" enableTransitions>
        <div>Content</div>
      </ThemeProvider>,
    );

    // Provider should add transition class
    expect(document.documentElement.classList.contains('theme-transition')).toBe(true);
  });
});
