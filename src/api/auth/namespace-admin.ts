import type { AuthIdentity } from './middleware.ts';

/**
 * Verify the caller has admin-level (readwrite) access in the given namespace.
 *
 * Trusted system credentials (M2M tokens carrying `api:full` scope) bypass
 * the DB check entirely — they have full namespace control.
 *
 * For all other callers (users, M2M without `api:full`), a `readwrite`
 * namespace_grant row is required.
 *
 * Returns `null` if authorized, or an error message string if denied.
 *
 * Issue #2364 — Epic #2345.
 */
export async function requireNamespaceAdmin(
  identity: AuthIdentity,
  namespace: string,
  pool: { query: (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
): Promise<string | null> {
  // Trusted system credential (OpenClaw gateway) — full namespace control
  if (identity.type === 'm2m' && identity.scopes?.includes('api:full')) {
    return null;
  }

  const email = identity.email;
  const accessResult = await pool.query(
    `SELECT access FROM namespace_grant WHERE email = $1 AND namespace = $2`,
    [email, namespace],
  );
  if (accessResult.rows.length === 0) {
    return 'No access to namespace';
  }
  const callerAccess = accessResult.rows[0].access as string;
  if (callerAccess !== 'readwrite') {
    return 'Requires readwrite access to manage grants';
  }
  return null;
}
