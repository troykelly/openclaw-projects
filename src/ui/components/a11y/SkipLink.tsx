/**
 * SkipLink component for keyboard-only users.
 *
 * Renders a visually hidden anchor that becomes visible on focus,
 * allowing keyboard users to bypass repetitive navigation and jump
 * directly to the main content area.
 *
 * @see Issue #480 - WCAG 2.1 AA compliance
 */
import * as React from 'react';
import { cn } from '@/ui/lib/utils';

export interface SkipLinkProps {
  /** The target element ID to jump to (without the # prefix). */
  targetId: string;
  /** Label shown to screen readers and visible on focus. */
  label?: string;
  /** Additional CSS class names. */
  className?: string;
}

/**
 * Skip link that is visually hidden until focused.
 *
 * On click, the browser scrolls to the element whose `id` matches
 * `targetId` and moves focus there, letting keyboard users skip
 * past the sidebar and header.
 */
export function SkipLink({ targetId, label = 'Skip to main content', className }: SkipLinkProps): React.JSX.Element {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const target = document.getElementById(targetId);
    if (target) {
      target.focus();
      target.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <a
      href={`#${targetId}`}
      onClick={handleClick}
      className={cn(
        'sr-only focus:not-sr-only',
        'fixed top-4 left-4 z-[100]',
        'rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground',
        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        'transition-opacity',
        className,
      )}
    >
      {label}
    </a>
  );
}
