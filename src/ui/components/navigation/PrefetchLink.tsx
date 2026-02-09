/**
 * PrefetchLink - A NavLink wrapper that prefetches route chunks on
 * hover and focus.
 *
 * When the user hovers over or focuses on the link, the corresponding
 * route chunk is loaded in the background via dynamic import.  This
 * means that by the time the user clicks, the chunk is already in the
 * browser module cache and the page renders instantly.
 *
 * Issue #478: Code splitting and performance optimizations
 */
import * as React from 'react';
import { NavLink, type NavLinkProps } from 'react-router';
import { prefetchRoute } from '@/ui/lib/route-prefetch';

export interface PrefetchLinkProps extends NavLinkProps {
  /**
   * The route path to prefetch.  Defaults to the `to` prop when `to`
   * is a string.  Must be provided explicitly when `to` is an object.
   */
  prefetchPath?: string;
}

/**
 * A NavLink that triggers route chunk prefetching on mouse enter and
 * focus events.  All standard NavLink props (className function, end,
 * children render function, etc.) are forwarded.
 */
export const PrefetchLink = React.forwardRef<HTMLAnchorElement, PrefetchLinkProps>(function PrefetchLink(
  { prefetchPath, to, onMouseEnter, onFocus, ...rest },
  ref,
) {
  const path = prefetchPath ?? (typeof to === 'string' ? to : undefined);

  const handleMouseEnter = React.useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (path) prefetchRoute(path);
      onMouseEnter?.(e);
    },
    [path, onMouseEnter],
  );

  const handleFocus = React.useCallback(
    (e: React.FocusEvent<HTMLAnchorElement>) => {
      if (path) prefetchRoute(path);
      onFocus?.(e);
    },
    [path, onFocus],
  );

  return <NavLink ref={ref} to={to} onMouseEnter={handleMouseEnter} onFocus={handleFocus} data-prefetch-path={path} {...rest} />;
});
