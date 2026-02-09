/**
 * Visually Hidden component
 * Issue #411: WCAG 2.1 AA accessibility compliance
 */
import * as React from 'react';

export interface VisuallyHiddenProps {
  children: React.ReactNode;
  as?: keyof JSX.IntrinsicElements;
}

export function VisuallyHidden({ children, as: Component = 'span' }: VisuallyHiddenProps) {
  return <Component className="sr-only">{children}</Component>;
}
