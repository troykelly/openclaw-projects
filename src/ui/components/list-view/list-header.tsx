/**
 * List Header component
 * Issue #407: Implement list view with configurable columns
 */
import * as React from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { Checkbox } from '@/ui/components/ui/checkbox';
import { cn } from '@/ui/lib/utils';
import type { ColumnDefinition, SortDirection } from './types';

export interface ListHeaderProps {
  columns: ColumnDefinition[];
  onSort?: (columnId: string) => void;
  sortColumn?: string | null;
  sortDirection?: SortDirection;
  selectable?: boolean;
  allSelected?: boolean;
  indeterminate?: boolean;
  onSelectAll?: () => void;
}

export function ListHeader({
  columns,
  onSort,
  sortColumn,
  sortDirection,
  selectable = false,
  allSelected = false,
  indeterminate = false,
  onSelectAll,
}: ListHeaderProps) {
  return (
    <thead className="bg-muted/50">
      <tr>
        {selectable && (
          <th className="w-10 px-2 py-3">
            <Checkbox checked={indeterminate ? 'indeterminate' : allSelected} onCheckedChange={onSelectAll} aria-label="Select all" />
          </th>
        )}
        {columns.map((column) => {
          const isSorted = sortColumn === column.id;
          const canSort = column.sortable !== false;

          return (
            <th
              key={column.id}
              className={cn(
                'px-4 py-3 text-left text-sm font-medium text-muted-foreground',
                canSort && 'cursor-pointer hover:text-foreground',
                column.align === 'center' && 'text-center',
                column.align === 'right' && 'text-right',
              )}
              style={{ width: column.width }}
              onClick={() => canSort && onSort?.(column.id)}
              data-sorted={isSorted}
            >
              <div className="flex items-center gap-1">
                <span>{column.label}</span>
                {isSorted && <span className="ml-1">{sortDirection === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}</span>}
              </div>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}
