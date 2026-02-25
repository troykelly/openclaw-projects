/**
 * Integration tests for API source CRUD service.
 * Part of API Onboarding feature (#1772).
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, truncateAllTables } from '../../helpers/db.ts';
import { runMigrate } from '../../helpers/migrate.ts';
import {
  createApiSource,
  getApiSource,
  listApiSources,
  updateApiSource,
  softDeleteApiSource,
  restoreApiSource,
} from '../../../src/api/api-sources/service.ts';

describe('API Source CRUD Service', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  describe('createApiSource', () => {
    it('creates and returns an api source with generated id', async () => {
      const source = await createApiSource(pool, {
        name: 'Petstore API',
        description: 'A sample API for pets',
        spec_url: 'https://petstore.example.com/openapi.json',
        tags: ['pets', 'sample'],
      });

      expect(source.id).toBeDefined();
      expect(source.name).toBe('Petstore API');
      expect(source.description).toBe('A sample API for pets');
      expect(source.spec_url).toBe('https://petstore.example.com/openapi.json');
      expect(source.tags).toEqual(['pets', 'sample']);
      expect(source.namespace).toBe('default');
      expect(source.status).toBe('active');
      expect(source.deleted_at).toBeNull();
      expect(source.created_at).toBeInstanceOf(Date);
      expect(source.updated_at).toBeInstanceOf(Date);
    });

    it('respects custom namespace', async () => {
      const source = await createApiSource(pool, {
        name: 'Custom NS API',
        namespace: 'my-team',
      });

      expect(source.namespace).toBe('my-team');
    });

    it('stores servers as JSON', async () => {
      const servers = [{ url: 'https://api.example.com', description: 'Production' }];
      const source = await createApiSource(pool, {
        name: 'Server Test',
        servers,
      });

      expect(source.servers).toEqual(servers);
    });
  });

  describe('getApiSource', () => {
    it('retrieves by ID and namespace', async () => {
      const created = await createApiSource(pool, {
        name: 'Test Get',
        namespace: 'default',
      });

      const found = await getApiSource(pool, created.id, 'default');
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.name).toBe('Test Get');
    });

    it('returns null for non-existent ID', async () => {
      const found = await getApiSource(pool, '00000000-0000-0000-0000-000000000000', 'default');
      expect(found).toBeNull();
    });

    it('returns null for wrong namespace', async () => {
      const created = await createApiSource(pool, {
        name: 'NS Scoped',
        namespace: 'team-a',
      });

      const found = await getApiSource(pool, created.id, 'team-b');
      expect(found).toBeNull();
    });

    it('returns null for soft-deleted source', async () => {
      const created = await createApiSource(pool, { name: 'To Delete' });
      await softDeleteApiSource(pool, created.id, 'default');

      const found = await getApiSource(pool, created.id, 'default');
      expect(found).toBeNull();
    });
  });

  describe('listApiSources', () => {
    it('lists sources for a namespace, excluding soft-deleted', async () => {
      await createApiSource(pool, { name: 'Active 1', namespace: 'default' });
      await createApiSource(pool, { name: 'Active 2', namespace: 'default' });
      const deleted = await createApiSource(pool, { name: 'Deleted', namespace: 'default' });
      await softDeleteApiSource(pool, deleted.id, 'default');

      const list = await listApiSources(pool, 'default');
      expect(list).toHaveLength(2);
      expect(list.map((s) => s.name).sort()).toEqual(['Active 1', 'Active 2']);
    });

    it('scopes by namespace', async () => {
      await createApiSource(pool, { name: 'In A', namespace: 'ns-a' });
      await createApiSource(pool, { name: 'In B', namespace: 'ns-b' });

      const listA = await listApiSources(pool, 'ns-a');
      expect(listA).toHaveLength(1);
      expect(listA[0].name).toBe('In A');

      const listB = await listApiSources(pool, 'ns-b');
      expect(listB).toHaveLength(1);
      expect(listB[0].name).toBe('In B');
    });

    it('filters by status', async () => {
      await createApiSource(pool, { name: 'Active' });
      const errSource = await createApiSource(pool, { name: 'Errored' });
      await updateApiSource(pool, errSource.id, 'default', { status: 'error' });

      const active = await listApiSources(pool, 'default', { status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0].name).toBe('Active');

      const errored = await listApiSources(pool, 'default', { status: 'error' });
      expect(errored).toHaveLength(1);
      expect(errored[0].name).toBe('Errored');
    });

    it('respects limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        await createApiSource(pool, { name: `Source ${i}` });
      }

      const page1 = await listApiSources(pool, 'default', { limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);

      const page2 = await listApiSources(pool, 'default', { limit: 2, offset: 2 });
      expect(page2).toHaveLength(2);

      const page3 = await listApiSources(pool, 'default', { limit: 2, offset: 4 });
      expect(page3).toHaveLength(1);
    });
  });

  describe('updateApiSource', () => {
    it('updates name and tags', async () => {
      const created = await createApiSource(pool, {
        name: 'Original',
        tags: ['v1'],
      });

      const updated = await updateApiSource(pool, created.id, 'default', {
        name: 'Updated Name',
        tags: ['v2', 'stable'],
      });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated Name');
      expect(updated!.tags).toEqual(['v2', 'stable']);
      expect(updated!.updated_at.getTime()).toBeGreaterThanOrEqual(created.updated_at.getTime());
    });

    it('updates status and error_message', async () => {
      const created = await createApiSource(pool, { name: 'Status Test' });

      const updated = await updateApiSource(pool, created.id, 'default', {
        status: 'error',
        error_message: 'Failed to fetch spec',
      });

      expect(updated!.status).toBe('error');
      expect(updated!.error_message).toBe('Failed to fetch spec');
    });

    it('returns null for non-existent ID', async () => {
      const result = await updateApiSource(
        pool,
        '00000000-0000-0000-0000-000000000000',
        'default',
        { name: 'Nope' },
      );
      expect(result).toBeNull();
    });

    it('returns null for wrong namespace', async () => {
      const created = await createApiSource(pool, {
        name: 'NS Test',
        namespace: 'team-a',
      });

      const result = await updateApiSource(pool, created.id, 'team-b', {
        name: 'Should Fail',
      });
      expect(result).toBeNull();
    });

    it('returns null when no fields provided', async () => {
      const created = await createApiSource(pool, { name: 'No Update' });
      const result = await updateApiSource(pool, created.id, 'default', {});
      expect(result).toBeNull();
    });
  });

  describe('softDeleteApiSource', () => {
    it('sets deleted_at timestamp', async () => {
      const created = await createApiSource(pool, { name: 'To Soft Delete' });

      const deleted = await softDeleteApiSource(pool, created.id, 'default');
      expect(deleted).toBe(true);

      // Verify via direct query
      const raw = await pool.query(
        'SELECT deleted_at FROM api_source WHERE id = $1',
        [created.id],
      );
      expect(raw.rows[0].deleted_at).not.toBeNull();
    });

    it('returns false for non-existent ID', async () => {
      const result = await softDeleteApiSource(
        pool,
        '00000000-0000-0000-0000-000000000000',
        'default',
      );
      expect(result).toBe(false);
    });

    it('returns false if already deleted', async () => {
      const created = await createApiSource(pool, { name: 'Already Deleted' });
      await softDeleteApiSource(pool, created.id, 'default');

      const result = await softDeleteApiSource(pool, created.id, 'default');
      expect(result).toBe(false);
    });
  });

  describe('restoreApiSource', () => {
    it('clears deleted_at on soft-deleted source', async () => {
      const created = await createApiSource(pool, { name: 'To Restore' });
      await softDeleteApiSource(pool, created.id, 'default');

      const restored = await restoreApiSource(pool, created.id, 'default');
      expect(restored).not.toBeNull();
      expect(restored!.deleted_at).toBeNull();
      expect(restored!.name).toBe('To Restore');
    });

    it('returns null for non-deleted source', async () => {
      const created = await createApiSource(pool, { name: 'Not Deleted' });

      const result = await restoreApiSource(pool, created.id, 'default');
      expect(result).toBeNull();
    });

    it('returns null for wrong namespace', async () => {
      const created = await createApiSource(pool, {
        name: 'Wrong NS',
        namespace: 'team-a',
      });
      await softDeleteApiSource(pool, created.id, 'team-a');

      const result = await restoreApiSource(pool, created.id, 'team-b');
      expect(result).toBeNull();
    });
  });
});
