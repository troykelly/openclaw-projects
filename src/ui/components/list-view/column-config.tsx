/**
 * Column Config component
 * Issue #407: Implement list view with configurable columns
 */
import * as React from 'react';
import { Columns3 } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/components/ui/popover';
import { Checkbox } from '@/ui/components/ui/checkbox';
import { Label } from '@/ui/components/ui/label';
import type { ColumnDefinition } from './types';

export interface ColumnConfigProps {
  columns: ColumnDefinition[];
  visibleColumns: string[];
  onColumnsChange: (visibleColumnIds: string[]) => void;
  defaultColumns?: string[];
}

export function ColumnConfig({ columns, visibleColumns, onColumnsChange, defaultColumns }: ColumnConfigProps) {
  const [open, setOpen] = React.useState(false);

  const handleToggleColumn = (columnId: string) => {
    const isCurrentlyVisible = visibleColumns.includes(columnId);
    if (isCurrentlyVisible) {
      onColumnsChange(visibleColumns.filter((id) => id !== columnId));
    } else {
      onColumnsChange([...visibleColumns, columnId]);
    }
  };

  const handleReset = () => {
    if (defaultColumns) {
      onColumnsChange(defaultColumns);
    } else {
      // Reset to all columns
      onColumnsChange(columns.map((c) => c.id));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Columns">
          <Columns3 className="h-4 w-4 mr-2" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56">
        <div className="space-y-3">
          <div className="font-medium text-sm">Show Columns</div>
          <div className="space-y-2">
            {columns.map((column) => {
              const isVisible = visibleColumns.includes(column.id);
              const isRequired = column.required === true;

              return (
                <div key={column.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`column-${column.id}`}
                    checked={isVisible}
                    onCheckedChange={() => handleToggleColumn(column.id)}
                    disabled={isRequired}
                    aria-label={column.label}
                  />
                  <Label htmlFor={`column-${column.id}`} className="text-sm cursor-pointer">
                    {column.label}
                  </Label>
                </div>
              );
            })}
          </div>
          <div className="pt-2 border-t">
            <Button variant="ghost" size="sm" className="w-full" onClick={handleReset}>
              Reset to default
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
