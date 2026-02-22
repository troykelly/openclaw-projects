import type { FastifyRequest } from 'fastify';
import type { Pool } from 'pg';

import { isAuthDisabled, verifyAccessToken, type JwtPayload } from './jwt.ts';
import { IdentityCache } from './identity-cache.ts';

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
  /** Contact ID linked to this user via user_setting.contact_id (#1580). */
  contactId?: string;
}

/** Resolved human identity from email → contact_endpoint → contact → user_setting chain (#1580). */
export interface ResolvedHuman {
  /** user_setting email (the auth identity). */
  email: string;
  /** Contact ID linked via user_setting.contact_id (null if not linked). */
  contactId: string | null;
}

/**
 * Identity resolution cache (#1580).
 * Maps login email → ResolvedHuman with 60s TTL.
 */
const identityCache = new IdentityCache<ResolvedHuman>(60_000);

// Prune expired entries every 5 minutes
setInterval(() => identityCache.prune(), 300_000).unref();

/**
 * Invalidate cached identity for a given email.
 * Call when user_setting, contact_endpoint, or namespace_grant changes.
 */
export function invalidateIdentityCache(email: string): void {
  identityCache.invalidate(email);
}

/** Clear the entire identity cache (for testing). */
export function clearIdentityCache(): void {
  identityCache.clear();
}

/**
 * Resolve a human identity from a login email (#1580).
 *
 * Tries two paths in parallel for timing safety:
 * 1. Primary: email → contact_endpoint (default ns, login_eligible) → contact → user_setting
 * 2. Bootstrap: email → user_setting.email directly
 *
 * Returns the first successful match (primary preferred).
 */
