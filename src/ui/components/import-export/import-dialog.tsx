/**
 * Import dialog for contacts
 * Issue #398: Implement contact import/export (CSV, vCard)
 */
import * as React from 'react';
import { Upload, FileUp, Loader2 } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Label } from '@/ui/components/ui/label';
import { Progress } from '@/ui/components/ui/progress';
import { cn } from '@/ui/lib/utils';
import type { ImportFormat, DuplicateHandling, ParsedContact, ColumnMapping } from './types';

export interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (contacts: ParsedContact[], options: { duplicateHandling: DuplicateHandling }) => void;
  importing?: boolean;
  progress?: number;
}

export function ImportDialog({ open, onOpenChange, onImport, importing = false, progress = 0 }: ImportDialogProps) {
  const [file, setFile] = React.useState<File | null>(null);
  const [format, setFormat] = React.useState<ImportFormat>('csv');
  const [duplicateHandling, setDuplicateHandling] = React.useState<DuplicateHandling>('skip');
  const [dragActive, setDragActive] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = (file: File) => {
    setFile(file);
    // Auto-detect format from extension
    if (file.name.endsWith('.vcf')) {
      setFormat('vcard');
    } else {
      setFormat('csv');
    }
  };

  const handleImport = () => {
    if (!file) return;
    // In real implementation, this would parse and process the file
    onImport([], { duplicateHandling });
  };

  // Reset when dialog opens
  React.useEffect(() => {
    if (open) {
      setFile(null);
      setFormat('csv');
      setDuplicateHandling('skip');
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-full bg-primary/10">
              <Upload className="h-5 w-5 text-primary" />
            </div>
            <DialogTitle>Import Contacts</DialogTitle>
          </div>
          <DialogDescription>Upload a CSV or vCard file to import contacts.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* File upload */}
          <div
            className={cn(
              'border-2 border-dashed rounded-lg p-6 text-center transition-colors',
              dragActive && 'border-primary bg-primary/5',
              !dragActive && 'border-muted-foreground/25',
            )}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <input ref={fileInputRef} type="file" accept=".csv,.vcf" onChange={handleFileInput} className="hidden" data-testid="file-input" />

            {file ? (
              <div className="flex items-center justify-center gap-2">
                <FileUp className="h-5 w-5 text-muted-foreground" />
                <span className="font-medium">{file.name}</span>
                <Button variant="ghost" size="sm" onClick={() => setFile(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <FileUp className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Drop a file here or{' '}
                  <button type="button" className="text-primary hover:underline" onClick={() => fileInputRef.current?.click()}>
                    upload
                  </button>
                </p>
              </div>
            )}
          </div>

          {/* Format selection */}
          <div className="space-y-2">
            <Label>Format</Label>
            <div className="flex gap-2">
              {(['csv', 'vcard'] as ImportFormat[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={cn(
                    'flex-1 px-3 py-2 rounded-md border text-sm transition-colors',
                    format === f ? 'border-primary bg-primary/10' : 'border-muted hover:bg-muted',
                  )}
                  onClick={() => setFormat(f)}
                >
                  {f === 'csv' ? 'CSV' : 'vCard'}
                </button>
              ))}
            </div>
          </div>

          {/* Duplicate handling */}
          <div className="space-y-2">
            <Label>If duplicate found</Label>
            <div className="flex gap-2">
              {[
                { value: 'skip', label: 'Skip' },
                { value: 'update', label: 'Update' },
                { value: 'create', label: 'Create new' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    'flex-1 px-3 py-2 rounded-md border text-sm transition-colors',
                    duplicateHandling === option.value ? 'border-primary bg-primary/10' : 'border-muted hover:bg-muted',
                  )}
                  onClick={() => setDuplicateHandling(option.value as DuplicateHandling)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Progress */}
          {importing && (
            <div className="space-y-2">
              <Progress value={progress} />
              <p className="text-sm text-muted-foreground text-center">Importing... {progress}%</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={!file || importing}>
            {importing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              'Import'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
