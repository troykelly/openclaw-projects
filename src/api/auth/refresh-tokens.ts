/**
 * Refresh token storage with family-based rotation and reuse detection.
 * Issue #1324, Epic #1322 (JWT Auth).
 *
 * Tokens are random 32-byte base64url strings. Only the SHA-256 hash is
 * persisted — the raw token is returned to the caller exactly once.
 *
 * Family-based rotation: every token belongs to a `family_id`. When a
 * consumed token is reused outside its 10-second grace window, the entire
 * family is revoked (compromise indicator).
 *
 * @module auth/refresh-tokens
 */
import { randomBytes, createHash } from 'node:crypto';
import type { Pool } from 'pg';

/** How long a refresh token is valid (7 days in milliseconds). */
const TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** Grace window after rotation where the previous token is still accepted (seconds). */
const GRACE_WINDOW_SECONDS = 10;

/**
 * Hashes a raw token with SHA-256 and returns the hex digest.
 * This is the value stored in `token_sha256`.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Generates a cryptographically random 32-byte base64url token.
 */
function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Creates a new refresh token for the given email.
 *
 * @param pool - Postgres connection pool
 * @param email - The user's email address
 * @param familyId - Optional family ID to join; omit to start a new family
 * @returns The raw token (return to client), the row ID, and the family ID
 */
export async function createRefreshToken(
  pool: Pool,
  email: string,
  familyId?: string,
): Promise<{ token: string; id: string; familyId: string }> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS);

  // If no familyId provided, Postgres will generate one via gen_random_uuid()
  const result = await pool.query<{ id: string; family_id: string }>(
    `INSERT INTO auth_refresh_token (token_sha256, email, family_id, expires_at)
     VALUES ($1, $2, COALESCE($3::uuid, gen_random_uuid()), $4)
     RETURNING id, family_id`,
    [tokenHash, email, familyId ?? null, expiresAt],
  );

  const row = result.rows[0];
  return { token, id: row.id, familyId: row.family_id };
}

/**
 * Consumes (validates and marks used) a refresh token.
 *
 * Uses `SELECT ... FOR UPDATE` inside a transaction to prevent concurrent
 * double-spend. On success, sets `grace_expires_at` so the previous token
 * remains valid for a short window (handles in-flight duplicate requests).
 *
 * Reuse detection: if a token that has already been consumed (has a non-null
 * `replaced_by` or `grace_expires_at`) is presented **after** the grace window,
 * the entire token family is revoked.
 *
 * @param pool - Postgres connection pool
 * @param token - The raw refresh token string
 * @returns The associated email, family ID, and token row ID
 * @throws Error if the token is unknown, expired, revoked, or reused
 */
export async function consumeRefreshToken(
  pool: Pool,
  token: string,
): Promise<{ email: string; familyId: string; tokenId: string }> {
  const tokenHash = hashToken(token);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock the row to prevent concurrent consumption
    const result = await client.query<{
      id: string;
      email: string;
      family_id: string;
      expires_at: Date;
      revoked_at: Date | null;
      replaced_by: string | null;
      grace_expires_at: Date | null;
    }>(
      `SELECT id, email, family_id, expires_at, revoked_at, replaced_by, grace_expires_at
       FROM auth_refresh_token
       WHERE token_sha256 = $1
       FOR UPDATE`,
      [tokenHash],
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new Error('Unknown refresh token');
    }

    const row = result.rows[0];

    // Check revocation
    if (row.revoked_at) {
      await client.query('ROLLBACK');
      throw new Error('Refresh token has been revoked');
    }

    // Check expiration
    if (new Date(row.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      throw new Error('Refresh token has expired');
    }

    // Check if this token was already consumed (has grace_expires_at set)
    if (row.grace_expires_at) {
      const graceExpiry = new Date(row.grace_expires_at);

      if (graceExpiry > new Date()) {
        // Within grace window — allow the reuse
        await client.query('COMMIT');
        return { email: row.email, familyId: row.family_id, tokenId: row.id };
      }

      // Outside grace window — reuse detected! Revoke the entire family.
      await client.query(
        `UPDATE auth_refresh_token
         SET revoked_at = now()
         WHERE family_id = $1 AND revoked_at IS NULL`,
        [row.family_id],
      );
      await client.query('COMMIT');
      throw new Error('Refresh token reuse detected — family revoked');
    }

    // First consumption — set grace window
    await client.query(
      `UPDATE auth_refresh_token
       SET grace_expires_at = now() + interval '${GRACE_WINDOW_SECONDS} seconds'
       WHERE id = $1`,
      [row.id],
    );

    await client.query('COMMIT');
    return { email: row.email, familyId: row.family_id, tokenId: row.id };
  } catch (err) {
    // Rollback only if we haven't already committed/rolled back
    try {
      await client.query('ROLLBACK');
    } catch {
      // Already committed or rolled back
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Revokes all refresh tokens in a token family.
 *
 * Called when reuse is detected or when the user explicitly logs out.
 *
 * @param pool - Postgres connection pool
 * @param familyId - The token family UUID to revoke
 */
export async function revokeTokenFamily(pool: Pool, familyId: string): Promise<void> {
  await pool.query(
    `UPDATE auth_refresh_token
     SET revoked_at = now()
     WHERE family_id = $1 AND revoked_at IS NULL`,
    [familyId],
  );
}
