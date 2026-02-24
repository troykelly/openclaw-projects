/**
 * Credential resolution module — public API.
 *
 * Resolves terminal_credential rows by kind:
 * - 'ssh_key' / 'password': Decrypts the encrypted_value column using envelope encryption
 * - 'command': Executes an external command to retrieve the credential at runtime
 *
 * Credential values are held in memory only and never persisted in plaintext.
 */

import type { Pool } from 'pg';
import { decryptCredential, parseEncryptionKey } from './envelope.ts';
import { resolveCommandCredential } from './command-provider.ts';

export { encryptCredential, decryptCredential, parseEncryptionKey } from './envelope.ts';
export {
  resolveCommandCredential,
  clearCredentialCache,
} from './command-provider.ts';

/** Resolved credential — the decrypted value ready for use. */
export interface ResolvedCredential {
  kind: 'ssh_key' | 'password' | 'command';
  /** Decrypted private key or password value. */
  value: string;
  /** SSH key fingerprint, if available. */
  fingerprint: string | null;
  /** Public key, if available (safe to log/display). */
  publicKey: string | null;
}

/** Database row shape from terminal_credential. */
interface CredentialRow {
  id: string;
  kind: string;
  encrypted_value: Buffer | null;
  command: string | null;
  command_timeout_s: number;
  cache_ttl_s: number;
  fingerprint: string | null;
  public_key: string | null;
}

/**
 * Resolve a credential by ID — fetches from DB and decrypts/executes as needed.
 *
 * @param pool - Database connection pool
 * @param credentialId - UUID of the terminal_credential row
 * @param masterKeyHex - 64-char hex master encryption key
 * @returns The resolved credential with decrypted value
 * @throws Error if credential not found, kind is unknown, or decryption fails
 */
export async function resolveCredential(
  pool: Pool,
  credentialId: string,
  masterKeyHex: string,
): Promise<ResolvedCredential> {
  const result = await pool.query<CredentialRow>(
    `SELECT id, kind, encrypted_value, command, command_timeout_s,
            cache_ttl_s, fingerprint, public_key
     FROM terminal_credential
     WHERE id = $1 AND deleted_at IS NULL`,
    [credentialId],
  );

  if (result.rows.length === 0) {
    throw new Error(`Credential not found: ${credentialId}`);
  }

  const row = result.rows[0];

  switch (row.kind) {
    case 'ssh_key':
    case 'password': {
      if (!row.encrypted_value) {
        throw new Error(
          `Credential ${credentialId} (${row.kind}) has no encrypted_value`,
        );
      }

      const masterKey = parseEncryptionKey(masterKeyHex);
      const value = decryptCredential(row.encrypted_value, masterKey, row.id);

      return {
        kind: row.kind,
        value,
        fingerprint: row.fingerprint,
        publicKey: row.public_key,
      };
    }

    case 'command': {
      if (!row.command) {
        throw new Error(
          `Credential ${credentialId} (command) has no command configured`,
        );
      }

      const value = await resolveCommandCredential(
        row.id,
        row.command,
        row.command_timeout_s * 1000,
        row.cache_ttl_s,
      );

      return {
        kind: 'command',
        value,
        fingerprint: row.fingerprint,
        publicKey: row.public_key,
      };
    }

    default:
      throw new Error(
        `Unknown credential kind: ${row.kind} for credential ${credentialId}`,
      );
  }
}
