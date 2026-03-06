/**
 * Webhook token hashing using HMAC-SHA-256 with per-token salt.
 * Issue #2189: Credential Security Hardening.
 *
 * Tokens are hashed at creation time. The plaintext is returned once to the
 * user and never stored. On verification, the bearer token is re-hashed with
 * the stored salt and compared using constant-time equality.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Generate a cryptographically random salt for webhook token hashing.
 * @returns A base64url-encoded 16-byte salt.
 */
export function generateWebhookSalt(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * Hash a webhook token using HMAC-SHA-256 with a per-token salt.
 *
 * The HMAC key is `secret`, the message is `salt + ":" + token`.
 * This ensures each token+salt combination produces a unique hash, and
 * the server-side secret prevents offline brute-force even if DB is leaked.
 *
 * @param token - The plaintext webhook bearer token.
 * @param salt - The per-token salt (stored alongside the hash in DB).
 * @param secret - The server-side HMAC secret (from env/config).
 * @returns Hex-encoded HMAC-SHA-256 digest.
 */
export function hashWebhookToken(
  token: string,
  salt: string,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`${salt}:${token}`)
    .digest('hex');
}

/**
 * Verify a webhook bearer token against a stored hash + salt.
 * Uses constant-time comparison to prevent timing attacks.
 *
 * @param token - The plaintext bearer token from the request.
 * @param storedHash - The hex-encoded hash stored in the database.
 * @param salt - The per-token salt stored in the database.
 * @param secret - The server-side HMAC secret.
 * @returns True if the token matches.
 */
export function verifyWebhookToken(
  token: string,
  storedHash: string,
  salt: string,
  secret: string,
): boolean {
  const candidateHash = hashWebhookToken(token, salt, secret);

  // Ensure both buffers have the same length before timingSafeEqual
  const candidateBuf = Buffer.from(candidateHash, 'hex');
  const storedBuf = Buffer.from(storedHash, 'hex');

  if (candidateBuf.length !== storedBuf.length) {
    return false;
  }

  return timingSafeEqual(candidateBuf, storedBuf);
}
