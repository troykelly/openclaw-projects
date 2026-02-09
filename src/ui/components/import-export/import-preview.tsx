/**
 * Preview of imported data
 * Issue #398: Implement contact import/export (CSV, vCard)
 */
import * as React from 'react';
import { AlertCircle, CheckCircle } from 'lucide-react';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { cn } from '@/ui/lib/utils';
import type { ParsedContact, ColumnMapping } from './types';

export interface ImportPreviewProps {
  data: ParsedContact[];
  mappings: ColumnMapping[];
  className?: string;
}

interface ValidationError {
  field: string;
  message: string;
}

function validateContact(contact: ParsedContact): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!contact.name || contact.name.trim() === '') {
    errors.push({ field: 'name', message: 'Name is required' });
  }

  if (contact.email && !contact.email.includes('@')) {
    errors.push({ field: 'email', message: 'Invalid email format' });
  }

  return errors;
}

export function ImportPreview({ data, mappings, className }: ImportPreviewProps) {
  // Get mapped fields for column headers
  const mappedFields = mappings.filter((m) => m.targetField && m.targetField !== 'skip').map((m) => m.targetField!);

  // Validate each row
  const rowsWithValidation = data.map((contact, index) => ({
    contact,
    errors: validateContact(contact),
    index,
  }));

  const errorCount = rowsWithValidation.filter((r) => r.errors.length > 0).length;

  return (
    <div className={cn('space-y-3', className)}>
      {/* Summary */}
      <div className="flex items-center justify-between px-2">
        <span className="text-sm font-medium">{data.length} contacts to import</span>
        {errorCount > 0 && (
          <span className="text-sm text-destructive flex items-center gap-1">
            <AlertCircle className="h-3.5 w-3.5" />
            {errorCount} with issues
          </span>
        )}
      </div>

      {/* Preview table */}
      <ScrollArea className="h-64 border rounded-md">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left font-medium w-8">#</th>
              {mappedFields.map((field) => (
                <th key={field} className="px-3 py-2 text-left font-medium capitalize">
                  {field}
                </th>
              ))}
              <th className="px-3 py-2 text-left font-medium w-8">Status</th>
            </tr>
          </thead>
          <tbody>
            {rowsWithValidation.map(({ contact, errors, index }) => (
              <tr
                key={index}
                data-testid={errors.length > 0 ? 'preview-row-error' : 'preview-row'}
                className={cn('border-t', errors.length > 0 && 'bg-destructive/5')}
              >
                <td className="px-3 py-2 text-muted-foreground">{index + 1}</td>
                {mappedFields.map((field) => (
                  <td key={field} className="px-3 py-2 truncate max-w-[150px]">
                    {contact[field] || '-'}
                  </td>
                ))}
                <td className="px-3 py-2">
                  {errors.length > 0 ? (
                    <div className="flex items-center gap-1">
                      <AlertCircle className="h-4 w-4 text-destructive" />
                      <span className="text-xs text-destructive">{errors[0].message}</span>
                    </div>
                  ) : (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}
