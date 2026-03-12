/**
 * Namespace isolation integration tests — Issue #2436
 * Verifies that by-ID memory operations enforce namespace isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Pool } from 'pg';
import { createMemory, getMemory, updateMemory, deleteMemory, supersedeMemory } from './service.ts';
import { createTestPool, truncateAllTables } from '../../../tests/helpers/db.ts';

describe('Memory namespace isolation', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createTestPool();
    await truncateAllTables(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it('getMemory returns memory when namespace matches', async () => {
    const memory = await createMemory(pool, {
      title: 'Test',
      content: 'Test content',
      namespace: 'ns-a',
    });

    const found = await getMemory(pool, memory.id, ['ns-a']);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(memory.id);
  });

  it('getMemory returns null when namespace does not match', async () => {
    const memory = await createMemory(pool, {
      title: 'Test',
      content: 'Test content',
      namespace: 'ns-a',
    });

    const found = await getMemory(pool, memory.id, ['ns-b']);
    expect(found).toBeNull();
  });

  it('getMemory works without namespace filter (backwards compatible)', async () => {
    const memory = await createMemory(pool, {
      title: 'Test',
      content: 'Test content',
      namespace: 'ns-a',
    });

    const found = await getMemory(pool, memory.id);
    expect(found).not.toBeNull();
  });

  it('updateMemory returns null for wrong namespace', async () => {
    const memory = await createMemory(pool, {
      title: 'Test',
      content: 'Test content',
      namespace: 'ns-a',
    });

    const updated = await updateMemory(pool, memory.id, { title: 'Changed' }, ['ns-b']);
    expect(updated).toBeNull();

    // Verify the memory was not actually updated
    const unchanged = await getMemory(pool, memory.id);
    expect(unchanged!.title).toBe('Test');
  });

  it('updateMemory succeeds for matching namespace', async () => {
    const memory = await createMemory(pool, {
      title: 'Test',
      content: 'Test content',
      namespace: 'ns-a',
    });

    const updated = await updateMemory(pool, memory.id, { title: 'Changed' }, ['ns-a']);
    expect(updated).not.toBeNull();
    expect(updated!.title).toBe('Changed');
  });

  it('deleteMemory returns false for wrong namespace', async () => {
    const memory = await createMemory(pool, {
      title: 'Test',
      content: 'Test content',
      namespace: 'ns-a',
    });

    const deleted = await deleteMemory(pool, memory.id, ['ns-b']);
    expect(deleted).toBe(false);

    // Verify the memory still exists
    const still = await getMemory(pool, memory.id);
    expect(still).not.toBeNull();
  });

  it('deleteMemory succeeds for matching namespace', async () => {
    const memory = await createMemory(pool, {
      title: 'Test',
      content: 'Test content',
      namespace: 'ns-a',
    });

    const deleted = await deleteMemory(pool, memory.id, ['ns-a']);
    expect(deleted).toBe(true);
  });

  it('supersedeMemory returns null for wrong namespace', async () => {
    const memory = await createMemory(pool, {
      title: 'Test',
      content: 'Test content',
      namespace: 'ns-a',
    });

    const result = await supersedeMemory(pool, memory.id, {
      title: 'New',
      content: 'New content',
      namespace: 'ns-a',
    }, ['ns-b']);

    expect(result).toBeNull();
  });

  it('supersedeMemory succeeds for matching namespace and sets is_active=false', async () => {
    const memory = await createMemory(pool, {
      title: 'Test',
      content: 'Test content',
      namespace: 'ns-a',
    });

    const newMemory = await supersedeMemory(pool, memory.id, {
      title: 'New',
      content: 'New content',
      namespace: 'ns-a',
    }, ['ns-a']);

    expect(newMemory).not.toBeNull();

    // Old memory should be inactive
    const old = await getMemory(pool, memory.id);
    expect(old!.is_active).toBe(false);
    expect(old!.superseded_by).toBe(newMemory!.id);
  });

  it('getMemory supports multiple namespaces', async () => {
    const memory = await createMemory(pool, {
      title: 'Test',
      content: 'Test content',
      namespace: 'ns-b',
    });

    const found = await getMemory(pool, memory.id, ['ns-a', 'ns-b', 'ns-c']);
    expect(found).not.toBeNull();
  });
});
