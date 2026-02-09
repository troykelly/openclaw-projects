/**
 * Shortcut Hint component
 * Issue #410: Implement keyboard navigation throughout
 */
import * as React from 'react';
import { cn } from '@/ui/lib/utils';
import { MODIFIER_SYMBOLS } from './types';

export interface ShortcutHintProps {
  keys: string[];
  description: string;
  compact?: boolean;
  className?: string;
}

function formatKey(key: string): string {
  return MODIFIER_SYMBOLS[key] || key;
}

export function ShortcutHint({ keys, description, compact = false, className }: ShortcutHintProps) {
  return (
    <div data-testid="shortcut-hint" data-compact={compact} className={cn('flex items-center gap-2', compact ? 'text-xs' : 'text-sm', className)}>
      <div className="flex items-center gap-1">
        {keys.map((key, index) => (
          <React.Fragment key={index}>
            <kbd
              className={cn(
                'inline-flex items-center justify-center rounded border border-border bg-muted font-mono',
                compact ? 'min-w-5 h-5 px-1 text-[10px]' : 'min-w-6 h-6 px-1.5 text-xs',
              )}
            >
              {formatKey(key)}
            </kbd>
            {index < keys.length - 1 && <span className="text-muted-foreground">+</span>}
          </React.Fragment>
        ))}
      </div>
      <span className="text-muted-foreground">{description}</span>
    </div>
  );
}
