/**
 * List View component
 * Issue #407: Implement list view with configurable columns
 */
import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { ListHeader } from './list-header';
import { ListRow } from './list-row';
import type { ColumnDefinition, ListItem, SortDirection } from './types';

export interface ListViewProps {
  items: ListItem[];
  columns: ColumnDefinition[];
  onRowClick?: (item: ListItem) => void;
  selectable?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (selectedIds: string[]) => void;
  sortColumn?: string | null;
  sortDirection?: SortDirection;
  onSort?: (columnId: string, direction: SortDirection) => void;
  loading?: boolean;
  className?: string;
}

export function ListView({
  items,
  columns,
  onRowClick,
  selectable = false,
  selectedIds = [],
  onSelectionChange,
  sortColumn,
  sortDirection = 'asc',
  onSort,
  loading = false,
  className,
}: ListViewProps) {
  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < items.length;

  const handleSort = (columnId: string) => {
    if (!onSort) return;

    // If clicking the same column, toggle direction
    if (columnId === sortColumn) {
      onSort(columnId, sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New column, default to ascending
      onSort(columnId, 'asc');
    }
  };

  const handleSelectAll = () => {
    if (!onSelectionChange) return;

    if (allSelected) {
      onSelectionChange([]);
    } else {
      onSelectionChange(items.map((item) => item.id));
    }
  };

  const handleSelectItem = (item_id: string) => {
    if (!onSelectionChange) return;

    if (selectedIds.includes(item_id)) {
      onSelectionChange(selectedIds.filter((id) => id !== item_id));
    } else {
      onSelectionChange([...selectedIds, item_id]);
    }
  };

  if (loading) {
    return (
      <div data-testid="list-loading" className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (items.length === 0) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground">No items to display</div>;
  }

  return (
    <div className={cn('w-full overflow-auto', className)}>
      <table className="w-full border-collapse">
        <ListHeader
          columns={columns}
          onSort={handleSort}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          selectable={selectable}
          allSelected={allSelected}
          indeterminate={someSelected}
          onSelectAll={handleSelectAll}
        />
        <tbody>
          {items.map((item) => (
            <ListRow
              key={item.id}
              item={item}
              columns={columns}
              onClick={onRowClick}
              selected={selectedIds.includes(item.id)}
              selectable={selectable}
              onSelect={handleSelectItem}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
