/**
 * Input component for custom field values
 */
import * as React from 'react';
import { Input } from '@/ui/components/ui/input';
import { Textarea } from '@/ui/components/ui/textarea';
import { Checkbox } from '@/ui/components/ui/checkbox';
import { Label } from '@/ui/components/ui/label';
import { cn } from '@/ui/lib/utils';
import type { CustomFieldInputProps } from './types';

export function CustomFieldInput({
  field,
  value,
  onChange,
  disabled = false,
  error,
}: CustomFieldInputProps) {
  const renderInput = () => {
    switch (field.type) {
      case 'text':
        return (
          <Input
            type="text"
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            placeholder={field.description}
          />
        );

      case 'longtext':
        return (
          <Textarea
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            placeholder={field.description}
            rows={3}
          />
        );

      case 'number':
        return (
          <Input
            type="number"
            value={value !== undefined && value !== null ? String(value) : ''}
            onChange={(e) =>
              onChange(e.target.value ? Number(e.target.value) : null)
            }
            disabled={disabled}
            min={field.validation?.min}
            max={field.validation?.max}
          />
        );

      case 'date':
        return (
          <Input
            type="date"
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          />
        );

      case 'select':
        return (
          <select
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            aria-label={field.name}
          >
            <option value="">Select...</option>
            {field.options?.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );

      case 'multiselect':
        return (
          <div className="space-y-2">
            {field.options?.map((option) => {
              const selected = Array.isArray(value) && value.includes(option);
              return (
                <div key={option} className="flex items-center gap-2">
                  <Checkbox
                    id={`${field.id}-${option}`}
                    checked={selected}
                    onCheckedChange={(checked) => {
                      const current = Array.isArray(value) ? value : [];
                      if (checked) {
                        onChange([...current, option]);
                      } else {
                        onChange(current.filter((v) => v !== option));
                      }
                    }}
                    disabled={disabled}
                  />
                  <Label htmlFor={`${field.id}-${option}`}>{option}</Label>
                </div>
              );
            })}
          </div>
        );

      case 'checkbox':
        return (
          <Checkbox
            checked={Boolean(value)}
            onCheckedChange={(checked) => onChange(checked)}
            disabled={disabled}
            aria-label={field.name}
          />
        );

      case 'url':
        return (
          <Input
            type="url"
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            placeholder="https://..."
          />
        );

      case 'user':
        // User picker would need contact integration
        return (
          <Input
            type="text"
            value={(value as string) || ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            placeholder="User ID"
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <Label htmlFor={field.id} className="text-sm font-medium">
          {field.name}
        </Label>
        {field.required && <span className="text-destructive">*</span>}
      </div>
      {field.description && field.type !== 'text' && (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      )}
      {renderInput()}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
