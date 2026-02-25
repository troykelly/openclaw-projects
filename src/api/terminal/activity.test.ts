/**
 * Unit tests for the activity recording module.
 *
 * Issue #1686 — Audit trail
 */

import { describe, it, expect, vi } from 'vitest';
import { recordActivity } from './activity.ts';

describe('recordActivity', () => {
  it('calls pool.query with correct parameters', () => {
    const queryFn = vi.fn().mockResolvedValue({ rows: [] });
    const fakePool = { query: queryFn } as unknown as import('pg').Pool;

    recordActivity(fakePool, {
      namespace: 'default',
      session_id: 'sess-123',
      actor: 'agent-1',
      action: 'session.create',
      detail: { reason: 'test' },
    });

    // Fire-and-forget: query is called but we don't await
    expect(queryFn).toHaveBeenCalledOnce();
    const [sql, params] = queryFn.mock.calls[0];
    expect(sql).toContain('INSERT INTO terminal_activity');
    expect(params).toEqual([
      'default',
      'sess-123',
      null, // connection_id not provided
      'agent-1',
      'session.create',
      JSON.stringify({ reason: 'test' }),
    ]);
  });

  it('does not throw when pool.query rejects', async () => {
    const queryFn = vi.fn().mockRejectedValue(new Error('DB down'));
    const fakePool = { query: queryFn } as unknown as import('pg').Pool;

    // Should not throw
    recordActivity(fakePool, {
      namespace: 'default',
      actor: 'test',
      action: 'test.action',
    });

    // Wait for the promise to resolve
    await new Promise((r) => setTimeout(r, 10));
    expect(queryFn).toHaveBeenCalledOnce();
  });
});
