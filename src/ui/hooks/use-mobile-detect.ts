/**
 * Mobile detection convenience hook.
 *
 * Returns a set of boolean flags indicating the current viewport
 * breakpoint range. Built on top of `useMediaQuery`.
 *
 * Breakpoints:
 * - Mobile: < 768px
 * - Tablet: 768px - 1024px
 * - Desktop: > 1024px
 *
 * @example
 * ```tsx
 * const { isMobile, isTablet, isDesktop } = useMobileDetect();
 * ```
 *
 * @see Issue #479 - Mobile responsive pass across all views
 */
import { useMediaQuery, MEDIA_QUERIES } from './use-media-query';

/** Return type of `useMobileDetect`. */
export interface MobileDetectResult {
  /** True when viewport width is less than 768px. */
  isMobile: boolean;
  /** True when viewport width is between 768px and 1024px. */
  isTablet: boolean;
  /** True when viewport width is greater than 1024px. */
  isDesktop: boolean;
  /** True when viewport width is less than 1025px (mobile or tablet). */
  isMobileOrTablet: boolean;
}

/**
 * Convenience hook that returns breakpoint boolean flags.
 *
 * @returns Object with `isMobile`, `isTablet`, `isDesktop`, and `isMobileOrTablet` flags.
 */
export function useMobileDetect(): MobileDetectResult {
  const isMobile = useMediaQuery(MEDIA_QUERIES.mobile);
  const isTablet = useMediaQuery(MEDIA_QUERIES.tablet);
  const isDesktop = useMediaQuery(MEDIA_QUERIES.desktop);

  return {
    isMobile,
    isTablet,
    isDesktop,
    isMobileOrTablet: isMobile || isTablet,
  };
}
