/**
 * Summary of import results
 * Issue #398: Implement contact import/export (CSV, vCard)
 */
import * as React from 'react';
import { CheckCircle, AlertCircle, MinusCircle } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { cn } from '@/ui/lib/utils';
import type { ImportResult } from './types';

export interface ImportSummaryProps {
  result: ImportResult;
  onClose: () => void;
  className?: string;
}

export function ImportSummary({ result, onClose, className }: ImportSummaryProps) {
  return (
    <div className={cn('space-y-4', className)}>
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="text-center p-4 rounded-lg bg-green-50 dark:bg-green-900/20">
          <CheckCircle className="h-6 w-6 mx-auto mb-1 text-green-600" />
          <div className="text-2xl font-semibold text-green-600">{result.imported}</div>
          <div className="text-xs text-muted-foreground">Imported</div>
        </div>

        <div className="text-center p-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/20">
          <MinusCircle className="h-6 w-6 mx-auto mb-1 text-yellow-600" />
          <div className="text-2xl font-semibold text-yellow-600">{result.skipped}</div>
          <div className="text-xs text-muted-foreground">Skipped</div>
        </div>

        <div className="text-center p-4 rounded-lg bg-red-50 dark:bg-red-900/20">
          <AlertCircle className="h-6 w-6 mx-auto mb-1 text-red-600" />
          <div className="text-2xl font-semibold text-red-600">{result.errors}</div>
          <div className="text-xs text-muted-foreground">Errors</div>
        </div>
      </div>

      {/* Error details */}
      {result.errorDetails.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium">Error Details</div>
          <ScrollArea className="h-32 border rounded-md">
            <div className="p-3 space-y-2">
              {result.errorDetails.map((error, index) => (
                <div key={index} className="flex items-start gap-2 text-sm">
                  <span className="text-muted-foreground shrink-0">Row {error.row}:</span>
                  <span className="text-destructive">{error.message}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Done button */}
      <div className="flex justify-end">
        <Button onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}
