/**
 * Cross-namespace entity validation for terminal resources.
 *
 * Issue #2191, Sub-item 1 — Block cross-namespace credential/proxy attachment.
 *
 * When a connection references a credential_id or proxy_jump_id, both entities
 * must belong to the same namespace. This prevents a user in namespace A from
 * attaching a credential owned by namespace B.
 */

import type { Pool } from 'pg';

/** Result of namespace consistency validation. */
export interface NamespaceValidationResult {
  valid: boolean;
  error?: string;
}

/** Human-readable entity descriptions for error messages. */
const ENTITY_LABELS: Record<string, string> = {
  terminal_credential: 'credential',
  terminal_connection: 'proxy',
};

/**
 * Validate that a referenced entity belongs to the expected namespace.
 *
 * @param pool - Database pool
 * @param table - Table name of the referenced entity
 * @param entityId - UUID of the referenced entity
 * @param expectedNamespace - Namespace the entity must belong to
 * @returns Validation result with error message if invalid
 */
export async function validateNamespaceConsistency(
  pool: Pool,
  table: string,
  entityId: string,
  expectedNamespace: string,
): Promise<NamespaceValidationResult> {
  const result = await pool.query<{ namespace: string }>(
    `SELECT namespace FROM "${table}" WHERE id = $1`,
    [entityId],
  );

  if (result.rows.length === 0) {
    return { valid: false, error: 'Referenced entity not found' };
  }

  const entityNamespace = result.rows[0].namespace;
  if (entityNamespace !== expectedNamespace) {
    const label = ENTITY_LABELS[table] ?? 'entity';
    return {
      valid: false,
      error: `Cross-namespace ${label} attachment is not allowed`,
    };
  }

  return { valid: true };
}
