/**
 * Swimlanes Config component
 * Issue #409: Implement board view customization
 */
import * as React from 'react';
import { Label } from '@/ui/components/ui/label';
import { cn } from '@/ui/lib/utils';
import type { SwimlaneSetting, SwimlaneGroupBy } from './types';

export interface SwimlanesConfigProps {
  value: SwimlaneSetting | null;
  onChange: (value: SwimlaneSetting | null) => void;
}

const swimlaneOptions: { value: SwimlaneGroupBy | 'none'; label: string }[] = [
  { value: 'none', label: 'No Swimlanes' },
  { value: 'priority', label: 'Priority' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'label', label: 'Label' },
  { value: 'parent', label: 'Parent Item' },
];

export function SwimlanesConfig({ value, onChange }: SwimlanesConfigProps) {
  const currentValue = value?.groupBy ?? 'none';

  const handleChange = (newValue: string) => {
    if (newValue === 'none') {
      onChange(null);
    } else {
      onChange({ groupBy: newValue as SwimlaneGroupBy });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium mb-3">Swimlanes</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Group cards into horizontal lanes across all columns.
        </p>
      </div>

      <div className="space-y-2">
        {swimlaneOptions.map((option) => {
          const isSelected = currentValue === option.value;
          const inputId = `swimlane-${option.value}`;

          return (
            <div key={option.value} className="flex items-center space-x-2">
              <input
                type="radio"
                id={inputId}
                name="swimlane"
                value={option.value}
                checked={isSelected}
                onChange={() => handleChange(option.value)}
                className={cn(
                  'h-4 w-4 border-gray-300 text-primary focus:ring-primary'
                )}
                aria-label={option.label}
              />
              <Label htmlFor={inputId}>{option.label}</Label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
