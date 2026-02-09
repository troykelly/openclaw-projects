/**
 * List Row component
 * Issue #407: Implement list view with configurable columns
 */
import * as React from 'react';
import { Checkbox } from '@/ui/components/ui/checkbox';
import { cn } from '@/ui/lib/utils';
import type { ColumnDefinition, ListItem } from './types';

export interface ListRowProps {
  item: ListItem;
  columns: ColumnDefinition[];
  onClick?: (item: ListItem) => void;
  selected?: boolean;
  selectable?: boolean;
  onSelect?: (itemId: string) => void;
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '-';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toLocaleDateString();
  }
  return String(value);
}

export function ListRow({ item, columns, onClick, selected = false, selectable = false, onSelect }: ListRowProps) {
  const handleRowClick = (e: React.MouseEvent) => {
    // Don't trigger row click if clicking on checkbox
    if ((e.target as HTMLElement).closest('[role="checkbox"]')) {
      return;
    }
    onClick?.(item);
  };

  const handleCheckboxChange = () => {
    onSelect?.(item.id);
  };

  return (
    <tr
      data-testid={`list-row-${item.id}`}
      data-selected={selected}
      className={cn('border-b transition-colors hover:bg-muted/50 cursor-pointer', selected && 'bg-accent')}
      onClick={handleRowClick}
    >
      {selectable && (
        <td className="w-10 px-2 py-3">
          <Checkbox checked={selected} onCheckedChange={handleCheckboxChange} aria-label={`Select ${item.title}`} />
        </td>
      )}
      {columns.map((column) => {
        const value = item[column.id];

        return (
          <td
            key={column.id}
            className={cn('px-4 py-3 text-sm', column.align === 'center' && 'text-center', column.align === 'right' && 'text-right')}
            style={{ width: column.width }}
          >
            {formatCellValue(value)}
          </td>
        );
      })}
    </tr>
  );
}
