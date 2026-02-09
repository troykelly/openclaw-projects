/**
 * WIP Limits Config component
 * Issue #409: Implement board view customization
 */
import * as React from 'react';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import type { BoardColumn, WipLimit } from './types';

export interface WipLimitsConfigProps {
  columns: BoardColumn[];
  limits: Record<string, WipLimit>;
  onChange: (limits: Record<string, WipLimit>) => void;
}

export function WipLimitsConfig({ columns, limits, onChange }: WipLimitsConfigProps) {
  const handleLimitChange = (columnId: string, value: string) => {
    const numValue = parseInt(value, 10);
    const newLimits = { ...limits };

    if (value === '' || isNaN(numValue)) {
      delete newLimits[columnId];
    } else {
      newLimits[columnId] = numValue;
    }

    onChange(newLimits);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium mb-3">Work In Progress Limits</h3>
        <p className="text-sm text-muted-foreground mb-4">Set maximum items per column. Exceeding the limit will show a warning.</p>
      </div>

      <div className="space-y-3">
        {columns.map((column) => (
          <div key={column.id} className="flex items-center gap-3">
            <Label htmlFor={`wip-${column.id}`} className="w-32 shrink-0">
              {column.name}
            </Label>
            <Input
              id={`wip-${column.id}`}
              type="number"
              min={0}
              placeholder="No limit"
              value={limits[column.id] ?? ''}
              onChange={(e) => handleLimitChange(column.id, e.target.value)}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">items max</span>
          </div>
        ))}
      </div>
    </div>
  );
}
