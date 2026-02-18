/**
 * Badge for contact group display
 * Issue #394: Implement contact groups and organization hierarchy
 */
import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import type { ContactGroup } from './types';

export interface ContactGroupBadgeProps {
  group: ContactGroup;
  onRemove?: (group_id: string) => void;
  removable?: boolean;
  showCount?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Calculate contrast color for text based on background
 */
function getContrastColor(hexColor: string): string {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

export function ContactGroupBadge({ group, onRemove, removable = false, showCount = false, size = 'md', className }: ContactGroupBadgeProps) {
  const textColor = getContrastColor(group.color);

  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-sm px-2 py-1',
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove?.(group.id);
  };

  return (
    <span
      data-testid="contact-group-badge"
      className={cn('inline-flex items-center gap-1 rounded-full font-medium', sizeClasses[size], className)}
      style={{
        backgroundColor: group.color,
        color: textColor,
      }}
    >
      <span>{group.name}</span>

      {showCount && <span className="opacity-75">{group.memberCount}</span>}

      {removable && onRemove && (
        <button
          type="button"
          onClick={handleRemove}
          className="ml-0.5 -mr-0.5 p-0.5 rounded-full hover:bg-black/10 transition-colors"
          aria-label={`Remove from ${group.name}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}
