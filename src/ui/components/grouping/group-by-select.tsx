/**
 * Dropdown for selecting group-by field
 */
import * as React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { cn } from '@/ui/lib/utils';
import type { GroupBySelectProps, GroupField } from './types';
import { GROUP_FIELD_LABELS } from './types';

const DEFAULT_FIELDS: GroupField[] = ['none', 'status', 'priority', 'kind', 'assignee', 'parent', 'dueDate'];

export function GroupBySelect({ value, onChange, availableFields = DEFAULT_FIELDS, className }: GroupBySelectProps) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as GroupField)}>
      <SelectTrigger className={cn('w-[140px]', className)}>
        <span className="text-muted-foreground text-xs mr-1">Group:</span>
        <SelectValue placeholder="None" />
      </SelectTrigger>
      <SelectContent>
        {availableFields.map((field) => (
          <SelectItem key={field} value={field}>
            {GROUP_FIELD_LABELS[field]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
