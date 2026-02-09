/**
 * Client-side validation utilities for notes and notebooks.
 *
 * Provides early validation before API calls to:
 * - Give faster feedback to users
 * - Reduce unnecessary network requests
 * - Catch obvious errors client-side
 *
 * Part of Epic #338, Issue #656
 */

/** Validation result type */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Note validation constants */
export const NOTE_VALIDATION = {
  /** Maximum title length in characters */
  MAX_TITLE_LENGTH: 500,
  /** Maximum content length in characters (100KB of text) */
  MAX_CONTENT_LENGTH: 100_000,
  /** Maximum number of tags */
  MAX_TAGS: 20,
  /** Maximum tag length */
  MAX_TAG_LENGTH: 50,
} as const;

/** Notebook validation constants */
export const NOTEBOOK_VALIDATION = {
  /** Maximum name length in characters */
  MAX_NAME_LENGTH: 100,
  /** Maximum description length in characters */
  MAX_DESCRIPTION_LENGTH: 500,
} as const;

/** Email validation regex (simple but effective) */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate note creation/update data.
 *
 * @param data - Note data to validate
 * @returns Validation result with any errors
 */
export function validateNote(data: { title: string; content?: string; notebookId?: string; tags?: string[] }): ValidationResult {
  const errors: string[] = [];

  // Title validation
  const trimmedTitle = data.title.trim();
  if (!trimmedTitle) {
    errors.push('Title is required');
  } else if (trimmedTitle.length > NOTE_VALIDATION.MAX_TITLE_LENGTH) {
    errors.push(`Title must be ${NOTE_VALIDATION.MAX_TITLE_LENGTH} characters or less`);
  }

  // Content validation (optional but has max length)
  if (data.content && data.content.length > NOTE_VALIDATION.MAX_CONTENT_LENGTH) {
    errors.push(`Content must be ${NOTE_VALIDATION.MAX_CONTENT_LENGTH.toLocaleString()} characters or less`);
  }

  // Notebook ID validation (if provided, must be non-empty)
  if (data.notebookId !== undefined && data.notebookId !== null) {
    const trimmedNotebookId = data.notebookId.trim();
    if (trimmedNotebookId.length === 0) {
      errors.push('Notebook ID cannot be empty');
    }
  }

  // Tags validation
  if (data.tags) {
    if (data.tags.length > NOTE_VALIDATION.MAX_TAGS) {
      errors.push(`Maximum ${NOTE_VALIDATION.MAX_TAGS} tags allowed`);
    }
    for (const tag of data.tags) {
      if (tag.length > NOTE_VALIDATION.MAX_TAG_LENGTH) {
        errors.push(`Tag "${tag.slice(0, 20)}..." exceeds ${NOTE_VALIDATION.MAX_TAG_LENGTH} characters`);
        break; // Only report first tag error
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate notebook creation/update data.
 *
 * @param data - Notebook data to validate
 * @returns Validation result with any errors
 */
export function validateNotebook(data: { name: string; description?: string; color?: string }): ValidationResult {
  const errors: string[] = [];

  // Name validation
  const trimmedName = data.name.trim();
  if (!trimmedName) {
    errors.push('Name is required');
  } else if (trimmedName.length > NOTEBOOK_VALIDATION.MAX_NAME_LENGTH) {
    errors.push(`Name must be ${NOTEBOOK_VALIDATION.MAX_NAME_LENGTH} characters or less`);
  }

  // Description validation (optional)
  if (data.description && data.description.length > NOTEBOOK_VALIDATION.MAX_DESCRIPTION_LENGTH) {
    errors.push(`Description must be ${NOTEBOOK_VALIDATION.MAX_DESCRIPTION_LENGTH} characters or less`);
  }

  // Color validation (if provided, should be valid hex color)
  if (data.color && !/^#[0-9A-Fa-f]{6}$/.test(data.color)) {
    errors.push('Color must be a valid hex color (e.g., #6366f1)');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate email address for sharing.
 *
 * @param email - Email address to validate
 * @returns Validation result with any errors
 */
export function validateEmail(email: string): ValidationResult {
  const errors: string[] = [];

  const trimmedEmail = email.trim();
  if (!trimmedEmail) {
    errors.push('Email is required');
  } else if (!EMAIL_REGEX.test(trimmedEmail)) {
    errors.push('Please enter a valid email address');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Create a validation error message from a ValidationResult.
 *
 * @param result - Validation result
 * @returns Combined error message or empty string if valid
 */
export function getValidationErrorMessage(result: ValidationResult): string {
  if (result.valid) return '';
  return result.errors.join('. ');
}
