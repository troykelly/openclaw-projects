/**
 * Generic media query hook.
 *
 * Subscribes to a CSS media query and returns whether it currently matches.
 * The hook attaches a `change` event listener so the component re-renders
 * whenever the match state changes (e.g. on window resize or orientation change).
 *
 * @example
 * ```tsx
 * const isWide = useMediaQuery('(min-width: 1200px)');
 * ```
 *
 * @see Issue #479 - Mobile responsive pass across all views
 */
import { useState, useEffect } from 'react';

/**
 * Breakpoint constants used across the application.
 *
 * - Mobile: < 768px
 * - Tablet: 768px - 1024px
 * - Desktop: > 1024px
 */
export const BREAKPOINTS = {
  /** Maximum width for mobile devices (exclusive upper bound for mobile). */
  mobile: 768,
  /** Maximum width for tablet devices (exclusive upper bound for tablet). */
  tablet: 1024,
} as const;

/** Pre-built media query strings for common breakpoints. */
export const MEDIA_QUERIES = {
  mobile: `(max-width: ${BREAKPOINTS.mobile - 1}px)`,
  tablet: `(min-width: ${BREAKPOINTS.mobile}px) and (max-width: ${BREAKPOINTS.tablet}px)`,
  desktop: `(min-width: ${BREAKPOINTS.tablet + 1}px)`,
  /** Matches tablet and above (>= 768px). */
  tabletUp: `(min-width: ${BREAKPOINTS.mobile}px)`,
  /** Matches mobile and tablet (< 1025px). */
  tabletDown: `(max-width: ${BREAKPOINTS.tablet}px)`,
  /** Prefers reduced motion. */
  reducedMotion: '(prefers-reduced-motion: reduce)',
  /** User prefers dark color scheme. */
  darkMode: '(prefers-color-scheme: dark)',
  /** Device is in portrait orientation. */
  portrait: '(orientation: portrait)',
  /** Device is in landscape orientation. */
  landscape: '(orientation: landscape)',
} as const;

/**
 * React hook that subscribes to a CSS media query.
 *
 * @param query - A valid CSS media query string, e.g. `(max-width: 767px)`.
 * @returns `true` when the media query matches, `false` otherwise.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    // Sync immediately in case the SSR value diverged
    setMatches(mql.matches);

    const handler = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
