/**
 * Mention badge/chip display
 * Issue #400: Implement @mention support with notifications
 */
import * as React from 'react';
import { cn } from '@/ui/lib/utils';
import type { Mention } from './mention-utils';

export interface MentionBadgeProps {
  mention: Mention;
  onClick?: (mention: Mention) => void;
  href?: string;
  className?: string;
}

export function MentionBadge({ mention, onClick, href, className }: MentionBadgeProps) {
  const baseClasses = cn(
    'inline-flex items-center px-1.5 py-0.5 rounded text-sm font-medium',
    'bg-primary/10 text-primary hover:bg-primary/20 transition-colors',
    className,
  );

  const content = `@${mention.name}`;

  if (href) {
    return (
      <a href={href} className={baseClasses}>
        {content}
      </a>
    );
  }

  if (onClick) {
    return (
      <button type="button" onClick={() => onClick(mention)} className={baseClasses}>
        {content}
      </button>
    );
  }

  return <span className={baseClasses}>{content}</span>;
}
