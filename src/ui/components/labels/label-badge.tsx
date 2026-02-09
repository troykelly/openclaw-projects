/**
 * Label badge component for displaying a single label
 */
import * as React from 'react';
import { XIcon } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { getContrastColor } from './color-palette';
import type { LabelBadgeProps } from './types';

export function LabelBadge({ label, size = 'md', onRemove, className }: LabelBadgeProps) {
  const textColor = getContrastColor(label.color);

  return (
    <span
      data-label-badge={label.id}
      className={cn('inline-flex items-center gap-1 rounded-full font-medium', size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-0.5 text-sm', className)}
      style={{
        backgroundColor: label.color,
        color: textColor,
      }}
    >
      {label.name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(label);
          }}
          className={cn('rounded-full hover:bg-black/10 focus:outline-none focus:ring-1', size === 'sm' ? 'p-0.5' : 'p-0.5')}
          style={{ color: textColor }}
          aria-label={`Remove ${label.name} label`}
        >
          <XIcon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        </button>
      )}
    </span>
  );
}
