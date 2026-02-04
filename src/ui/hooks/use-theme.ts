/**
 * Theme hook - convenient access to the ThemeProvider context.
 * Issue #477: Dark mode and theme system refinement
 *
 * Re-exports useThemeContext from the ThemeProvider for ergonomic imports.
 */
export { useThemeContext as useTheme } from '@/ui/providers/ThemeProvider';
export type {
  Theme,
  ResolvedTheme,
  ThemeContextValue,
} from '@/ui/providers/ThemeProvider';
