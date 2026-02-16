import type { FastifyRequest } from 'fastify';

import { isAuthDisabled, verifyAccessToken, type JwtPayload } from './jwt.ts';

/** Represents an authenticated identity extracted from a JWT. */
export interface AuthIdentity {
  /** The user's email address or M2M service identifier. */
  email: string;
  /** Token type: 'user' for interactive sessions, 'm2m' for machine-to-machine. */
  type: 'user' | 'm2m';
  /** Space-delimited scopes parsed into an array (optional, mainly for M2M tokens). */
  scopes?: string[];
}

/**
 * Extracts an authenticated identity from the request.
 *
 * Checks (in order):
 * 1. E2E bypass: if `isAuthDisabled()` AND `OPENCLAW_E2E_SESSION_EMAIL` is set, returns a synthetic user identity.
 * 2. `Authorization: Bearer <jwt>` header: verifies the JWT and returns the identity.
 *
 * @returns The authenticated identity, or `null` if no valid credentials are present.
 */
export async function getAuthIdentity(req: FastifyRequest): Promise<AuthIdentity | null> {
  // E2E bypass: requires both auth disabled AND the explicit session email env var
  const e2eEmail = process.env.OPENCLAW_E2E_SESSION_EMAIL;
  if (e2eEmail && isAuthDisabled()) {
    return { email: e2eEmail, type: 'user' };
  }

  // Extract JWT from Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7); // Remove 'Bearer ' prefix
  if (!token) {
    return null;
  }

  try {
    const payload: JwtPayload = await verifyAccessToken(token);
    const identity: AuthIdentity = {
      email: payload.sub,
      type: payload.type,
    };
    if (payload.scope) {
      identity.scopes = payload.scope.split(' ');
    }
    return identity;
  } catch {
    // Invalid/expired token
    return null;
  }
}

/**
 * Convenience wrapper: extracts just the email from the auth identity.
 *
 * @returns The authenticated user's email, or `null` if unauthenticated.
 */
export async function getSessionEmail(req: FastifyRequest): Promise<string | null> {
  const identity = await getAuthIdentity(req);
  return identity?.email ?? null;
}

/**
 * Resolves the effective user_email for a request, enforcing principal binding.
 *
 * - **M2M tokens**: returns `requestedEmail` (agents may operate on any user's data).
 * - **User tokens**: always returns the authenticated user's own email, ignoring
 *   whatever `requestedEmail` was supplied in query/body/header.
 * - **Auth disabled** (dev/test): returns `requestedEmail` as-is (no identity to bind).
 *
 * @param req - The Fastify request (used to extract the JWT identity).
 * @param requestedEmail - The `user_email` value from query, body, or header.
 * @returns The effective user email to use for data access.
 */
export async function resolveUserEmail(
  req: FastifyRequest,
  requestedEmail: string | undefined | null,
): Promise<string | null> {
  if (isAuthDisabled()) {
    return requestedEmail?.trim() || null;
  }

  const identity = await getAuthIdentity(req);
  if (!identity) {
    return null;
  }

  if (identity.type === 'm2m') {
    return requestedEmail?.trim() || null;
  }

  // User tokens: always use the authenticated identity's email
  return identity.email;
}