export async function resolveHumanByEmail(
  email: string,
  pool: Pool,
): Promise<ResolvedHuman | null> {
  // Check cache first
  const cached = identityCache.get(email);
  if (cached) return cached;

  const normalizedEmail = email.toLowerCase();

  // Run both paths in parallel for timing safety (prevents email enumeration)
  const [primaryResult, bootstrapResult] = await Promise.all([
    // Primary: contact_endpoint → contact → user_setting
    pool.query<{ email: string; contact_id: string | null }>(
      `SELECT us.email, us.contact_id::text as contact_id
       FROM contact_endpoint ce
       JOIN contact c ON c.id = ce.contact_id AND c.namespace = 'default'
       JOIN user_setting us ON us.contact_id = c.id
       WHERE ce.endpoint_type = 'email'
         AND ce.normalized_value = $1
         AND ce.is_login_eligible = true
       LIMIT 1`,
      [normalizedEmail],
    ),
    // Bootstrap: direct user_setting.email match
    pool.query<{ email: string; contact_id: string | null }>(
      `SELECT email, contact_id::text as contact_id
       FROM user_setting
       WHERE email = $1
       LIMIT 1`,
      [normalizedEmail],
    ),
  ]);

  // Prefer primary path (contact-endpoint-based)
  const row = primaryResult.rows[0] ?? bootstrapResult.rows[0];
  if (!row) return null;

  const resolved: ResolvedHuman = {
    email: row.email,
    contactId: row.contact_id,
  };

  identityCache.set(normalizedEmail, resolved);
  return resolved;
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
// Namespace resolution (Issue #1475) + Access enforcement (#1485, #1571)
// ============================================================

/** Valid namespace access levels: read (view only) or readwrite (full CRUD). */
export type NamespaceAccess = 'read' | 'readwrite';

/**
 * @deprecated Use NamespaceAccess instead. Kept for backward compatibility during migration.
 */
export type NamespaceRole = NamespaceAccess;

/** Namespace context resolved for a request. */
export interface NamespaceContext {
  /** Single namespace for write operations. */
  storeNamespace: string;
  /** Namespace list for read operations (may include multiple for cross-namespace queries). */
  queryNamespaces: string[];
  /** Whether the token is M2M (agents can operate across namespaces). */
  isM2M: boolean;
  /** Map of namespace → access level for the authenticated user. Empty for M2M/auth-disabled. */
  roles: Record<string, NamespaceAccess>;
}

/**
 * Checks that the user has at least the required access level for the given namespace.
 *
 * - **M2M tokens**: always allowed (no access restriction).
 * - **Auth disabled**: always allowed.
 * - **User tokens**: 'readwrite' satisfies any requirement; 'read' only satisfies 'read'.
 *
 * @throws {RoleError} if the user's access is insufficient.
 */
export function requireMinRole(
  req: FastifyRequest,
  namespace: string,
  minRole: NamespaceAccess,
): void {
  const ctx = req.namespaceContext;
  if (!ctx) return; // No namespace context = auth disabled or no grants (handled elsewhere)
  if (ctx.isM2M) return; // M2M tokens bypass access checks

  const userAccess = ctx.roles[namespace];
  if (!userAccess) {
    throw new RoleError('No access to namespace');
  }

  // 'readwrite' satisfies any requirement; 'read' only satisfies 'read'
  if (minRole === 'readwrite' && userAccess === 'read') {
    throw new RoleError(
      `Requires readwrite access (current: ${userAccess})`,
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
 * Extracts the requested namespace from the request (singular).
 * Checks (in priority order): X-Namespace header, ?namespace= query, body.namespace.
 * Used for store operations that target a single namespace.
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
 * Extracts requested namespaces (plural) from the request.
 * Issue #1534: Supports multi-namespace queries for M2M tokens.
 *
 * Checks (in priority order):
 * 1. X-Namespaces header (comma-separated)
 * 2. X-Namespace header (single)
 * 3. ?namespaces= query param (comma-separated)
 * 4. ?namespace= query param (single)
 * 5. body.namespaces array
 * 6. body.namespace string (single)
 *
 * @returns Array of namespace strings (empty if none specified).
 */
/** Max namespaces per multi-namespace request */
const MAX_NAMESPACES_PER_REQUEST = 20;
/** Max length per namespace name */
const MAX_NAMESPACE_NAME_LENGTH = 63;
/** Valid namespace name pattern: lowercase alphanumeric, dots, hyphens, underscores; starts with letter or digit */
const NAMESPACE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Validate and filter a raw namespace list: apply pattern, length, and count limits.
 */
function validateNamespaceList(raw: string[]): string[] {
  return raw
    .filter((ns) => ns.length > 0 && ns.length <= MAX_NAMESPACE_NAME_LENGTH && NAMESPACE_NAME_PATTERN.test(ns))
    .slice(0, MAX_NAMESPACES_PER_REQUEST);
}

export function extractRequestedNamespaces(req: FastifyRequest): string[] {
  let raw: string[] = [];

  // 1. X-Namespaces header (comma-separated)
  const multiHeader = req.headers['x-namespaces'];
  if (typeof multiHeader === 'string' && multiHeader.length > 0) {
    raw = multiHeader.split(',').map((s) => s.trim()).filter(Boolean);
  }

  // 2. X-Namespace header (single)
  if (raw.length === 0) {
    const singleHeader = req.headers['x-namespace'];
    if (typeof singleHeader === 'string' && singleHeader.length > 0) {
      raw = [singleHeader.trim()];
    }
  }

  if (raw.length === 0) {
    const q = req.query as Record<string, unknown> | undefined;

    // 3. ?namespaces= query param (comma-separated)
    if (q && typeof q.namespaces === 'string' && q.namespaces.length > 0) {
      raw = q.namespaces.split(',').map((s) => s.trim()).filter(Boolean);
    }

    // 4. ?namespace= query param (single)
    if (raw.length === 0 && q && typeof q.namespace === 'string' && q.namespace.length > 0) {
      raw = [q.namespace.trim()];
    }
  }

  if (raw.length === 0) {
    const b = req.body as Record<string, unknown> | undefined | null;
    if (b && typeof b === 'object') {
      // 5. body.namespaces array
      if (Array.isArray(b.namespaces) && b.namespaces.length > 0) {
        raw = (b.namespaces as unknown[]).filter(
          (v): v is string => typeof v === 'string' && v.length > 0,
        );
      }

      // 6. body.namespace string (single)
      if (raw.length === 0 && typeof b.namespace === 'string' && b.namespace.length > 0) {
        raw = [b.namespace.trim()];
      }
    }
  }

  return validateNamespaceList(raw);
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
    // Auth-disabled mode bypasses all role enforcement. Set isM2M=true so
    // that requireMinRole always skips checks — there are no grants to
    // validate against and no reason to block operations in dev/test.
    return { storeNamespace: requested, queryNamespaces: [requested], isM2M: true, roles: {} };
  }

  const identity = await getAuthIdentity(req);
  if (!identity) {
    return null;
  }

  if (identity.type === 'm2m') {
    // Issue #1534: M2M tokens support multi-namespace queries
    const requestedMulti = extractRequestedNamespaces(req);
    if (requestedMulti.length > 0) {
      return {
        storeNamespace: requestedMulti[0],
        queryNamespaces: requestedMulti,
        isM2M: true,
        roles: {},
      };
    }
    // Fallback: single namespace from extractRequestedNamespace (backward compat)
    const ns = requested || 'default';
    return { storeNamespace: ns, queryNamespaces: [ns], isM2M: true, roles: {} };
  }

  // User token: load grants
  const grants = await pool.query<{
    namespace: string;
    access: string;
    is_home: boolean;
  }>(
    `SELECT namespace, access, is_home
     FROM namespace_grant
     WHERE email = $1
     ORDER BY namespace`,
    [identity.email],
  );

  if (grants.rows.length === 0) {
    return null; // No grants = no access (design doc 12.3)
  }

  const allNamespaces = grants.rows.map((r) => r.namespace);
  const defaultGrant = grants.rows.find((r) => r.is_home);

  // Build namespace → access map
  const roles: Record<string, NamespaceAccess> = {};
  for (const row of grants.rows) {
    roles[row.namespace] = row.access as NamespaceAccess;
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
