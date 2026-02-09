/**
 * Live Region component
 * Issue #411: WCAG 2.1 AA accessibility compliance
 */
import * as React from 'react';
import { cn } from '@/ui/lib/utils';

export interface LiveRegionProps {
  children: React.ReactNode;
  politeness?: 'polite' | 'assertive' | 'off';
  atomic?: boolean;
  role?: 'status' | 'alert' | 'log' | 'marquee' | 'timer';
  className?: string;
}

export function LiveRegion({ children, politeness = 'polite', atomic = true, role, className }: LiveRegionProps) {
  return (
    <div aria-live={politeness} aria-atomic={atomic} role={role} className={cn(className)}>
      {children}
    </div>
  );
}
