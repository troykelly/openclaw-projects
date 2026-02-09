/**
 * Column mapping interface for CSV import
 * Issue #398: Implement contact import/export (CSV, vCard)
 */
import * as React from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { cn } from '@/ui/lib/utils';
import type { ColumnMapping, ContactField } from './types';
import { CONTACT_FIELDS } from './import-export-utils';

export interface ColumnMapperProps {
  sourceColumns: string[];
  mappings: ColumnMapping[];
  onMappingChange: (mappings: ColumnMapping[]) => void;
  className?: string;
}

const TARGET_OPTIONS: { value: ContactField | 'skip'; label: string }[] = [
  { value: 'skip', label: 'Skip / Ignore' },
  ...CONTACT_FIELDS.map((f) => ({ value: f.id, label: f.label })),
];

export function ColumnMapper({ sourceColumns, mappings, onMappingChange, className }: ColumnMapperProps) {
  const getMappingForColumn = (column: string): ColumnMapping | undefined => {
    return mappings.find((m) => m.sourceColumn === column);
  };

  const handleMappingChange = (column: string, targetField: ContactField | 'skip') => {
    const newMappings = mappings.filter((m) => m.sourceColumn !== column);
    newMappings.push({
      sourceColumn: column,
      targetField: targetField === 'skip' ? null : targetField,
      autoMapped: false,
    });
    onMappingChange(newMappings);
  };

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-4 text-sm font-medium text-muted-foreground px-2">
        <div className="flex-1">Source Column</div>
        <div className="w-8" />
        <div className="flex-1">Map To</div>
      </div>

      {sourceColumns.map((column) => {
        const mapping = getMappingForColumn(column);
        const isAutoMapped = mapping?.autoMapped;

        return (
          <div
            key={column}
            data-auto-mapped={isAutoMapped}
            className={cn('flex items-center gap-4 p-2 rounded-md', isAutoMapped && 'bg-green-50 dark:bg-green-900/20')}
          >
            <div className="flex-1 flex items-center gap-2">
              <span className="font-medium text-sm truncate">{column}</span>
              {isAutoMapped && <Sparkles className="h-3.5 w-3.5 text-green-600" />}
            </div>

            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />

            <div className="flex-1">
              <Select value={mapping?.targetField || 'skip'} onValueChange={(value) => handleMappingChange(column, value as ContactField | 'skip')}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select field" />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      })}
    </div>
  );
}
