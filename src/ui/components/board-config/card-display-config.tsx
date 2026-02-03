/**
 * Card Display Config component
 * Issue #409: Implement board view customization
 */
import * as React from 'react';
import { Checkbox } from '@/ui/components/ui/checkbox';
import { Label } from '@/ui/components/ui/label';
import { cn } from '@/ui/lib/utils';
import type { CardDisplayMode, CardField } from './types';

export interface CardDisplayConfigProps {
  mode: CardDisplayMode;
  onChange: (mode: CardDisplayMode) => void;
  visibleFields: CardField[];
  onVisibleFieldsChange: (fields: CardField[]) => void;
}

const displayModes: { value: CardDisplayMode; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'detailed', label: 'Detailed' },
];

const availableFields: { value: CardField; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'dueDate', label: 'Due Date' },
  { value: 'labels', label: 'Labels' },
  { value: 'estimate', label: 'Estimate' },
  { value: 'progress', label: 'Progress' },
];

export function CardDisplayConfig({
  mode,
  onChange,
  visibleFields,
  onVisibleFieldsChange,
}: CardDisplayConfigProps) {
  const handleFieldToggle = (field: CardField) => {
    if (visibleFields.includes(field)) {
      onVisibleFieldsChange(visibleFields.filter((f) => f !== field));
    } else {
      onVisibleFieldsChange([...visibleFields, field]);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-3">Card Display Mode</h3>
        <div className="space-y-2">
          {displayModes.map((option) => {
            const inputId = `mode-${option.value}`;
            return (
              <div key={option.value} className="flex items-center space-x-2">
                <input
                  type="radio"
                  id={inputId}
                  name="displayMode"
                  value={option.value}
                  checked={mode === option.value}
                  onChange={() => onChange(option.value)}
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

      <div>
        <h3 className="text-sm font-medium mb-3">Visible Fields</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Select which fields to display on cards.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {availableFields.map((field) => (
            <div key={field.value} className="flex items-center space-x-2">
              <Checkbox
                id={`field-${field.value}`}
                checked={visibleFields.includes(field.value)}
                onCheckedChange={() => handleFieldToggle(field.value)}
                aria-label={field.label}
              />
              <Label htmlFor={`field-${field.value}`}>{field.label}</Label>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
