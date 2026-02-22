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
export function validateNote(data: { title: string; content?: string; notebook_id?: string; tags?: string[] }): ValidationResult {
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
  if (data.notebook_id !== undefined && data.notebook_id !== null) {
    const trimmedNotebookId = data.notebook_id.trim();
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

// ---------------------------------------------------------------------------
// OAuth re-authorization URL validation (issue #1619)
// ---------------------------------------------------------------------------

/**
 * Allowed hostnames for OAuth re-authorization redirects.
 *
 * Only these provider-operated domains may appear as a `reAuthUrl` from the
 * API. Anything else — including spoofed subdomains, plain HTTP, or dangerous
 * schemes such as javascript: or data: — is rejected.
 */
const ALLOWED_REAUTH_HOSTNAMES = new Set([
  'accounts.google.com',
  'login.microsoftonline.com',
  'login.live.com',
]);

/**
 * Validate a re-authorization URL received from the OAuth PATCH response.
 *
 * Accepts only `https:` URLs whose hostname is an exact match against the
 * known OAuth provider allowlist. Returns the original URL string when valid,
 * or `null` when the URL is unsafe, off-domain, or malformed.
 *
 * @param url - The raw reAuthUrl string from the server response
 * @returns The validated URL string, or null if invalid
 */
export function validateReAuthUrl(url: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    if (!ALLOWED_REAUTH_HOSTNAMES.has(parsed.hostname)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}
