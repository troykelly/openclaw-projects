import * as React from 'react';
import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/ui/lib/utils';
import { Input } from '@/ui/components/ui/input';
import type { InlineEditProps } from './types';

export function InlineEdit({
  value,
  onSave,
  onCancel,
  validate,
  saveOnBlur = false,
  selectOnFocus = false,
  placeholder,
  className,
  disabled = false,
}: InlineEditProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Update edit value when prop value changes
  useEffect(() => {
    if (!isEditing) {
      setEditValue(value);
    }
  }, [value, isEditing]);

  const startEditing = useCallback(() => {
    if (disabled) return;
    setEditValue(value);
    setIsEditing(true);
  }, [value, disabled]);

  const handleSave = useCallback(async () => {
    // Don't save if value unchanged
    if (editValue === value) {
      setIsEditing(false);
      return;
    }

    // Validate if provided
    if (validate && !validate(editValue)) {
      return;
    }

    setIsSaving(true);
    try {
      await onSave(editValue);
      setIsEditing(false);
    } catch {
      // Keep editing on error
    } finally {
      setIsSaving(false);
    }
  }, [editValue, value, validate, onSave]);

  const handleCancel = useCallback(() => {
    setEditValue(value);
    setIsEditing(false);
    onCancel?.();
  }, [value, onCancel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleSave, handleCancel],
  );

  const handleBlur = useCallback(() => {
    if (saveOnBlur) {
      handleSave();
    }
  }, [saveOnBlur, handleSave]);

  // Focus and select on edit start
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      if (selectOnFocus) {
        inputRef.current.select();
      }
    }
  }, [isEditing, selectOnFocus]);

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        disabled={isSaving}
        className={cn('h-auto py-0.5', className)}
        data-testid="inline-edit-input"
      />
    );
  }

  return (
    <span
      onClick={startEditing}
      onDoubleClick={startEditing}
      className={cn(
        'cursor-text rounded px-1 -mx-1 hover:bg-muted/50 transition-colors',
        disabled && 'cursor-default hover:bg-transparent',
        !value && 'text-muted-foreground',
        className,
      )}
      data-testid="inline-edit-display"
    >
      {value || placeholder || '\u00A0'}
    </span>
  );
}
