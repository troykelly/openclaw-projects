/**
 * Tests for namespace scoping in unified search.
 * Verifies that search results are returned regardless of user_email
 * (user_email scoping removed in Epic #1418 Phase 4; namespace scoping
 * is handled at the route level, not the service level).
 *
 * Originally part of Issue #1216 review fix, updated for #1418.
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
  const aliceEmail = `alice-${testToken}@example.com`;
  const bobEmail = `bob-${testToken}@example.com`;
  const uniqueWord = `xyzscoping${testToken.replace(/-/g, '')}`;

  beforeEach(async () => {
    pool = createTestPool();
    await truncateAllTables(pool);

    // Insert work items for two different users using a unique word for reliable text search
    await pool.query(
      `INSERT INTO work_item (title, description, kind, work_item_kind, user_email, status)
       VALUES
         ($1, 'Buy groceries for the week', 'task', 'task', $3, 'open'),
         ($2, 'Plan the new feature', 'project', 'project', $3, 'active'),
         ($4, 'Pick up dry cleaning', 'task', 'task', $5, 'open'),
         ($6, 'Fix the login button', 'issue', 'issue', $5, 'in_progress')`,
      [
        `Alice ${uniqueWord} list`,   // $1
        `Alice ${uniqueWord} project`, // $2
        aliceEmail,                     // $3
        `Bob ${uniqueWord} list`,      // $4
        bobEmail,                       // $5
        `Bob ${uniqueWord} fix`,       // $6
      ],
    );
  });

  afterEach(async () => {
    await pool.end();
  });

  it('should return all matching work items regardless of user_email (scoping removed in Phase 4)', async () => {
    // user_email is accepted but no longer used for filtering at the service level
    const result = await unifiedSearch(pool, {
      query: uniqueWord,
      types: ['work_item'],
      user_email: aliceEmail,
      semantic: false,
    });

    const titles = result.results.map((r) => r.title);
    // Should find items from BOTH users since user_email scoping is removed
    expect(titles.length).toBeGreaterThanOrEqual(2);
    const hasAlice = titles.some((t) => t.includes('Alice'));
    const hasBob = titles.some((t) => t.includes('Bob'));
    expect(hasAlice).toBe(true);
    expect(hasBob).toBe(true);
  });

  it('should return all work items when user_email is not specified', async () => {
    const result = await unifiedSearch(pool, {
      query: uniqueWord,
      types: ['work_item'],
      semantic: false,
    });

    // Should find items from both users
    const titles = result.results.map((r) => r.title);
    const hasAlice = titles.some((t) => t.includes('Alice'));
    const hasBob = titles.some((t) => t.includes('Bob'));
    expect(hasAlice).toBe(true);
    expect(hasBob).toBe(true);
  });

  it('should return matching results even for unknown user_email', async () => {
    // Since user_email is no longer used for filtering, unknown emails return all results
    const result = await unifiedSearch(pool, {
      query: uniqueWord,
      types: ['work_item'],
      user_email: `nobody-${testToken}@example.com`,
      semantic: false,
    });

    expect(result.results.length).toBeGreaterThanOrEqual(1);
  });
});
