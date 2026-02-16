import { createHash, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';

import { isAuthDisabled } from './secret.ts';

/** JWT payload returned by verifyAccessToken. */
export interface JwtPayload {
  /** Subject — the user's email address or M2M identifier. */
  sub: string;
  /** Token type: 'user' for interactive sessions, 'm2m' for machine-to-machine. */
  type: 'user' | 'm2m';
  /** Issued-at timestamp (seconds since epoch). */
  iat: number;
  /** Expiration timestamp (seconds since epoch). */
  exp: number;
  /** Unique token identifier (UUID v4). */
  jti: string;
  /** Key ID — identifies which secret signed this token. */
  kid: string;
  /** Space-delimited scopes (optional, mainly for M2M tokens). */
  scope?: string;
}

/** Options for signAccessToken. */
export interface SignOptions {
  /** Token type. Defaults to 'user'. */
  type?: 'user' | 'm2m';
  /** OAuth-style scopes. Encoded as a space-delimited string in the token. */
  scopes?: string[];
}

const ALG = 'HS256' as const;
const TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
const CLOCK_TOLERANCE_SECONDS = 30;
const MIN_SECRET_BYTES = 32;

/**
 * Derives a short, deterministic key ID from a secret.
 * Uses SHA-256 of the first 8 bytes, truncated to 8 hex characters.
 */
function deriveKid(secret: string): string {
  const hash = createHash('sha256')
    .update(secret.slice(0, 8))
    .digest('hex');
  return hash.slice(0, 8);
}

/** Encodes a secret string into a Uint8Array for jose. */
function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/**
 * Validates that a secret meets the minimum length requirement.
 * Throws if the secret is missing or too short.
 */
function requireSecret(secret: string | undefined): asserts secret is string {
  if (!secret || secret.trim().length === 0) {
    throw new Error(
      '[JWT] JWT_SECRET is not set. ' +
        'Set the JWT_SECRET environment variable (minimum 32 bytes). ' +
        'For development, set OPENCLAW_PROJECTS_AUTH_DISABLED=true to skip auth checks.',
    );
  }
  if (Buffer.byteLength(secret, 'utf-8') < MIN_SECRET_BYTES) {
    throw new Error(
      `[JWT] JWT_SECRET must be at least ${MIN_SECRET_BYTES} bytes. ` +
        `Current length: ${Buffer.byteLength(secret, 'utf-8')} bytes.`,
    );
  }
}

/**
 * Signs a short-lived HS256 access token.
 *
 * The token contains `sub` (email), `type`, `iat`, `exp` (15 min), `jti` (UUID),
 * and a `kid` header for key-rotation support.
 *
 * @param email - The subject (user email or M2M identifier).
 * @param options - Optional type and scopes.
 * @returns Compact JWS string.
 */
export async function signAccessToken(
  email: string,
  options?: SignOptions,
): Promise<string> {
  const secret = process.env.JWT_SECRET;
  requireSecret(secret);

  const kid = deriveKid(secret);
  const type = options?.type ?? 'user';

  const claims: Record<string, unknown> = { type };
  if (options?.scopes && options.scopes.length > 0) {
    claims.scope = options.scopes.join(' '); // space-delimited per RFC 8693
  }

  return new SignJWT(claims)
    .setProtectedHeader({ alg: ALG, kid })
    .setSubject(email)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .setJti(randomUUID())
    .sign(encodeSecret(secret));
}

/**
 * Verifies an HS256 access token and returns its payload.
 *
 * Supports key rotation: tries the primary secret first (`JWT_SECRET`),
 * then falls back to `JWT_SECRET_PREVIOUS` if set and the primary fails
 * with a signature-verification error.
 *
 * @param token - Compact JWS string.
 * @returns Verified JWT payload.
 * @throws If the token is invalid, expired (beyond clock skew), or not signed by a known key.
 */
export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  const primary = process.env.JWT_SECRET;
  const previous = process.env.JWT_SECRET_PREVIOUS;

  if (!primary && !isAuthDisabled()) {
    throw new Error('[JWT] JWT_SECRET is not set.');
  }

  // Try primary key first
  if (primary) {
    try {
      return await verifyWith(token, primary);
    } catch (err) {
      // If we have a fallback key and the error is signature-related, try that
      if (previous && isSignatureError(err)) {
        return verifyWith(token, previous);
      }
      throw err;
    }
  }

  // No primary, try previous if available
  if (previous) {
    return verifyWith(token, previous);
  }

  throw new Error('[JWT] No JWT secret configured for verification.');
}

/**
 * Verifies a token against a specific secret.
 */
async function verifyWith(token: string, secret: string): Promise<JwtPayload> {
  const { payload, protectedHeader } = await jwtVerify(
    token,
    encodeSecret(secret),
    {
      algorithms: [ALG],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    },
  );

  return {
    sub: payload.sub as string,
    type: (payload as Record<string, unknown>).type as 'user' | 'm2m',
    iat: payload.iat as number,
    exp: payload.exp as number,
    jti: payload.jti as string,
    kid: protectedHeader.kid as string,
    ...(payload.scope ? { scope: payload.scope as string } : {}),
  } satisfies JwtPayload;
}

/** Returns true if the error is a jose signature verification failure. */
function isSignatureError(err: unknown): boolean {
  return (
    err instanceof joseErrors.JWSSignatureVerificationFailed ||
    (err instanceof Error && err.message.includes('signature verification failed'))
  );
}
