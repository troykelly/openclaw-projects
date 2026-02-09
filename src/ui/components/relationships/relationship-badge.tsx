/**
 * Badge for displaying relationship type
 * Issue #395: Implement contact relationship types
 */
import * as React from 'react';
import { cn } from '@/ui/lib/utils';
import type { RelationshipType, RelationshipStrength } from './types';
import { getRelationshipLabel, getRelationshipCategory, CATEGORY_COLORS } from './relationship-utils';

export interface RelationshipBadgeProps {
  type: RelationshipType;
  strength?: RelationshipStrength;
  showStrength?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export function RelationshipBadge({ type, strength, showStrength = false, size = 'md', className }: RelationshipBadgeProps) {
  const category = getRelationshipCategory(type);
  const label = getRelationshipLabel(type);

  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-sm px-2 py-1',
  };

  return (
    <span
      data-testid="relationship-badge"
      data-category={category}
      className={cn('inline-flex items-center gap-1 rounded-full font-medium', CATEGORY_COLORS[category], sizeClasses[size], className)}
    >
      <span>{label}</span>
      {showStrength && strength && (
        <span
          data-testid="strength-indicator"
          className={cn(
            'w-1.5 h-1.5 rounded-full',
            strength === 'strong' && 'bg-current opacity-100',
            strength === 'medium' && 'bg-current opacity-60',
            strength === 'weak' && 'bg-current opacity-30',
          )}
        />
      )}
    </span>
  );
}
