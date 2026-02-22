import * as React from 'react';
import { useState } from 'react';
import { Download, Upload, FileJson, FileSpreadsheet, AlertCircle } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { apiClient } from '@/ui/lib/api-client.ts';
import { useImportContacts } from '@/ui/hooks/mutations/use-update-contact.ts';

// ============================================================
// Export Dialog
// ============================================================

export interface ContactExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds?: string[];
}

export function ContactExportDialog({ open, onOpenChange, selectedIds }: ContactExportDialogProps) {
  const [format, setFormat] = useState<'json' | 'csv'>('csv');
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams({ format });
      if (selectedIds?.length) params.set('ids', selectedIds.join(','));
      const url = `/api/contacts/export?${params}`;

      const response = await fetch(url);
      if (!response.ok) throw new Error('Export failed');

      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `contacts.${format}`;
      link.click();
      URL.revokeObjectURL(link.href);
      onOpenChange(false);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Export Contacts</DialogTitle>
          <DialogDescription>
            {selectedIds?.length ? `Export ${selectedIds.length} selected contact${selectedIds.length !== 1 ? 's' : ''}.` : 'Export all contacts.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="export-format" className="text-sm font-medium">
              Format
            </label>
            <Select value={format} onValueChange={(v) => setFormat(v as 'json' | 'csv')}>
              <SelectTrigger id="export-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">
                  <span className="flex items-center gap-2">
                    <FileSpreadsheet className="size-4" />
                    CSV
                  </span>
                </SelectItem>
                <SelectItem value="json">
                  <span className="flex items-center gap-2">
                    <FileJson className="size-4" />
                    JSON
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={isExporting}>
            <Download className="mr-1 size-4" />
            {isExporting ? 'Exporting...' : 'Export'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Import Dialog
// ============================================================

export interface ContactImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}

export function ContactImportDialog({ open, onOpenChange, onImported }: ContactImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [duplicateHandling, setDuplicateHandling] = useState<'skip' | 'update' | 'create'>('skip');
  const [preview, setPreview] = useState<Array<Record<string, unknown>> | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const importMutation = useImportContacts();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setParseError(null);
    setPreview(null);

    try {
      const text = await f.text();
      if (f.name.endsWith('.json')) {
        const parsed = JSON.parse(text);
        const contacts = Array.isArray(parsed) ? parsed : parsed.contacts;
        if (!Array.isArray(contacts)) throw new Error('JSON must be an array or contain a "contacts" array');
        setPreview(contacts.slice(0, 5));
      } else {
        setPreview(null);
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse file');
    }
  };

  const handleImport = async () => {
    if (!file) return;

    try {
      const text = await file.text();
      let contacts: Array<Record<string, unknown>>;

      if (file.name.endsWith('.json')) {
        const parsed = JSON.parse(text);
        contacts = Array.isArray(parsed) ? parsed : parsed.contacts;
      } else {
        // For CSV, send to server which handles parsing
        contacts = csvToObjects(text);
      }

      importMutation.mutate(
        { contacts, duplicate_handling: duplicateHandling },
        {
          onSuccess: () => {
            onOpenChange(false);
            setFile(null);
            setPreview(null);
            onImported?.();
          },
        },
      );
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse file');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import Contacts</DialogTitle>
          <DialogDescription>Upload a JSON or CSV file to import contacts.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="import-file" className="text-sm font-medium">
              File
            </label>
            <input
              id="import-file"
              type="file"
              accept=".json,.csv"
              onChange={handleFileChange}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium"
            />
          </div>

          {parseError && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <p>{parseError}</p>
            </div>
          )}

          {preview && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Preview (first {preview.length} records)</p>
              <div className="max-h-32 overflow-auto rounded-md bg-muted/50 p-2 text-xs font-mono">
                {preview.map((row, i) => (
                  <div key={i} className="truncate">
                    {JSON.stringify(row).slice(0, 120)}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="duplicate-handling" className="text-sm font-medium">
              Duplicate handling
            </label>
            <Select value={duplicateHandling} onValueChange={(v) => setDuplicateHandling(v as 'skip' | 'update' | 'create')}>
              <SelectTrigger id="duplicate-handling">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="skip">Skip duplicates</SelectItem>
                <SelectItem value="update">Update existing</SelectItem>
                <SelectItem value="create">Create new</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={!file || !!parseError || importMutation.isPending}>
            <Upload className="mr-1 size-4" />
            {importMutation.isPending ? 'Importing...' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Simple CSV to objects parser for client-side preview. */
function csvToObjects(text: string): Array<Record<string, unknown>> {
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((line) => {
    const values = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] ?? '';
    });
    return obj;
  });
}
