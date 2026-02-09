/**
 * Validation utilities for custom fields
 */
import type { CustomFieldDefinition } from './types';

/**
 * Validate a field value against its definition
 * Returns error message or null if valid
 */
export function validateFieldValue(field: CustomFieldDefinition, value: unknown): string | null {
  // Check required
  if (field.required) {
    if (value === null || value === undefined || value === '') {
      return 'This field is required';
    }
    if (Array.isArray(value) && value.length === 0) {
      return 'This field is required';
    }
  }

  // Skip further validation if empty and not required
  if (value === null || value === undefined || value === '') {
    return null;
  }

  // Type-specific validation
  switch (field.type) {
    case 'number':
      return validateNumber(field, value as number);
    case 'url':
      return validateUrl(value as string);
    case 'text':
    case 'longtext':
      return validateText(field, value as string);
    default:
      return null;
  }
}

function validateNumber(field: CustomFieldDefinition, value: number): string | null {
  if (typeof value !== 'number' || isNaN(value)) {
    return 'Invalid number';
  }

  const { validation } = field;
  if (!validation) return null;

  if (validation.min !== undefined && value < validation.min) {
    return `Value must be at least ${validation.min}`;
  }
  if (validation.max !== undefined && value > validation.max) {
    return `Value must be at most ${validation.max}`;
  }

  return null;
}

function validateUrl(value: string): string | null {
  try {
    new URL(value);
    return null;
  } catch {
    return 'Invalid URL format';
  }
}

function validateText(field: CustomFieldDefinition, value: string): string | null {
  const { validation } = field;
  if (!validation) return null;

  if (validation.min !== undefined && value.length < validation.min) {
    return `Must be at least ${validation.min} characters`;
  }
  if (validation.max !== undefined && value.length > validation.max) {
    return `Must be at most ${validation.max} characters`;
  }
  if (validation.pattern) {
    const regex = new RegExp(validation.pattern);
    if (!regex.test(value)) {
      return validation.patternMessage || 'Invalid format';
    }
  }

  return null;
}

/**
 * Check if a field type supports options
 */
export function fieldTypeHasOptions(type: string): boolean {
  return type === 'select' || type === 'multiselect';
}

/**
 * Check if a field type supports validation rules
 */
export function fieldTypeHasValidation(type: string): boolean {
  return type === 'number' || type === 'text' || type === 'longtext';
}
