/**
 * URL validation utilities for the editor.
 * Part of Epic #338, Issue #757
 *
 * Provides validation and normalization for link URLs.
 * Issue #678: Validates protocols to prevent dangerous links.
 */

/**
 * Allowed URL protocols for link insertion.
 * Only http, https, mailto, and tel are considered safe.
 */
export const ALLOWED_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];

/**
 * Validate a URL for safe link insertion.
 * Returns an error message if invalid, or null if valid.
 */
export function validateUrl(url: string): string | null {
  if (!url.trim()) {
    return 'Please enter a URL';
  }

  try {
    const parsedUrl = new URL(url);

    if (!ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) {
      return `Only ${ALLOWED_PROTOCOLS.map((p) => p.replace(':', '')).join(', ')} links are allowed`;
    }

    return null;
  } catch {
    // If URL constructor fails, try adding https:// prefix
    try {
      const urlWithProtocol = `https://${url}`;
      const parsedUrl = new URL(urlWithProtocol);

      if (!ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) {
        return `Only ${ALLOWED_PROTOCOLS.map((p) => p.replace(':', '')).join(', ')} links are allowed`;
      }

      return null;
    } catch {
      return 'Please enter a valid URL';
    }
  }
}

/**
 * Normalize a URL for insertion.
 * Adds https:// prefix if no protocol is provided.
 */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();

  // Check if URL already has a protocol
  if (/^[a-z]+:/i.test(trimmed)) {
    return trimmed;
  }

  // Add https:// prefix for URLs without protocol
  return `https://${trimmed}`;
}
