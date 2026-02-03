import * as React from 'react';
import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/ui/lib/utils';
import { Input } from '@/ui/components/ui/input';
import { Textarea } from '@/ui/components/ui/textarea';
import type { InlineEditableTextProps } from './types';

export function InlineEditableText({
  value,
  onSave,
  validate,
  saveOnBlur = true,
  selectOnFocus = true,
  placeholder,
  className,
  editClassName,
  disabled = false,
  multiline = false,
  doubleClick = false,
}: InlineEditableTextProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

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

  const handleClick = useCallback(() => {
    if (!doubleClick) {
      startEditing();
    }
  }, [doubleClick, startEditing]);

  const handleDoubleClick = useCallback(() => {
    startEditing();
  }, [startEditing]);

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
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !multiline) {
        e.preventDefault();
        handleSave();
      } else if (e.key === 'Enter' && multiline && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleSave, handleCancel, multiline]
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
      if (selectOnFocus && inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select();
      }
    }
  }, [isEditing, selectOnFocus]);

  if (isEditing) {
    const commonProps = {
      value: editValue,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setEditValue(e.target.value),
      onKeyDown: handleKeyDown,
      onBlur: handleBlur,
      disabled: isSaving,
      className: cn('ring-2 ring-primary', editClassName),
    };

    if (multiline) {
      return (
        <Textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          {...commonProps}
          data-testid="inline-edit-textarea"
        />
      );
    }

    return (
      <Input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        {...commonProps}
        data-testid="inline-edit-input"
      />
    );
  }

  return (
    <span
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={cn(
        'cursor-text rounded px-1 -mx-1 hover:bg-muted/50 transition-colors',
        disabled && 'cursor-default hover:bg-transparent',
        !value && 'text-muted-foreground italic',
        className
      )}
      data-testid="inline-edit-display"
    >
      {value || placeholder || '\u00A0'}
    </span>
  );
}
