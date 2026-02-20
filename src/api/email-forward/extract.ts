/**
 * Extract the original recipient from forwarded email headers and body.
 *
 * When emails are auto-forwarded to an inbound address, the original
 * recipient may be hidden behind forwarding headers. This module
 * parses headers in priority order, then falls back to body parsing.
 */

/**
 * Parse in order (first match wins):
 * 1. X-Forwarded-To
 * 2. X-Original-To
 * 3. Delivered-To (if different from inboundAddress)
 * 4. Resent-To
 * 5. To header (if different from inboundAddress)
 *
 * Fallback: body extraction for Gmail/Outlook forwarding patterns.
 */
export function extractOriginalRecipient(
  headers: Record<string, string>,
  body: string,
  inboundAddress: string,
): string | null {
  const normalized = normalizeHeaders(headers);
  const inbound = inboundAddress.toLowerCase().trim();

  // 1. X-Forwarded-To
  const xForwardedTo = extractEmail(normalized['x-forwarded-to']);
  if (xForwardedTo && xForwardedTo !== inbound) return xForwardedTo;

  // 2. X-Original-To
  const xOriginalTo = extractEmail(normalized['x-original-to']);
  if (xOriginalTo && xOriginalTo !== inbound) return xOriginalTo;

  // 3. Delivered-To
  const deliveredTo = extractEmail(normalized['delivered-to']);
  if (deliveredTo && deliveredTo !== inbound) return deliveredTo;

  // 4. Resent-To
  const resentTo = extractEmail(normalized['resent-to']);
  if (resentTo && resentTo !== inbound) return resentTo;

  // 5. To header (if different)
  const to = extractEmail(normalized['to']);
  if (to && to !== inbound) return to;

  // Fallback: body parsing
  return extractFromBody(body, inbound);
}

/**
 * Normalize header keys to lowercase for case-insensitive lookup.
 */
function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key.toLowerCase().trim()] = value;
  }
  return result;
}

/**
 * Extract the first email address from a header value.
 * Handles formats like:
 * - "user@example.com"
 * - "User Name <user@example.com>"
 * - "<user@example.com>"
 */
function extractEmail(value: string | undefined): string | null {
  if (!value) return null;

  // Try angle-bracket format first: <user@example.com>
  const angleMatch = value.match(/<([^>]+@[^>]+)>/);
  if (angleMatch) return angleMatch[1].toLowerCase().trim();

  // Try bare email
  const bareMatch = value.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/);
  if (bareMatch) return bareMatch[1].toLowerCase().trim();

  return null;
}

/**
 * Extract original recipient from forwarded email body patterns.
 *
 * Patterns:
 * - Gmail: "---------- Forwarded message ----------" followed by "To: <email>"
 * - Outlook: "-----Original Message-----" followed by "To: <email>"
 * - Generic: "From: ... To: ..." block near the top
 */
function extractFromBody(body: string, inbound: string): string | null {
  if (!body) return null;

  // Gmail forwarded pattern
  const gmailMatch = body.match(
    /-{5,}\s*Forwarded message\s*-{5,}[\s\S]*?To:\s*([^\n]+)/i,
  );
  if (gmailMatch) {
    const email = extractEmail(gmailMatch[1]);
    if (email && email !== inbound) return email;
  }

  // Outlook forwarded pattern
  const outlookMatch = body.match(
    /-{3,}\s*Original Message\s*-{3,}[\s\S]*?To:\s*([^\n]+)/i,
  );
  if (outlookMatch) {
    const email = extractEmail(outlookMatch[1]);
    if (email && email !== inbound) return email;
  }

  // Generic "To:" line near the beginning (within first 500 chars)
  const topBody = body.substring(0, 500);
  const genericMatch = topBody.match(/^To:\s*([^\n]+)/im);
  if (genericMatch) {
    const email = extractEmail(genericMatch[1]);
    if (email && email !== inbound) return email;
  }

  return null;
}
