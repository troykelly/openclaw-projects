/**
 * Export dialog for contacts
 * Issue #398: Implement contact import/export (CSV, vCard)
 */
import * as React from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Label } from '@/ui/components/ui/label';
import { Checkbox } from '@/ui/components/ui/checkbox';
import { cn } from '@/ui/lib/utils';
import type { ExportFormat, ExportScope, ContactField } from './types';
import { CONTACT_FIELDS } from './import-export-utils';

export interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExport: (format: ExportFormat, scope: ExportScope) => void;
  contactCount: number;
  selectedCount: number;
  exporting?: boolean;
}

export function ExportDialog({ open, onOpenChange, onExport, contactCount, selectedCount, exporting = false }: ExportDialogProps) {
  const [format, setFormat] = React.useState<ExportFormat>('csv');
  const [scope, setScope] = React.useState<ExportScope>('all');
  const [selectedFields, setSelectedFields] = React.useState<Set<ContactField>>(new Set(['name', 'email', 'phone', 'organization', 'role']));

  const toggleField = (field: ContactField) => {
    const newFields = new Set(selectedFields);
    if (newFields.has(field)) {
      newFields.delete(field);
    } else {
      newFields.add(field);
    }
    setSelectedFields(newFields);
  };

  const handleExport = () => {
    onExport(format, scope);
  };

  // Reset when dialog opens
  React.useEffect(() => {
    if (open) {
      setFormat('csv');
      setScope(selectedCount > 0 ? 'selected' : 'all');
    }
  }, [open, selectedCount]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-full bg-primary/10">
              <Download className="h-5 w-5 text-primary" />
            </div>
            <DialogTitle>Export Contacts</DialogTitle>
          </div>
          <DialogDescription>Export contacts in your preferred format.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Format selection */}
          <div className="space-y-2">
            <Label>Format</Label>
            <div className="flex gap-2">
              {(
                [
                  { value: 'csv', label: 'CSV' },
                  { value: 'vcard', label: 'vCard' },
                  { value: 'json', label: 'JSON' },
                ] as { value: ExportFormat; label: string }[]
              ).map((f) => (
                <button
                  key={f.value}
                  type="button"
                  className={cn(
                    'flex-1 px-3 py-2 rounded-md border text-sm transition-colors',
                    format === f.value ? 'border-primary bg-primary/10' : 'border-muted hover:bg-muted',
                  )}
                  onClick={() => setFormat(f.value)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Scope selection */}
          <div className="space-y-2">
            <Label>Export</Label>
            <div className="flex gap-2">
              <button
                type="button"
                className={cn(
                  'flex-1 px-3 py-2 rounded-md border text-sm transition-colors',
                  scope === 'all' ? 'border-primary bg-primary/10' : 'border-muted hover:bg-muted',
                )}
                onClick={() => setScope('all')}
              >
                All ({contactCount})
              </button>
              <button
                type="button"
                disabled={selectedCount === 0}
                className={cn(
                  'flex-1 px-3 py-2 rounded-md border text-sm transition-colors',
                  scope === 'selected' ? 'border-primary bg-primary/10' : 'border-muted hover:bg-muted',
                  selectedCount === 0 && 'opacity-50 cursor-not-allowed',
                )}
                onClick={() => setScope('selected')}
              >
                Selected ({selectedCount})
              </button>
            </div>
          </div>

          {/* Field selection for CSV */}
          {format === 'csv' && (
            <div className="space-y-2">
              <Label>Fields to include</Label>
              <div className="grid grid-cols-2 gap-2">
                {CONTACT_FIELDS.map((field) => (
                  <label key={field.id} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox checked={selectedFields.has(field.id)} onCheckedChange={() => toggleField(field.id)} />
                    <span className="text-sm">{field.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={exporting}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={exporting}>
            {exporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Exporting...
              </>
            ) : (
              'Export'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
