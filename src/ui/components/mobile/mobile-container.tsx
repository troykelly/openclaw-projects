/**
 * Mobile Container component
 * Issue #412: Mobile responsive improvements
 */
import * as React from 'react';
import { cn } from '@/ui/lib/utils';

export interface MobileContainerProps {
  children: React.ReactNode;
  safeArea?: boolean;
  fullHeight?: boolean;
  className?: string;
}

export function MobileContainer({ children, safeArea = false, fullHeight = false, className }: MobileContainerProps) {
  return (
    <div data-testid="mobile-container" className={cn('px-4 py-2 w-full', fullHeight && 'min-h-screen', safeArea && 'pb-safe pt-safe', className)}>
      {children}
    </div>
  );
}
