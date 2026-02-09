/**
 * Accessible Icon component
 * Issue #411: WCAG 2.1 AA accessibility compliance
 */
import * as React from 'react';

export interface AccessibleIconProps {
  children: React.ReactNode;
  label?: string;
  decorative?: boolean;
}

export function AccessibleIcon({ children, label, decorative = false }: AccessibleIconProps) {
  const child = React.Children.only(children);

  // Clone the icon element to add aria-hidden
  const icon = React.isValidElement(child)
    ? React.cloneElement(child, {
        'aria-hidden': 'true',
        focusable: 'false',
      } as React.Attributes)
    : child;

  if (decorative) {
    return (
      <span role="presentation" aria-hidden="true">
        {icon}
      </span>
    );
  }

  return (
    <span aria-label={label} role="img">
      {icon}
    </span>
  );
}
