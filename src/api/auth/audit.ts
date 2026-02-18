/**
 * Auth event audit logging.
 * Issue #1339, Epic #1322 (JWT Auth).
 *
 * Logs authentication events to the existing `audit_log` table (migration 034).
 * Uses actor_type='system', action='auth', entity_type for the event name,
 * and metadata for IP/email/family_id.
 *
 * Never stores raw tokens, secrets, or full email addresses — only
 * SHA-256 hashed emails and masked forms.
 *
 * @module auth/audit
 */
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

/** Supported auth audit event types. */
export type AuthAuditEvent = 'auth.magic_link_requested' | 'auth.token_consumed' | 'auth.token_refresh' | 'auth.token_revoked' | 'auth.refresh_reuse_detected';

/** Metadata attached to an audit log entry (varies by event type). */
export interface AuditMetadata {
  /** Masked email (e.g., "u***@example.com") for human readability. */
  masked_email?: string;
  /** Whether the operation succeeded. */
  success?: boolean;
  /** Refresh token family ID (for token lifecycle events). */
  family_id?: string;
  /** Reason for failure, if applicable. */
  reason?: string;
}

/**
 * Hashes an email address with SHA-256 for privacy-safe storage.
 * Returns a hex digest suitable for indexed lookups.
 */
export function hashEmail(email: string): string {
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

/**
 * Masks an email address for human-readable audit entries.
 * "user@example.com" → "u***@example.com"
 */
export function maskEmail(email: string): string {
  const atIdx = email.indexOf('@');
  if (atIdx <= 0) return '***';
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx);
  if (local.length <= 1) return `${local}***${domain}`;
  return `${local[0]}***${domain}`;
}

/**
 * Writes an auth audit event to the existing `audit_log` table (migration 034).
 *
 * Best-effort: catches and logs errors to avoid breaking auth flows.
 *
 * @param pool - Postgres connection pool
 * @param event - The audit event type
 * @param ip - The client IP address (may be null for server-initiated events)
 * @param email - The user's email address (hashed for actor_id, masked in metadata)
 * @param metadata - Additional event-specific metadata
 */
export async function logAuthEvent(pool: Pool, event: AuthAuditEvent, ip: string | null, email: string | null, metadata: AuditMetadata = {}): Promise<void> {
  const actor_id = email ? hashEmail(email) : null;

  // Include masked email and IP in metadata
  const fullMetadata: Record<string, unknown> = { ...metadata };
  if (email && !fullMetadata.masked_email) {
    fullMetadata.masked_email = maskEmail(email);
  }
  if (ip) {
    fullMetadata.ip = ip;
  }

  try {
    await pool.query(
      `INSERT INTO audit_log (actor_type, actor_id, action, entity_type, metadata)
       VALUES ('system', $1, 'auth', $2, $3)`,
      [actor_id, event, JSON.stringify(fullMetadata)],
    );
  } catch (err) {
    // Best-effort: audit failures must not break auth flows
    console.error('[Auth Audit] Failed to write audit event:', event, err instanceof Error ? err.message : err);
  }
}
