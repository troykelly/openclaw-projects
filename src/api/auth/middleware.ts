import type { FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

import { isAuthDisabled, verifyAccessToken, type JwtPayload } from './jwt.ts';

// Augment Fastify request to include namespace context (set by preHandler hook)
declare module 'fastify' {
  interface FastifyRequest {
    namespaceContext: NamespaceContext | null;
  }
}

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
 * 1. `Authorization: Bearer <jwt>` header: verifies the JWT and returns the identity.
 * 2. E2E bypass: if `isAuthDisabled()` AND `OPENCLAW_E2E_SESSION_EMAIL` is set
 *    and no valid JWT was provided, returns a synthetic user identity.
 *
 * JWTs take precedence so that E2E tests can use per-user and M2M tokens
 * to exercise principal binding (Issue #1353).
 *
 * @returns The authenticated identity, or `null` if no valid credentials are present.
 */
export async function getAuthIdentity(req: FastifyRequest): Promise<AuthIdentity | null> {
  // Extract JWT from Authorization header (checked first so that E2E tests
  // can provide explicit per-user or M2M tokens — Issue #1353)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (token) {
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
        // Invalid/expired token — fall through to E2E bypass or null
      }
    }
  }

  // E2E bypass: requires both auth disabled AND the explicit session email env var.
  // Only used when no valid JWT was provided above.
  const e2eEmail = process.env.OPENCLAW_E2E_SESSION_EMAIL;
  if (e2eEmail && isAuthDisabled()) {
    return { email: e2eEmail, type: 'user' };
  }

  return null;
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

// ============================================================
// Namespace resolution (Issue #1475) + Role enforcement (#1485)
// ============================================================

/** Valid namespace roles, ordered from least to most privileged. */
export type NamespaceRole = 'observer' | 'member' | 'admin' | 'owner';

/** Role hierarchy: lower index = less privilege. */
const ROLE_HIERARCHY: readonly NamespaceRole[] = ['observer', 'member', 'admin', 'owner'] as const;

/** Namespace context resolved for a request. */
export interface NamespaceContext {
  /** Single namespace for write operations. */
  storeNamespace: string;
  /** Namespace list for read operations (may include multiple for cross-namespace queries). */
  queryNamespaces: string[];
  /** Whether the token is M2M (agents can operate across namespaces). */
  isM2M: boolean;
  /** Map of namespace → role for the authenticated user. Empty for M2M/auth-disabled. */
  roles: Record<string, NamespaceRole>;
}

/**
 * Checks that the user has at least `minRole` for the given namespace.
 *
 * - **M2M tokens**: always allowed (no role restriction).
 * - **Auth disabled**: always allowed.
 * - **User tokens**: compared against the role hierarchy.
 *
 * @throws {RoleError} if the user's role is insufficient.
 */
export function requireMinRole(
  req: FastifyRequest,
  namespace: string,
  minRole: NamespaceRole,
): void {
  const ctx = req.namespaceContext;
  if (!ctx) return; // No namespace context = auth disabled or no grants (handled elsewhere)
  if (ctx.isM2M) return; // M2M tokens bypass role checks

  const userRole = ctx.roles[namespace];
  if (!userRole) {
    throw new RoleError('No access to namespace');
  }

  const userLevel = ROLE_HIERARCHY.indexOf(userRole);
  const requiredLevel = ROLE_HIERARCHY.indexOf(minRole);
  if (userLevel < requiredLevel) {
    throw new RoleError(
      `Requires ${minRole} role or higher (current: ${userRole})`,
    );
  }
}

/**
 * Custom error for insufficient role. Route handlers catch this to return 403.
 */
export class RoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoleError';
  }
}

/**
 * Extracts the requested namespace from the request.
 * Checks (in priority order): X-Namespace header, ?namespace= query, body.namespace.
 */
function extractRequestedNamespace(req: FastifyRequest): string | undefined {
  const header = req.headers['x-namespace'];
  if (typeof header === 'string' && header.length > 0) return header;

  const q = req.query as Record<string, unknown> | undefined;
  if (q && typeof q.namespace === 'string' && q.namespace.length > 0) return q.namespace;

  const b = req.body as Record<string, unknown> | undefined | null;
  if (b && typeof b === 'object' && typeof b.namespace === 'string' && b.namespace.length > 0) {
    return b.namespace;
  }

  return undefined;
}

/**
 * Resolves namespace context for the current request.
 *
 * - **User tokens**: loads grants from namespace_grant, validates access to
 *   requested namespace (or picks the default/first-alphabetical grant).
 *   Per design doc 12.3: no grants → returns null (caller should 403).
 *
 * - **M2M tokens**: uses requested namespace or 'default'. No grant check.
 *
 * - **Auth disabled**: uses requested namespace or 'default'.
 *
 * @param req - The Fastify request.
 * @param pool - A pg Pool for querying namespace_grant.
 * @returns The resolved namespace context, or null if user has no grants.
 */
export async function resolveNamespaces(
  req: FastifyRequest,
  pool: Pool,
): Promise<NamespaceContext | null> {
  const requested = extractRequestedNamespace(req);

  if (isAuthDisabled()) {
    // Only create namespace context when explicitly requested.
    // Without this guard, every test request gets namespace filtering
    // which breaks test isolation (all test data has namespace='default').
    if (!requested) return null;
    return { storeNamespace: requested, queryNamespaces: [requested], isM2M: false, roles: {} };
  }

  const identity = await getAuthIdentity(req);
  if (!identity) {
    return null;
  }

  if (identity.type === 'm2m') {
    const ns = requested || 'default';
    return { storeNamespace: ns, queryNamespaces: [ns], isM2M: true, roles: {} };
  }

  // User token: load grants
  const grants = await pool.query<{
    namespace: string;
    role: string;
    is_default: boolean;
  }>(
    `SELECT namespace, role, is_default
     FROM namespace_grant
     WHERE email = $1
     ORDER BY namespace`,
    [identity.email],
  );

  if (grants.rows.length === 0) {
    return null; // No grants = no access (design doc 12.3)
  }

  const allNamespaces = grants.rows.map((r) => r.namespace);
  const defaultGrant = grants.rows.find((r) => r.is_default);

  // Build namespace → role map
  const roles: Record<string, NamespaceRole> = {};
  for (const row of grants.rows) {
    roles[row.namespace] = row.role as NamespaceRole;
  }

  // If a specific namespace was requested, verify user has access
  if (requested) {
    if (!allNamespaces.includes(requested)) {
      return null; // No grant for requested namespace
    }
    return {
      storeNamespace: requested,
      queryNamespaces: [requested],
      isM2M: false,
      roles,
    };
  }

  // No specific namespace requested: use default or first alphabetical
  const storeNamespace = defaultGrant?.namespace ?? allNamespaces[0];
  return {
    storeNamespace,
    queryNamespaces: allNamespaces,
    isM2M: false,
    roles,
  };
}
