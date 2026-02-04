/**
 * Theme Provider re-export.
 * Issue #477: Dark mode and theme system refinement
 *
 * The canonical ThemeProvider now lives in src/ui/providers/ThemeProvider.tsx.
 * This module re-exports everything for backward compatibility with existing
 * imports from '@/ui/components/dark-mode/theme-provider'.
 */
export {
  ThemeProvider,
  useThemeContext as useTheme,
  ThemeContext,
} from '@/ui/providers/ThemeProvider';
export type {
  Theme,
  ResolvedTheme,
  ThemeProviderProps,
  ThemeContextValue,
} from '@/ui/providers/ThemeProvider';
