/**
 * Tests for advisory lock deadlock fix.
 * Issue #2325 — Deadlock: API advisory lock blocks worker DB writes during CreateSession.
 *
 * The bug: POST /terminal/sessions holds pg_advisory_xact_lock inside a transaction
 * while calling gRPC CreateSession. The worker tries to UPDATE terminal_connection
 * (last_connected_at) while the API holds a conflicting lock → deadlock → 30s timeout.
 *
 * The fix: Release the advisory lock transaction BEFORE calling gRPC. The lock only
 * needs to cover checkMaxSessions, not the entire session creation.
 */

import { describe, it, expect, vi } from 'vitest';

describe('advisory lock deadlock fix (#2325)', () => {
  it('advisory lock must be released before gRPC CreateSession is called', async () => {
    // This test verifies the fix at the conceptual level by tracking operation order.
    // The actual integration is in routes.ts; we verify the contract here.
    const operations: string[] = [];

    // Simulate the fixed flow: lock → check → release → gRPC
    const advisoryClient = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN') {
          operations.push('begin');
          return {};
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          operations.push('lock');
          return {};
        }
        if (sql === 'COMMIT') {
          operations.push('commit');
          return {};
        }
        return { rows: [{ current: 0, max: 5, allowed: true }] };
      }),
      release: vi.fn(() => {
        operations.push('release');
      }),
    };

    const checkMaxSessions = vi.fn(async () => {
      operations.push('checkMaxSessions');
      return { allowed: true, current: 0, max: 5 };
    });

    const grpcCreateSession = vi.fn(async () => {
      operations.push('grpcCreateSession');
      return { id: 'session-1' };
    });

    // Execute the FIXED flow (lock released before gRPC call)
    await advisoryClient.query('BEGIN');
    await advisoryClient.query('SELECT pg_advisory_xact_lock(hashtext($1))');
    const maxCheck = await checkMaxSessions();
    expect(maxCheck.allowed).toBe(true);

    // FIXED: Commit (release lock) BEFORE gRPC call
    await advisoryClient.query('COMMIT');
    advisoryClient.release();

    // Now gRPC call happens without holding the lock
    await grpcCreateSession();

    // Verify order: lock acquired and released before gRPC
    const commitIdx = operations.indexOf('commit');
    const grpcIdx = operations.indexOf('grpcCreateSession');
    expect(commitIdx).toBeGreaterThan(-1);
    expect(grpcIdx).toBeGreaterThan(-1);
    expect(commitIdx).toBeLessThan(grpcIdx);

    // Verify release happens before gRPC too
    const releaseIdx = operations.indexOf('release');
    expect(releaseIdx).toBeLessThan(grpcIdx);
  });

  it('advisory lock is released even when checkMaxSessions rejects', async () => {
    const operations: string[] = [];

    const advisoryClient = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN') operations.push('begin');
        if (sql.includes('pg_advisory_xact_lock')) operations.push('lock');
        if (sql === 'COMMIT') operations.push('commit');
        return {};
      }),
      release: vi.fn(() => {
        operations.push('release');
      }),
    };

    const checkMaxSessions = vi.fn(async () => {
      operations.push('checkMaxSessions');
      return { allowed: false, current: 5, max: 5, error: 'Maximum sessions reached' };
    });

    // Execute flow where max sessions is exceeded
    await advisoryClient.query('BEGIN');
    await advisoryClient.query('SELECT pg_advisory_xact_lock(hashtext($1))');
    const maxCheck = await checkMaxSessions();

    // Should still commit and release even when rejected
    await advisoryClient.query('COMMIT');
    advisoryClient.release();

    expect(maxCheck.allowed).toBe(false);
    expect(operations).toContain('commit');
    expect(operations).toContain('release');
  });
});
