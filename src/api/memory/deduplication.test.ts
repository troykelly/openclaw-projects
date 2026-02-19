/**
 * Memory deduplication tests
 * Issue #1143, updated for Epic #1418 (namespace scoping replaces user_email)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Pool } from 'pg';
import { createMemory } from './service.ts';
import { createTestPool, truncateAllTables } from '../../../tests/helpers/db.ts';

describe('Memory deduplication', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createTestPool();
    await truncateAllTables(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it('should not create duplicate when same content is stored twice', async () => {
    const content = 'User prefers notifications via email';
    const title = 'Email preference';

    // Store first memory
    const memory1 = await createMemory(pool, {
      title,
      content,
      memory_type: 'preference',
    });

    expect(memory1).toBeDefined();
    expect(memory1.id).toBeDefined();

    // Attempt to store identical content
    const memory2 = await createMemory(pool, {
      title,
      content,
      memory_type: 'preference',
    });

    // Should return the existing memory, not create a new one
    expect(memory2.id).toBe(memory1.id);

    // Verify only one memory exists with this content
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM memory WHERE TRIM(content) = $1`,
      [content],
    );
    expect(parseInt(result.rows[0].count, 10)).toBe(1);
  });

  it('should normalize whitespace when checking for duplicates', async () => {
    const content1 = '  User prefers notifications via email  ';
    const content2 = 'User prefers notifications via email';

    const memory1 = await createMemory(pool, {
      title: 'Email preference',
      content: content1,
      memory_type: 'preference',
    });

    const memory2 = await createMemory(pool, {
      title: 'Email preference',
      content: content2,
      memory_type: 'preference',
    });

    // Should deduplicate despite whitespace differences
    expect(memory2.id).toBe(memory1.id);
  });

  it('should create separate memories when content is different', async () => {
    const memory1 = await createMemory(pool, {
      title: 'Email preference',
      content: 'User prefers notifications via email',
      memory_type: 'preference',
    });

    const memory2 = await createMemory(pool, {
      title: 'SMS preference',
      content: 'User prefers notifications via SMS',
      memory_type: 'preference',
    });

    // Should create different memories
    expect(memory2.id).not.toBe(memory1.id);

    // Verify two memories exist
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM memory WHERE namespace = 'default'`,
    );
    expect(parseInt(result.rows[0].count, 10)).toBe(2);
  });

  it('should deduplicate within same scope', async () => {
    const content = 'Important fact';

    const memory1 = await createMemory(pool, {
      title: 'Fact 1',
      content,
      memory_type: 'fact',
    });

    const memory2 = await createMemory(pool, {
      title: 'Fact 1',
      content,
      memory_type: 'fact',
    });

    expect(memory2.id).toBe(memory1.id);
  });

  it('should create separate memories for different namespaces with same content', async () => {
    const content = 'Shared preference';

    const memory1 = await createMemory(pool, {
      title: 'Preference',
      content,
      memory_type: 'preference',
      namespace: 'ns-one',
    });

    const memory2 = await createMemory(pool, {
      title: 'Preference',
      content,
      memory_type: 'preference',
      namespace: 'ns-two',
    });

    // Different namespaces should have separate memories
    expect(memory2.id).not.toBe(memory1.id);
  });

  it('should update timestamp when duplicate is attempted', async () => {
    const content = 'Time-sensitive note';

    const memory1 = await createMemory(pool, {
      title: 'Note',
      content,
      memory_type: 'note',
    });

    const originalUpdatedAt = memory1.updated_at;

    // Wait a bit to ensure timestamp difference
    await new Promise((resolve) => setTimeout(resolve, 100));

    const memory2 = await createMemory(pool, {
      title: 'Note',
      content,
      memory_type: 'note',
    });

    expect(memory2.id).toBe(memory1.id);
    expect(new Date(memory2.updated_at).getTime()).toBeGreaterThan(new Date(originalUpdatedAt).getTime());
  });
});
