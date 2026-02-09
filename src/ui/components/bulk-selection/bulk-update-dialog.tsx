/**
 * Dialog for bulk updating contact fields
 * Issue #397: Implement bulk contact operations
 */
import * as React from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Label } from '@/ui/components/ui/label';
import { Input } from '@/ui/components/ui/input';
import { cn } from '@/ui/lib/utils';
import type { BulkUpdateField, BulkUpdateFieldConfig } from './types';

const UPDATEABLE_FIELDS: BulkUpdateFieldConfig[] = [
  { id: 'organization', label: 'Organization', placeholder: 'Enter organization name' },
  { id: 'role', label: 'Role', placeholder: 'Enter role/title' },
  { id: 'status', label: 'Status', placeholder: 'Enter status' },
];

export interface BulkUpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onConfirm: (field: BulkUpdateField, value: string) => void;
  loading?: boolean;
}

export function BulkUpdateDialog({ open, onOpenChange, selectedCount, onConfirm, loading = false }: BulkUpdateDialogProps) {
  const [selectedField, setSelectedField] = React.useState<BulkUpdateField | null>(null);
  const [value, setValue] = React.useState('');

  const selectedFieldConfig = UPDATEABLE_FIELDS.find((f) => f.id === selectedField);

  const handleConfirm = () => {
    if (selectedField && value.trim()) {
      onConfirm(selectedField, value.trim());
    }
  };

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setSelectedField(null);
      setValue('');
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-full bg-primary/10">
              <Pencil className="h-5 w-5 text-primary" />
            </div>
            <DialogTitle>Update {selectedCount} contacts</DialogTitle>
          </div>
          <DialogDescription>Select a field to update for all selected contacts.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Field selector */}
          <div className="space-y-2">
            <Label>Select Field</Label>
            <div className="flex flex-wrap gap-2">
              {UPDATEABLE_FIELDS.map((field) => (
                <button
                  key={field.id}
                  type="button"
                  data-selected={selectedField === field.id}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-sm border transition-colors',
                    selectedField === field.id ? 'border-primary bg-primary/10 text-primary' : 'border-muted hover:bg-muted',
                  )}
                  onClick={() => setSelectedField(field.id)}
                >
                  {field.label}
                </button>
              ))}
            </div>
          </div>

          {/* Value input */}
          {selectedField && selectedFieldConfig && (
            <div className="space-y-2">
              <Label htmlFor="bulk-update-value">New Value</Label>
              <Input id="bulk-update-value" placeholder={selectedFieldConfig.placeholder} value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={loading || !selectedField || !value.trim()}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Updating...
              </>
            ) : (
              'Update'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
