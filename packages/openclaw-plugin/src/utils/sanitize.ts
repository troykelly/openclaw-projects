/**
 * Shared sanitization utilities for tool implementations.
 * Extracted from duplicated copies across tool modules.
 */

/**
 * Sanitize text input to remove control characters.
 */
export function sanitizeText(text: string): string {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

/**
 * Create a sanitized error message that doesn't expose internal details.
 */
export function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[host]')
      .replace(/:\d{2,5}\b/g, '')
      .replace(/\b(?:localhost|internal[-\w]*)\b/gi, '[internal]');

    if (message.includes('[internal]') || message.includes('[host]')) {
      return 'Failed to complete operation. Please try again.';
    }

    return message;
  }
  return 'An unexpected error occurred.';
}

/**
 * Truncate text for display preview.
 */
export function truncateForPreview(text: string, maxLength = 100): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.substring(0, maxLength)}...`;
}
