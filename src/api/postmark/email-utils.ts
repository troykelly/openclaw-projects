/**
 * Email utilities for Postmark integration.
 * Part of Issue #203.
 */

import type { ParsedEmailAddress, PostmarkHeader } from './types.js';

/**
 * Parse an email address string into components.
 * Handles formats like:
 * - "user@example.com"
 * - "Name <user@example.com>"
 * - "<user@example.com>"
 *
 * @param address - Raw email address string
 * @returns Parsed email and name
 */
export function parseEmailAddress(address: string): ParsedEmailAddress {
  const trimmed = address.trim();

  // Try to match "Name <email>" format
  const match = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    return {
      name: match[1].trim().replace(/^["']|["']$/g, '') || null,
      email: match[2].trim().toLowerCase(),
    };
  }

  // Try to match "<email>" format
  const bracketMatch = trimmed.match(/^<([^>]+)>$/);
  if (bracketMatch) {
    return {
      name: null,
      email: bracketMatch[1].trim().toLowerCase(),
    };
  }

  // Assume it's just an email address
  return {
    name: null,
    email: trimmed.toLowerCase(),
  };
}

/**
 * Normalize an email address to lowercase.
 *
 * @param email - Email address
 * @returns Normalized email
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Extract a specific header value from Postmark headers.
 *
 * @param headers - Array of Postmark headers
 * @param name - Header name (case-insensitive)
 * @returns Header value or null if not found
 */
export function getHeader(headers: PostmarkHeader[], name: string): string | null {
  const lowerName = name.toLowerCase();
  const header = headers.find((h) => h.Name.toLowerCase() === lowerName);
  return header?.Value ?? null;
}

/**
 * Extract Message-ID header from Postmark headers.
 * Strips angle brackets if present.
 *
 * @param headers - Array of Postmark headers
 * @returns Message ID or null
 */
export function getMessageId(headers: PostmarkHeader[]): string | null {
  const messageId = getHeader(headers, 'Message-ID') || getHeader(headers, 'Message-Id');
  if (!messageId) return null;
  // Remove angle brackets
  return messageId.replace(/^<|>$/g, '');
}

/**
 * Extract In-Reply-To header from Postmark headers.
 * Strips angle brackets if present.
 *
 * @param headers - Array of Postmark headers
 * @returns In-Reply-To ID or null
 */
export function getInReplyTo(headers: PostmarkHeader[]): string | null {
  const inReplyTo = getHeader(headers, 'In-Reply-To');
  if (!inReplyTo) return null;
  // Remove angle brackets
  return inReplyTo.replace(/^<|>$/g, '');
}

/**
 * Extract References header from Postmark headers.
 * Returns array of message IDs.
 *
 * @param headers - Array of Postmark headers
 * @returns Array of reference message IDs
 */
export function getReferences(headers: PostmarkHeader[]): string[] {
  const references = getHeader(headers, 'References');
  if (!references) return [];

  // References can be space-separated or comma-separated
  return references
    .split(/[\s,]+/)
    .map((ref) => ref.replace(/^<|>$/g, '').trim())
    .filter(Boolean);
}

/**
 * Create a thread key for email conversations.
 * Uses Message-ID references for threading.
 *
 * @param messageId - Message ID
 * @param inReplyTo - In-Reply-To header value
 * @param references - References header values
 * @returns Thread key string
 */
export function createEmailThreadKey(
  messageId: string | null,
  inReplyTo: string | null,
  references: string[]
): string {
  // If we have in-reply-to, use the root message from references or in-reply-to
  if (references.length > 0) {
    return `email:${references[0]}`;
  }

  if (inReplyTo) {
    return `email:${inReplyTo}`;
  }

  // New thread - use this message's ID
  if (messageId) {
    return `email:${messageId}`;
  }

  // Fallback to random key
  return `email:${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Strip quoted content from email reply.
 * Removes common quote patterns.
 *
 * @param text - Email body text
 * @returns Text without quoted content
 */
export function stripQuotedContent(text: string): string {
  // Common quote patterns
  const patterns = [
    // Gmail/Outlook style: "On [date], [name] wrote:"
    /^On .+? wrote:[\s\S]*$/m,
    // Forward style: "---------- Forwarded message ---------"
    /^-+\s*Forwarded message\s*-+[\s\S]*$/mi,
    // Quote markers: lines starting with ">"
    /^>.*$/gm,
    // "Original Message" separator
    /^-+\s*Original Message\s*-+[\s\S]*$/mi,
  ];

  let stripped = text;
  for (const pattern of patterns) {
    stripped = stripped.replace(pattern, '').trim();
  }

  return stripped;
}

/**
 * Extract plain text from HTML email body.
 * Simple extraction without full HTML parsing.
 *
 * @param html - HTML content
 * @returns Plain text content
 */
export function htmlToPlainText(html: string): string {
  return html
    // Remove style and script tags with content
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    // Replace br and p tags with newlines
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    // Replace other block-level elements with newlines
    .replace(/<\/div>/gi, '\n')
    .replace(/<div[^>]*>/gi, '')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    // Strip remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Normalize whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Get the best plain text content from an email.
 * Prefers TextBody, falls back to HtmlBody conversion.
 *
 * @param textBody - Plain text body
 * @param htmlBody - HTML body
 * @returns Best available plain text
 */
export function getBestPlainText(textBody?: string, htmlBody?: string): string {
  if (textBody && textBody.trim()) {
    return textBody.trim();
  }

  if (htmlBody) {
    return htmlToPlainText(htmlBody);
  }

  return '';
}
