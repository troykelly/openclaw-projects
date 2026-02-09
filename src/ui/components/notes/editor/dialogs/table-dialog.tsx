/**
 * Table insertion dialog component.
 * Part of Epic #338, Issue #757
 *
 * Addresses issue #683 (replace prompt() for table insertion).
 */

import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Button } from '@/ui/components/ui/button';
import type { TableDialogProps } from '../types';

export function TableDialog({ open, onOpenChange, onSubmit }: TableDialogProps): React.JSX.Element {
  const [rows, setRows] = useState('3');
  const [columns, setColumns] = useState('3');
  const [error, setError] = useState<string | null>(null);
  const rowsInputRef = useRef<HTMLInputElement>(null);

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setRows('3');
      setColumns('3');
      setError(null);
      setTimeout(() => rowsInputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const rowCount = parseInt(rows, 10);
    const colCount = parseInt(columns, 10);

    if (isNaN(rowCount) || rowCount < 1 || rowCount > 50) {
      setError('Rows must be a number between 1 and 50');
      return;
    }

    if (isNaN(colCount) || colCount < 1 || colCount > 20) {
      setError('Columns must be a number between 1 and 20');
      return;
    }

    onSubmit(rowCount, colCount);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Insert Table</DialogTitle>
          <DialogDescription>Choose the number of rows and columns for your table.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="table-rows">Rows</Label>
                <Input
                  id="table-rows"
                  ref={rowsInputRef}
                  type="number"
                  min={1}
                  max={50}
                  value={rows}
                  onChange={(e) => {
                    setRows(e.target.value);
                    setError(null);
                  }}
                  placeholder="3"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="table-columns">Columns</Label>
                <Input
                  id="table-columns"
                  type="number"
                  min={1}
                  max={20}
                  value={columns}
                  onChange={(e) => {
                    setColumns(e.target.value);
                    setError(null);
                  }}
                  placeholder="3"
                />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {/* Visual preview */}
            <div className="mt-2">
              <p className="text-sm text-muted-foreground mb-2">Preview:</p>
              <div
                className="grid gap-0.5 max-w-[200px]"
                style={{
                  gridTemplateColumns: `repeat(${Math.min(parseInt(columns) || 3, 10)}, 1fr)`,
                }}
              >
                {Array.from({ length: Math.min((parseInt(rows) || 3) * (parseInt(columns) || 3), 100) }).map((_, i) => (
                  <div key={i} className={`h-4 border border-border ${i < (parseInt(columns) || 3) ? 'bg-muted' : ''}`} />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Insert Table</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
