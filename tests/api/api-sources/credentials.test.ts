/**
 * Integration tests for API credential CRUD service.
 * Part of API Onboarding feature (#1773).
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi, afterEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, truncateAllTables } from '../../helpers/db.ts';
import { runMigrate } from '../../helpers/migrate.ts';
import { createApiSource } from '../../../src/api/api-sources/service.ts';
import {
  createApiCredential,
  getApiCredential,
  listApiCredentials,
  updateApiCredential,
  deleteApiCredential,
} from '../../../src/api/api-sources/credential-service.ts';

const TEST_KEY_HEX = 'b'.repeat(64);

describe('API Credential CRUD Service', () => {
  let pool: Pool;
  let sourceId: string;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    vi.stubEnv('OAUTH_TOKEN_ENCRYPTION_KEY', TEST_KEY_HEX);
    await truncateAllTables(pool);

    // Create a parent api_source for credential tests
    const source = await createApiSource(pool, {
      name: 'Test API',
      namespace: 'default',
    });
    sourceId = source.id;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('createApiCredential', () => {
    it('creates and returns credential with plaintext resolve_reference', async () => {
      const cred = await createApiCredential(pool, {
        api_source_id: sourceId,
        header_name: 'Authorization',
        header_prefix: 'Bearer',
        resolve_strategy: 'literal',
        resolve_reference: 'sk-secret-key-1234567890abcdef',
      });

      expect(cred.id).toBeDefined();
      expect(cred.api_source_id).toBe(sourceId);
      expect(cred.header_name).toBe('Authorization');
      expect(cred.header_prefix).toBe('Bearer');
      expect(cred.resolve_strategy).toBe('literal');
      expect(cred.resolve_reference).toBe('sk-secret-key-1234567890abcdef');
      expect(cred.purpose).toBe('api_call');
    });

    it('stores encrypted value in database', async () => {
      const cred = await createApiCredential(pool, {
        api_source_id: sourceId,
        header_name: 'X-API-Key',
        resolve_strategy: 'literal',
        resolve_reference: 'my-secret-api-key-value',
      });

      // Check the raw database value is encrypted
      const raw = await pool.query(
        'SELECT resolve_reference FROM api_credential WHERE id = $1',
        [cred.id],
      );
      expect(raw.rows[0].resolve_reference).not.toBe('my-secret-api-key-value');
    });

    it('supports spec_fetch purpose', async () => {
      const cred = await createApiCredential(pool, {
        api_source_id: sourceId,
        purpose: 'spec_fetch',
        header_name: 'Authorization',
        resolve_strategy: 'env',
        resolve_reference: 'API_TOKEN',
      });

      expect(cred.purpose).toBe('spec_fetch');
    });
  });

  describe('getApiCredential', () => {
    it('returns masked value by default', async () => {
      const cred = await createApiCredential(pool, {
        api_source_id: sourceId,
        header_name: 'Authorization',
        resolve_strategy: 'literal',
        resolve_reference: 'sk-secret-key-1234567890abcdef',
      });

      const found = await getApiCredential(pool, cred.id, sourceId);
      expect(found).not.toBeNull();
      expect(found!.resolve_reference).toBe('sk-secret-key-1***');
      expect(found!.resolve_reference).not.toBe('sk-secret-key-1234567890abcdef');
    });

    it('returns decrypted value when decrypt=true', async () => {
      const cred = await createApiCredential(pool, {
        api_source_id: sourceId,
        header_name: 'Authorization',
        resolve_strategy: 'literal',
        resolve_reference: 'sk-secret-key-1234567890abcdef',
      });

      const found = await getApiCredential(pool, cred.id, sourceId, true);
      expect(found).not.toBeNull();
      expect(found!.resolve_reference).toBe('sk-secret-key-1234567890abcdef');
    });

    it('returns null for non-existent ID', async () => {
      const found = await getApiCredential(
        pool,
        '00000000-0000-0000-0000-000000000000',
        sourceId,
      );
      expect(found).toBeNull();
    });

    it('returns null for wrong source ID', async () => {
      const cred = await createApiCredential(pool, {
        api_source_id: sourceId,
        header_name: 'Authorization',
        resolve_strategy: 'literal',
        resolve_reference: 'secret',
      });

      const found = await getApiCredential(
        pool,
        cred.id,
        '00000000-0000-0000-0000-000000000000',
      );
      expect(found).toBeNull();
    });
  });

  describe('listApiCredentials', () => {
    it('returns masked values by default', async () => {
      await createApiCredential(pool, {
        api_source_id: sourceId,
        header_name: 'Authorization',
        resolve_strategy: 'literal',
        resolve_reference: 'long-secret-key-that-is-more-than-twenty-chars',
      });
      await createApiCredential(pool, {
        api_source_id: sourceId,
        header_name: 'X-API-Key',
        resolve_strategy: 'env',
        resolve_reference: 'short',
      });

      const list = await listApiCredentials(pool, sourceId);
      expect(list).toHaveLength(2);

      // Long key should show first 15 chars + ***
      const authCred = list.find((c) => c.header_name === 'Authorization');
      expect(authCred!.resolve_reference).toBe('long-secret-key***');

      // Short key should be all ***
      const apiKeyCred = list.find((c) => c.header_name === 'X-API-Key');
      expect(apiKeyCred!.resolve_reference).toBe('***');
    });

    it('returns decrypted values when decrypt=true', async () => {
      await createApiCredential(pool, {
        api_source_id: sourceId,
        header_name: 'Authorization',
        resolve_strategy: 'literal',
        resolve_reference: 'my-full-secret-value',
      });

      const list = await listApiCredentials(pool, sourceId, true);
      expect(list).toHaveLength(1);
      expect(list[0].resolve_reference).toBe('my-full-secret-value');
    });

    it('returns empty array for unknown source', async () => {
      const list = await listApiCredentials(pool, '00000000-0000-0000-0000-000000000000');
      expect(list).toEqual([]);
    });
  });

  describe('updateApiCredential', () => {
    it('re-encrypts resolve_reference on update', async () => {
      const cred = await createApiCredential(pool, {
        api_source_id: sourceId,
        header_name: 'Authorization',
        resolve_strategy: 'literal',
        resolve_reference: 'original-secret',
      });

      const updated = await updateApiCredential(pool, cred.id, sourceId, {
        resolve_reference: 'new-secret-value-that-is-long-enough',
      });

      expect(updated).not.toBeNull();
      expect(updated!.resolve_reference).toBe('new-secret-value-that-is-long-enough');

      // Verify stored value is encrypted
      const raw = await pool.query(
        'SELECT resolve_reference FROM api_credential WHERE id = $1',
        [cred.id],
      );
      expect(raw.rows[0].resolve_reference).not.toBe('new-secret-value-that-is-long-enough');
    });

    it('updates header_name and strategy without changing reference', async () => {
      const cred = await createApiCredential(pool, {
        api_source_id: sourceId,
        header_name: 'Authorization',
        resolve_strategy: 'literal',
        resolve_reference: 'keep-this-secret-value-unchanged',
      });

      const updated = await updateApiCredential(pool, cred.id, sourceId, {
        header_name: 'X-Custom-Header',
        resolve_strategy: 'env',
      });

      expect(updated).not.toBeNull();
      expect(updated!.header_name).toBe('X-Custom-Header');
      expect(updated!.resolve_strategy).toBe('env');
      // resolve_reference should still decrypt to original
      expect(updated!.resolve_reference).toBe('keep-this-secret-value-unchanged');
    });

    it('returns null for non-existent credential', async () => {
      const result = await updateApiCredential(
        pool,
        '00000000-0000-0000-0000-000000000000',
        sourceId,
        { header_name: 'Nope' },
      );
      expect(result).toBeNull();
    });

    it('returns null when no fields provided', async () => {
      const cred = await createApiCredential(pool, {
        api_source_id: sourceId,
        header_name: 'Auth',
        resolve_strategy: 'literal',
        resolve_reference: 'secret',
      });
      const result = await updateApiCredential(pool, cred.id, sourceId, {});
      expect(result).toBeNull();
    });
  });

  describe('deleteApiCredential', () => {
    it('hard deletes a credential', async () => {
      const cred = await createApiCredential(pool, {
        api_source_id: sourceId,
        header_name: 'Authorization',
        resolve_strategy: 'literal',
        resolve_reference: 'secret',
      });

      const deleted = await deleteApiCredential(pool, cred.id, sourceId);
      expect(deleted).toBe(true);

      // Verify it's gone
      const raw = await pool.query(
        'SELECT * FROM api_credential WHERE id = $1',
        [cred.id],
      );
      expect(raw.rows).toHaveLength(0);
    });

    it('returns false for non-existent credential', async () => {
      const result = await deleteApiCredential(
        pool,
        '00000000-0000-0000-0000-000000000000',
        sourceId,
      );
      expect(result).toBe(false);
    });
  });

  describe('audit log redaction', () => {
    it('stores [REDACTED] for resolve_reference in audit log on create', async () => {
      const cred = await createApiCredential(pool, {
        api_source_id: sourceId,
        header_name: 'Authorization',
        resolve_strategy: 'literal',
        resolve_reference: 'super-secret-value',
      });

      const audit = await pool.query(
        `SELECT changes FROM audit_log
         WHERE entity_type = 'api_credential' AND entity_id = $1 AND action = 'create'
         ORDER BY id DESC LIMIT 1`,
        [cred.id],
      );

      expect(audit.rows.length).toBeGreaterThan(0);
      const changes = audit.rows[0].changes;
      // The audit trigger redacts resolve_reference in both new objects
      expect(changes.new.resolve_reference).toBe('[REDACTED]');
    });
  });
});
