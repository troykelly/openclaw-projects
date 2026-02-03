/**
 * Action bar for bulk contact operations
 * Issue #397: Implement bulk contact operations
 */
import * as React from 'react';
import { Trash2, UserPlus, UserMinus, Edit, Download, X } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { cn } from '@/ui/lib/utils';

export interface ContactBulkActionBarProps {
  selectedCount: number;
  onDelete: () => void;
  onAddToGroup: () => void;
  onRemoveFromGroup: () => void;
  onUpdateField: () => void;
  onExport: () => void;
  onDeselectAll: () => void;
  className?: string;
}

export function ContactBulkActionBar({
  selectedCount,
  onDelete,
  onAddToGroup,
  onRemoveFromGroup,
  onUpdateField,
  onExport,
  onDeselectAll,
  className,
}: ContactBulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div
      className={cn(
        'fixed bottom-4 left-1/2 -translate-x-1/2 z-50',
        'flex items-center gap-2 px-4 py-2 rounded-lg',
        'bg-primary text-primary-foreground shadow-lg',
        className
      )}
    >
      {/* Selection count */}
      <span className="text-sm font-medium mr-2">
        {selectedCount} selected
      </span>

      <div className="h-4 w-px bg-primary-foreground/30" />

      {/* Actions */}
      <Button
        variant="ghost"
        size="sm"
        className="text-primary-foreground hover:text-primary-foreground hover:bg-primary-foreground/10"
        onClick={onAddToGroup}
      >
        <UserPlus className="h-4 w-4 mr-1" />
        Add to Group
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="text-primary-foreground hover:text-primary-foreground hover:bg-primary-foreground/10"
        onClick={onRemoveFromGroup}
      >
        <UserMinus className="h-4 w-4 mr-1" />
        Remove from Group
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="text-primary-foreground hover:text-primary-foreground hover:bg-primary-foreground/10"
        onClick={onUpdateField}
      >
        <Edit className="h-4 w-4 mr-1" />
        Update
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="text-primary-foreground hover:text-primary-foreground hover:bg-primary-foreground/10"
        onClick={onExport}
      >
        <Download className="h-4 w-4 mr-1" />
        Export
      </Button>

      <div className="h-4 w-px bg-primary-foreground/30" />

      <Button
        variant="ghost"
        size="sm"
        className="text-destructive-foreground hover:text-destructive-foreground hover:bg-destructive/80 bg-destructive/60"
        onClick={onDelete}
      >
        <Trash2 className="h-4 w-4 mr-1" />
        Delete
      </Button>

      <div className="h-4 w-px bg-primary-foreground/30" />

      {/* Deselect */}
      <Button
        variant="ghost"
        size="sm"
        className="text-primary-foreground hover:text-primary-foreground hover:bg-primary-foreground/10"
        onClick={onDeselectAll}
      >
        <X className="h-4 w-4 mr-1" />
        Deselect All
      </Button>
    </div>
  );
}
