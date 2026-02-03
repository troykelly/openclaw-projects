/**
 * Touch Target component
 * Issue #412: Mobile responsive improvements
 */
import * as React from 'react';
import { cn } from '@/ui/lib/utils';

export interface TouchTargetProps {
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'min-h-9 min-w-9', // 36px
  md: 'min-h-11 min-w-11', // 44px - recommended minimum
  lg: 'min-h-14 min-w-14', // 56px
};

export function TouchTarget({
  children,
  size = 'md',
  className,
}: TouchTargetProps) {
  return (
    <div
      data-testid="touch-target"
      className={cn(
        'flex items-center justify-center',
        sizeClasses[size],
        className
      )}
    >
      {children}
    </div>
  );
}
