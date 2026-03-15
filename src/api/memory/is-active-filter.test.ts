/**
 * Service-level tests for is_active filter consistency (Issues #2590, #2591).
 *
 * Verifies that listMemories filters out is_active=false memories,
 * aligning behavior with digestMemories (which already checks is_active).
 * This inconsistency caused memory_list to show memories that memory_digest
 * could not find, confusing users into thinking digest was broken.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Pool } from 'pg';
import { createMemory, listMemories, cleanupExpiredMemories } from './service.ts';
import { createTestPool, truncateAllTables } from '../../../tests/helpers/db.ts';

describe('listMemories is_active filter (#2590)', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createTestPool();
    await truncateAllTables(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it('excludes is_active=false memories from default list', async () => {
    const ns = 'test-is-active-filter';

    await createMemory(pool, {
      namespace: ns,
      title: 'Active Memory',
      content: 'This should appear in list results active filter test',
    });

    await createMemory(pool, {
      namespace: ns,
      title: 'Expired Memory',
      content: 'This should NOT appear after deactivation filter test',
      expires_at: new Date('2020-01-01T00:00:00Z'),
    });

    // Reap expired -> sets is_active=false
    const reaped = await cleanupExpiredMemories(pool, { namespaces: [ns] });
    expect(reaped).toBe(1);

    const result = await listMemories(pool, { queryNamespaces: [ns] });
    expect(result.total).toBe(1);
    expect(result.memories[0].title).toBe('Active Memory');
  });

  it('include_superseded=true returns all including deactivated', async () => {
    const ns = 'test-include-deactivated';

    await createMemory(pool, {
      namespace: ns,
      title: 'Active Memory',
      content: 'Content for active memory include deactivated test',
    });

    await createMemory(pool, {
      namespace: ns,
      title: 'Expired Memory',
      content: 'Content for reaped memory include deactivated test',
      expires_at: new Date('2020-01-01T00:00:00Z'),
    });

    await cleanupExpiredMemories(pool, { namespaces: [ns] });

    // include_superseded disables the superseded_by and is_active filters
    const result = await listMemories(pool, {
      queryNamespaces: [ns],
      include_superseded: true,
      include_expired: true,
    });
    expect(result.total).toBe(2);
  });

  it('include_expired=true shows soft-deleted expired memories', async () => {
    const ns = 'test-include-expired-reaped';

    await createMemory(pool, {
      namespace: ns,
      title: 'Active Memory',
      content: 'Content for active memory expired reaped test',
    });

    await createMemory(pool, {
      namespace: ns,
      title: 'Expired and Reaped',
      content: 'Content for expired reaped memory test',
      expires_at: new Date('2020-01-01T00:00:00Z'),
    });

    await cleanupExpiredMemories(pool, { namespaces: [ns] });

    // include_expired=true should show soft-deleted expired memories
    // even with include_superseded=false (default)
    const result = await listMemories(pool, {
      queryNamespaces: [ns],
      include_expired: true,
    });
    // Both active and the expired-reaped (is_active=false) should appear
    expect(result.total).toBe(2);
  });
});
