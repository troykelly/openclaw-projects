/**
 * API credential CRUD service.
 * Database operations for api_credential table with encryption at rest.
 * Part of API Onboarding feature (#1773).
 */

import type { Pool, PoolClient } from 'pg';
import type {
  ApiCredential,
  CredentialPurpose,
  CredentialResolveStrategy,
  CreateApiCredentialInput,
  UpdateApiCredentialInput,
} from './types.ts';
import {
  encryptCredentialReference,
  decryptCredentialReference,
  maskCredentialReference,
} from './credential-crypto.ts';

// ─── Audit logging for credential decryption ──────────────────────────────

/**
 * Log a credential decryption event to the audit trail.
 * Uses 'auth' action type (closest match in the audit_action_type enum)
 * with metadata indicating the actual operation was a decrypt.
 */
async function logCredentialDecrypt(pool: Queryable, credentialId: string, apiSourceId: string): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_log (actor_type, action, entity_type, entity_id, metadata)
       VALUES ('system'::audit_actor_type, 'auth'::audit_action_type, 'api_credential', $1, $2)`,
      [credentialId, JSON.stringify({ operation: 'decrypt', api_source_id: apiSourceId })],
    );
  } catch {
    // Audit logging should not block credential retrieval
  }
}

/** Queryable database connection — either a Pool or a PoolClient (for transactions). */
type Queryable = Pool | PoolClient;

// ─── Row mapper ──────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToApiCredential(row: any): ApiCredential {
  return {
    id: row.id,
    api_source_id: row.api_source_id,
    purpose: row.purpose as CredentialPurpose,
    header_name: row.header_name,
    header_prefix: row.header_prefix,
    resolve_strategy: row.resolve_strategy as CredentialResolveStrategy,
    resolve_reference: row.resolve_reference,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── CRUD operations ─────────────────────────────────────────────────────────

/**
 * Create a new API credential. The resolve_reference is encrypted before storage.
 */
export async function createApiCredential(
  pool: Queryable,
  input: CreateApiCredentialInput,
): Promise<ApiCredential> {
  // First insert with a placeholder to get the row ID, then update with encrypted value.
  // We need the ID for HKDF key derivation, so we use a two-step approach.
  const insertResult = await pool.query(
    `INSERT INTO api_credential (
      api_source_id, purpose, header_name, header_prefix,
      resolve_strategy, resolve_reference
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *`,
    [
      input.api_source_id,
      input.purpose ?? 'api_call',
      input.header_name,
      input.header_prefix ?? null,
      input.resolve_strategy,
      '__placeholder__', // temporary, will be updated with encrypted value
    ],
  );

  const row = insertResult.rows[0];
  const credentialId = row.id;

  // Encrypt and update
  const encrypted = encryptCredentialReference(input.resolve_reference, credentialId);
  await pool.query(
    `UPDATE api_credential SET resolve_reference = $1 WHERE id = $2`,
    [encrypted, credentialId],
  );

  return {
    ...rowToApiCredential(row),
    resolve_reference: input.resolve_reference, // Return plaintext to caller
  };
}

/**
 * Get a single API credential by ID.
 * @param decrypt - If true, returns decrypted resolve_reference. If false, returns masked value.
 */
export async function getApiCredential(
  pool: Queryable,
  id: string,
  apiSourceId: string,
  decrypt = false,
): Promise<ApiCredential | null> {
  const result = await pool.query(
    `SELECT * FROM api_credential WHERE id = $1 AND api_source_id = $2`,
    [id, apiSourceId],
  );

  if (result.rows.length === 0) return null;

  const cred = rowToApiCredential(result.rows[0]);

  if (decrypt) {
    cred.resolve_reference = decryptCredentialReference(cred.resolve_reference, cred.id);
    // Audit: log plaintext credential access (#1793)
    void logCredentialDecrypt(pool, cred.id, apiSourceId);
  } else {
    cred.resolve_reference = maskCredentialReference(
      decryptCredentialReference(cred.resolve_reference, cred.id),
    );
  }

  return cred;
}

/**
 * List credentials for an API source.
 * @param decrypt - If true, returns decrypted values. If false, returns masked values.
 */
export async function listApiCredentials(
  pool: Queryable,
  apiSourceId: string,
  decrypt = false,
): Promise<ApiCredential[]> {
  const result = await pool.query(
    `SELECT * FROM api_credential
     WHERE api_source_id = $1
     ORDER BY created_at ASC`,
    [apiSourceId],
  );

  return result.rows.map((row) => {
    const cred = rowToApiCredential(row);

    if (decrypt) {
      cred.resolve_reference = decryptCredentialReference(cred.resolve_reference, cred.id);
      // Audit: log plaintext credential access (#1793)
      void logCredentialDecrypt(pool, cred.id, apiSourceId);
    } else {
      cred.resolve_reference = maskCredentialReference(
        decryptCredentialReference(cred.resolve_reference, cred.id),
      );
    }

    return cred;
  });
}

/**
 * Update an API credential. Re-encrypts resolve_reference if provided.
 */
export async function updateApiCredential(
  pool: Queryable,
  id: string,
  apiSourceId: string,
  updates: UpdateApiCredentialInput,
): Promise<ApiCredential | null> {
  const FIELD_MAP: Record<string, string> = {
    purpose: 'purpose',
    header_name: 'header_name',
    header_prefix: 'header_prefix',
    resolve_strategy: 'resolve_strategy',
  };

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  for (const [key, dbCol] of Object.entries(FIELD_MAP)) {
    if (key in updates) {
      const val = (updates as Record<string, unknown>)[key];
      setClauses.push(`${dbCol} = $${paramIdx}`);
      values.push(val);
      paramIdx++;
    }
  }

  // Handle resolve_reference separately (needs encryption)
  if (updates.resolve_reference !== undefined) {
    const encrypted = encryptCredentialReference(updates.resolve_reference, id);
    setClauses.push(`resolve_reference = $${paramIdx}`);
    values.push(encrypted);
    paramIdx++;
  }

  if (setClauses.length === 0) return null;

  setClauses.push('updated_at = now()');
  values.push(id, apiSourceId);

  const result = await pool.query(
    `UPDATE api_credential SET ${setClauses.join(', ')}
     WHERE id = $${paramIdx} AND api_source_id = $${paramIdx + 1}
     RETURNING *`,
    values,
  );

  if (result.rows.length === 0) return null;

  const cred = rowToApiCredential(result.rows[0]);

  // Return with decrypted reference
  cred.resolve_reference = decryptCredentialReference(cred.resolve_reference, cred.id);

  return cred;
}

/**
 * Delete an API credential (hard delete).
 */
export async function deleteApiCredential(
  pool: Queryable,
  id: string,
  apiSourceId: string,
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM api_credential WHERE id = $1 AND api_source_id = $2 RETURNING id`,
    [id, apiSourceId],
  );
  return result.rowCount !== null && result.rowCount > 0;
}
