/**
 * List component for displaying and editing custom field values
 */
import * as React from 'react';
import { cn } from '@/ui/lib/utils';
import { CustomFieldInput } from './custom-field-input';
import type { CustomFieldListProps, CustomFieldDefinition } from './types';

export function CustomFieldList({ fields, values, onChange, readOnly = false, className }: CustomFieldListProps) {
  // Create a map for quick value lookup
  const valueMap = React.useMemo(() => {
    const map = new Map<string, unknown>();
    for (const v of values) {
      map.set(v.fieldId, v.value);
    }
    return map;
  }, [values]);

  // Sort fields by order
  const sortedFields = React.useMemo(() => [...fields].sort((a, b) => a.order - b.order), [fields]);

  const formatValue = (field: CustomFieldDefinition, value: unknown): string => {
    if (value === null || value === undefined || value === '') {
      return '—';
    }

    switch (field.type) {
      case 'checkbox':
        return value ? 'Yes' : 'No';
      case 'multiselect':
        return Array.isArray(value) ? value.join(', ') : String(value);
      case 'date':
        try {
          return new Date(value as string).toLocaleDateString();
        } catch {
          return String(value);
        }
      default:
        return String(value);
    }
  };

  if (fields.length === 0) {
    return null;
  }

  return (
    <div className={cn('space-y-4', className)}>
      {sortedFields.map((field) => {
        const value = valueMap.get(field.id);

        if (readOnly) {
          return (
            <div key={field.id} className="space-y-1">
              <dt className="text-sm font-medium text-muted-foreground">{field.name}</dt>
              <dd className="text-sm">{formatValue(field, value)}</dd>
            </div>
          );
        }

        return <CustomFieldInput key={field.id} field={field} value={value} onChange={(newValue) => onChange(field.id, newValue)} />;
      })}
    </div>
  );
}
