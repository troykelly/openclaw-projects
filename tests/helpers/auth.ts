/**
 * JWT authentication helpers for integration tests.
 *
 * Uses the same JWT_SECRET set in tests/setup-api.ts to sign tokens
 * that the server's verifyAccessToken() will accept.
 */

import { SignJWT } from 'jose';
import { createHash, randomUUID } from 'node:crypto';

const TEST_JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-at-least-32-bytes!!';

/**
 * Sign a short-lived HS256 JWT for integration test authentication.
 * Mirrors the signAccessToken() shape in src/api/auth/jwt.ts.
 */
export async function signTestJwt(email: string = 'test@example.com'): Promise<string> {
  const secret = new TextEncoder().encode(TEST_JWT_SECRET);
  const kid = createHash('sha256')
    .update(TEST_JWT_SECRET.slice(0, 8))
    .digest('hex')
    .slice(0, 8);

  return new SignJWT({ type: 'user' })
    .setProtectedHeader({ alg: 'HS256', kid })
    .setSubject(email)
    .setIssuedAt()
    .setExpirationTime('15m')
    .setJti(randomUUID())
    .sign(secret);
}

/**
 * Build an Authorization header object for use with app.inject().
 *
 * Usage:
 *   const res = await app.inject({
 *     method: 'GET',
 *     url: '/app/work-items',
 *     headers: await getAuthHeaders('user@example.com'),
 *   });
 */
export async function getAuthHeaders(email: string = 'test@example.com'): Promise<Record<string, string>> {
  const token = await signTestJwt(email);
  return { authorization: `Bearer ${token}` };
}
