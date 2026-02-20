/**
 * Tests for namespace scoping in unified search.
 * Verifies that search results are scoped by namespace (Epic #1418 Phase 4).
 *
 * Originally part of Issue #1216 review fix, updated for #1418, cleaned up in #1525.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Pool } from 'pg';
import { createTestPool, truncateAllTables } from '../../../tests/helpers/db.ts';
import { unifiedSearch } from './service.ts';
import { randomUUID } from 'crypto';

describe('Search scoping (Epic #1418)', () => {
  let pool: Pool;

  // Use unique tokens per test run to avoid cross-test interference
  const testToken = randomUUID().slice(0, 8);
  const aliceNs = `alice-${testToken}`;
  const bobNs = `bob-${testToken}`;
  const uniqueWord = `xyzscoping${testToken.replace(/-/g, '')}`;

  beforeEach(async () => {
    pool = createTestPool();
    await truncateAllTables(pool);

    // Insert work items for two different namespaces using a unique word for reliable text search
    await pool.query(
      `INSERT INTO work_item (title, description, kind, work_item_kind, namespace, status)
       VALUES
         ($1, 'Buy groceries for the week', 'task', 'task', $3, 'open'),
         ($2, 'Plan the new feature', 'project', 'project', $3, 'active'),
         ($4, 'Pick up dry cleaning', 'task', 'task', $5, 'open'),
         ($6, 'Fix the login button', 'issue', 'issue', $5, 'in_progress')`,
      [
        `Alice ${uniqueWord} list`,   // $1
        `Alice ${uniqueWord} project`, // $2
        aliceNs,                        // $3
        `Bob ${uniqueWord} list`,      // $4
        bobNs,                          // $5
        `Bob ${uniqueWord} fix`,       // $6
      ],
    );
  });

  afterEach(async () => {
    await pool.end();
  });

  it('should return work items from all queried namespaces', async () => {
    const result = await unifiedSearch(pool, {
      query: uniqueWord,
      types: ['work_item'],
      queryNamespaces: [aliceNs, bobNs],
      semantic: false,
    });

    const titles = result.results.map((r) => r.title);
    expect(titles.length).toBeGreaterThanOrEqual(2);
    const hasAlice = titles.some((t) => t.includes('Alice'));
    const hasBob = titles.some((t) => t.includes('Bob'));
    expect(hasAlice).toBe(true);
    expect(hasBob).toBe(true);
  });

  it('should scope results to a single namespace when only one is queried', async () => {
    const result = await unifiedSearch(pool, {
      query: uniqueWord,
      types: ['work_item'],
      queryNamespaces: [aliceNs],
      semantic: false,
    });

    const titles = result.results.map((r) => r.title);
    const hasAlice = titles.some((t) => t.includes('Alice'));
    const hasBob = titles.some((t) => t.includes('Bob'));
    expect(hasAlice).toBe(true);
    expect(hasBob).toBe(false);
  });
});
