/**
 * Column Manager component
 * Issue #409: Implement board view customization
 */
import * as React from 'react';
import { GripVertical, Trash2, Plus } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import type { BoardColumn } from './types';

export interface ColumnManagerProps {
  columns: BoardColumn[];
  onChange: (columns: BoardColumn[]) => void;
}

function generateId(): string {
  return `col-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function ColumnManager({ columns, onChange }: ColumnManagerProps) {
  const handleAddColumn = () => {
    const newColumn: BoardColumn = {
      id: generateId(),
      name: 'New Column',
      order: columns.length,
    };
    onChange([...columns, newColumn]);
  };

  const handleRenameColumn = (id: string, name: string) => {
    onChange(columns.map((col) => (col.id === id ? { ...col, name } : col)));
  };

  const handleDeleteColumn = (id: string) => {
    const filtered = columns.filter((col) => col.id !== id);
    // Reorder remaining columns
    onChange(filtered.map((col, index) => ({ ...col, order: index })));
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {columns.map((column) => (
          <div
            key={column.id}
            data-testid={`column-item-${column.id}`}
            className="flex items-center gap-2 p-2 border rounded-lg bg-background"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground cursor-move" />
            <Input
              value={column.name}
              onChange={(e) => handleRenameColumn(column.id, e.target.value)}
              className="flex-1"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleDeleteColumn(column.id)}
              aria-label="Delete column"
            >
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        ))}
      </div>

      <Button
        variant="outline"
        className="w-full"
        onClick={handleAddColumn}
        aria-label="Add column"
      >
        <Plus className="h-4 w-4 mr-2" />
        Add Column
      </Button>
    </div>
  );
}
