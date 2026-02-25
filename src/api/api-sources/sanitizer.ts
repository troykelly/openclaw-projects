/**
 * Spec text sanitizer for OpenAPI description fields.
 * Strips HTML, markdown injection, prompt injection patterns,
 * normalizes whitespace, and truncates to field-specific limits.
 * Part of API Onboarding feature (#1777).
 */

/** Patterns that indicate prompt injection attempts. */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions?/gi,
  /disregard\s+(all\s+)?(your\s+)?(previous\s+)?instructions?/gi,
  /you\s+are\s+now\s+/gi,
  /system\s+prompt/gi,
  /forget\s+(all\s+)?(your\s+)?(previous\s+)?instructions?/gi,
  /override\s+(all\s+)?(your\s+)?(previous\s+)?instructions?/gi,
  /new\s+instructions?\s*:/gi,
  /act\s+as\s+(if|though)\s+you\s+are/gi,
  /pretend\s+(you\s+are|to\s+be)/gi,
];

/** Markdown image pattern: ![alt](url) */
const MD_IMAGE_RE = /!\[([^\]]*)\]\([^)]+\)/g;

/** Markdown link with dangerous scheme: [text](javascript:...) */
const MD_DANGEROUS_LINK_RE = /\[([^\]]*)\]\(\s*(?:javascript|data|vbscript)\s*:[^)]*\)/gi;

/** HTML tags including script/style with content */
const SCRIPT_STYLE_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const HTML_TAG_RE = /<[^>]+>/g;

/** Control characters except tab (\x09), newline (\x0A), carriage return (\x0D) */
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/** Excessive newlines (3+ consecutive) */
const EXCESSIVE_NEWLINES_RE = /\n{3,}/g;

/** Excessive spaces (2+ consecutive) */
const EXCESSIVE_SPACES_RE = / {2,}/g;

export interface SanitizeResult {
  text: string;
  sanitized: boolean;
}

/**
 * Sanitize a text field from an OpenAPI spec.
 * Returns the cleaned text and whether any sanitization was applied.
 */
export function sanitizeSpecText(text: string, maxLength: number): SanitizeResult {
  if (text === '') {
    return { text: '', sanitized: false };
  }

  let result = text;
  let changed = false;

  // 1. Remove script/style tags with their content
  const afterScript = result.replace(SCRIPT_STYLE_RE, '');
  if (afterScript !== result) {
    result = afterScript;
    changed = true;
  }

  // 2. Strip HTML tags
  const afterHtml = result.replace(HTML_TAG_RE, '');
  if (afterHtml !== result) {
    result = afterHtml;
    changed = true;
  }

  // 3. Strip markdown images (keep alt text)
  const afterImages = result.replace(MD_IMAGE_RE, '$1');
  if (afterImages !== result) {
    result = afterImages;
    changed = true;
  }

  // 4. Strip dangerous markdown links (keep link text)
  const afterDangerousLinks = result.replace(MD_DANGEROUS_LINK_RE, '$1');
  if (afterDangerousLinks !== result) {
    result = afterDangerousLinks;
    changed = true;
  }

  // 5. Remove prompt injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    // Reset lastIndex since these are global regexes
    pattern.lastIndex = 0;
    const afterInjection = result.replace(pattern, '');
    if (afterInjection !== result) {
      result = afterInjection;
      changed = true;
    }
  }

  // 6. Remove control characters (preserve \t, \n, \r)
  const afterControl = result.replace(CONTROL_CHAR_RE, ' ');
  if (afterControl !== result) {
    result = afterControl;
    changed = true;
  }

  // 7. Normalize whitespace
  const afterNewlines = result.replace(EXCESSIVE_NEWLINES_RE, '\n\n');
  if (afterNewlines !== result) {
    result = afterNewlines;
    changed = true;
  }

  const afterSpaces = result.replace(EXCESSIVE_SPACES_RE, ' ');
  if (afterSpaces !== result) {
    result = afterSpaces;
    changed = true;
  }

  // 8. Trim
  const trimmed = result.trim();
  if (trimmed !== result) {
    result = trimmed;
    // Don't count trimming alone as sanitization
  }

  // 9. Truncate to max length
  if (result.length > maxLength) {
    result = result.slice(0, maxLength) + '...';
    changed = true;
  }

  return { text: result, sanitized: changed };
}

/** Sanitize an operation description (max 1000 chars). */
export function sanitizeOperationDescription(text: string): SanitizeResult {
  return sanitizeSpecText(text, 1000);
}

/** Sanitize a parameter description (max 200 chars). */
export function sanitizeParameterDescription(text: string): SanitizeResult {
  return sanitizeSpecText(text, 200);
}

/** Sanitize an API-level description (max 2000 chars). */
export function sanitizeApiDescription(text: string): SanitizeResult {
  return sanitizeSpecText(text, 2000);
}

/** Sanitize a tag group description (max 500 chars). */
export function sanitizeTagDescription(text: string): SanitizeResult {
  return sanitizeSpecText(text, 500);
}
