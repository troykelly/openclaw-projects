import { createHash, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';

/**
 * Checks if authentication is disabled via environment variable.
 * This should only be used in development/testing.
 */
export function isAuthDisabled(): boolean {
  const disabled = process.env.OPENCLAW_PROJECTS_AUTH_DISABLED;
  if (disabled === 'true' || disabled === '1') {
    return true;
  }
  return false;
}

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
  /** Issuer claim (present on M2M tokens). */
  iss?: string;
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
const M2M_TOKEN_TTL_SECONDS = 100 * 365.25 * 24 * 60 * 60; // ~100 years
const CLOCK_TOLERANCE_SECONDS = 30;
const MIN_SECRET_BYTES = 32;
const M2M_ISSUER = 'openclaw-projects';

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

  const builder = new SignJWT(claims)
    .setProtectedHeader({ alg: ALG, kid })
    .setSubject(email)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .setJti(randomUUID());

  // M2M tokens must always include the issuer claim
  if (type === 'm2m') {
    builder.setIssuer(M2M_ISSUER);
  }

  return builder.sign(encodeSecret(secret));
}

/**
 * Signs a long-lived M2M (machine-to-machine) JWT.
 *
 * These tokens are used by services like the OpenClaw gateway to authenticate
 * API requests. They have a ~100 year TTL (effectively non-expiring) and include
 * an issuer claim of 'openclaw-projects'.
 *
 * @param serviceId - Identifier for the M2M client (e.g. 'openclaw-gateway').
 * @param scopes - OAuth-style scopes (e.g. ['api:full']).
 * @returns Compact JWS string.
 */
export async function signM2MToken(
  serviceId: string,
  scopes: string[],
): Promise<string> {
  const secret = process.env.JWT_SECRET;
  requireSecret(secret);

  const kid = deriveKid(secret);

  const claims: Record<string, unknown> = { type: 'm2m' as const };
  if (scopes.length > 0) {
    claims.scope = scopes.join(' ');
  }

  return new SignJWT(claims)
    .setProtectedHeader({ alg: ALG, kid })
    .setSubject(serviceId)
    .setIssuer(M2M_ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${Math.floor(M2M_TOKEN_TTL_SECONDS)}s`)
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
 * Verifies a token against a specific secret and validates required claims.
 */
async function verifyWith(token: string, secret: string): Promise<JwtPayload> {
  const { payload, protectedHeader } = await jwtVerify(
    token,
    encodeSecret(secret),
    {
      algorithms: [ALG],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ['sub', 'iat', 'exp', 'jti'],
    },
  );

  const raw = payload as Record<string, unknown>;
  const tokenType = raw.type;
  if (tokenType !== 'user' && tokenType !== 'm2m') {
    throw new Error(`[JWT] Invalid token type: ${String(tokenType)}`);
  }

  if (typeof protectedHeader.kid !== 'string') {
    throw new Error('[JWT] Missing kid in token header');
  }

  // Enforce issuer on M2M tokens
  if (tokenType === 'm2m' && payload.iss !== M2M_ISSUER) {
    throw new Error(`[JWT] M2M token has invalid issuer: ${String(payload.iss)}`);
  }

  return {
    sub: payload.sub!,
    type: tokenType,
    iat: payload.iat!,
    exp: payload.exp!,
    jti: payload.jti!,
    kid: protectedHeader.kid,
    ...(typeof raw.scope === 'string' ? { scope: raw.scope } : {}),
    ...(typeof payload.iss === 'string' ? { iss: payload.iss } : {}),
  } satisfies JwtPayload;
}

/** Returns true if the error is a jose signature verification failure. */
function isSignatureError(err: unknown): boolean {
  return (
    err instanceof joseErrors.JWSSignatureVerificationFailed ||
    (err instanceof Error && err.message.includes('signature verification failed'))
  );
}
