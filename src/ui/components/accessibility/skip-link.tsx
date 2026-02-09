/**
 * Skip Link component
 * Issue #411: WCAG 2.1 AA accessibility compliance
 */
import * as React from 'react';
import { cn } from '@/ui/lib/utils';

export interface SkipLinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
}

export function SkipLink({ href, children, className }: SkipLinkProps) {
  return (
    <a
      href={href}
      className={cn(
        'sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50',
        'focus:bg-background focus:text-foreground focus:px-4 focus:py-2',
        'focus:rounded-md focus:ring-2 focus:ring-ring focus:outline-none',
        className,
      )}
    >
      {children}
    </a>
  );
}
