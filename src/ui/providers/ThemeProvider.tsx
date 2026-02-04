/**
 * Theme Provider - React context for managing light/dark/oled/system themes.
 * Issue #477: Dark mode and theme system refinement
 *
 * Reads initial theme from: localStorage -> system preference -> light
 * Applies `.dark` or `.oled` class to `<html>` element
 * Exposes theme, setTheme, resolvedTheme to consumers
 * Syncs with prefers-color-scheme media query changes
 * Supports 200ms CSS transition for smooth theme switching
 */
import * as React from 'react';

/** Supported theme values. */
export type Theme = 'light' | 'dark' | 'oled' | 'system';

/** Resolved (effective) theme after evaluating system preference. */
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeProviderProps {
  children: React.ReactNode;
  /** Default theme when no stored preference exists. Defaults to 'system'. */
  defaultTheme?: Theme;
  /** localStorage key for theme persistence. Defaults to 'openclaw-theme'. */
  storageKey?: string;
  /** Enable 200ms CSS transitions when switching themes. Defaults to true. */
  enableTransitions?: boolean;
}

export interface ThemeContextValue {
  /** Currently selected theme preference (may be 'system'). */
  theme: Theme;
  /** Effective theme after resolving 'system' to 'light' or 'dark'. */
  resolvedTheme: ResolvedTheme;
  /** Update the theme preference. Persists to localStorage. */
  setTheme: (theme: Theme) => void;
  /** Toggle between light and dark (based on resolved theme). */
  toggleTheme: () => void;
  /** Whether the resolved theme is dark (convenience). */
  isDark: boolean;
  /** Whether OLED mode is active (convenience). */
  isOled: boolean;
}

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined);

/**
 * Resolve the effective theme given a preference and system dark mode state.
 */
function resolveTheme(theme: Theme, systemIsDark: boolean): ResolvedTheme {
  if (theme === 'dark' || theme === 'oled') return 'dark';
  if (theme === 'system') return systemIsDark ? 'dark' : 'light';
  return 'light';
}

/**
 * Read the initial theme from localStorage, falling back to defaultTheme.
 * Validates that the stored value is a valid Theme.
 */
function getInitialTheme(storageKey: string, defaultTheme: Theme): Theme {
  if (typeof window === 'undefined') return defaultTheme;
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === 'light' || stored === 'dark' || stored === 'oled' || stored === 'system') {
      return stored;
    }
  } catch {
    // localStorage may be unavailable (private browsing, etc.)
  }
  return defaultTheme;
}

/**
 * Apply the appropriate CSS classes to the HTML element.
 */
function applyThemeClasses(theme: Theme, systemIsDark: boolean): void {
  const root = document.documentElement;
  root.classList.remove('dark', 'oled');

  if (theme === 'dark') {
    root.classList.add('dark');
  } else if (theme === 'oled') {
    root.classList.add('dark', 'oled');
  } else if (theme === 'system' && systemIsDark) {
    root.classList.add('dark');
  }
  // light: no classes needed
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'openclaw-theme',
  enableTransitions = true,
}: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<Theme>(() =>
    getInitialTheme(storageKey, defaultTheme)
  );

  const [systemIsDark, setSystemIsDark] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const resolved = resolveTheme(theme, systemIsDark);

  // Apply theme classes to HTML element whenever theme or system preference changes
  React.useEffect(() => {
    const root = document.documentElement;

    // Add transition class if enabled
    if (enableTransitions) {
      root.classList.add('theme-transition');
    } else {
      root.classList.remove('theme-transition');
    }

    applyThemeClasses(theme, systemIsDark);
  }, [theme, systemIsDark, enableTransitions]);

  // Listen for system theme changes
  React.useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handler = (e: MediaQueryListEvent) => {
      setSystemIsDark(e.matches);
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  const setTheme = React.useCallback(
    (newTheme: Theme) => {
      setThemeState(newTheme);
      try {
        localStorage.setItem(storageKey, newTheme);
      } catch {
        // localStorage may be unavailable
      }
    },
    [storageKey]
  );

  const toggleTheme = React.useCallback(() => {
    setTheme(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setTheme]);

  const value: ThemeContextValue = React.useMemo(
    () => ({
      theme,
      resolvedTheme: resolved,
      setTheme,
      toggleTheme,
      isDark: resolved === 'dark',
      isOled: theme === 'oled',
    }),
    [theme, resolved, setTheme, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Hook to consume the theme context.
 * Must be used within a ThemeProvider.
 */
export function useThemeContext(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error('useThemeContext must be used within a ThemeProvider');
  }
  return context;
}

/** Re-export the context for advanced use cases. */
export { ThemeContext };
