/**
 * HTML sanitization utilities for the editor.
 * Part of Epic #338, Issue #757
 *
 * Uses DOMPurify to prevent XSS attacks.
 * Issue #674: Prevents XSS via dangerouslySetInnerHTML.
 */

import DOMPurify from 'dompurify';

/**
 * DOMPurify configuration for sanitizing HTML output.
 * Allows safe HTML tags for markdown rendering while stripping dangerous content.
 */
export const DOMPURIFY_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: [
    // Text formatting
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'span',
    'div',
    'strong',
    'em',
    'del',
    'u',
    'sub',
    'sup',
    // Lists
    'ul',
    'ol',
    'li',
    // Code
    'pre',
    'code',
    // Tables
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    // Other
    'blockquote',
    'a',
    'br',
    'hr',
  ],
  ALLOWED_ATTR: [
    'href',
    'class',
    'id',
    // Table attributes
    'colspan',
    'rowspan',
    // Accessibility attributes
    'role',
    'aria-label',
    'title',
    // Mermaid diagram data attribute (safe - stored as text, not executed as HTML)
    'data-mermaid',
  ],
  // Allow data-* attributes pattern for Mermaid and other safe data attributes
  ADD_ATTR: ['data-mermaid'],
  // Only allow safe URL protocols for links
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  // Explicitly forbid dangerous event handlers
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
  FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'input', 'button', 'select', 'textarea', 'object', 'embed'],
};

/**
 * Sanitize HTML to prevent XSS attacks.
 * Uses DOMPurify with a strict configuration for markdown-rendered content.
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, DOMPURIFY_CONFIG);
}

/**
 * Escape HTML to prevent XSS when displaying error messages.
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
