/**
 * Error Message component
 * Issue #411: WCAG 2.1 AA accessibility compliance
 */
import * as React from 'react';
import { cn } from '@/ui/lib/utils';

export interface ErrorMessageProps {
  id: string;
  children: React.ReactNode;
  className?: string;
}

export function ErrorMessage({ id, children, className }: ErrorMessageProps) {
  return (
    <div id={id} role="alert" aria-live="assertive" className={cn('text-sm text-destructive mt-1', className)}>
      {children}
    </div>
  );
}
