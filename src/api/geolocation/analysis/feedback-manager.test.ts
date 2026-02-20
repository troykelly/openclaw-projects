/**
 * Tests for FeedbackManager.
 * Issue #1466, Epic #1440.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';

import { FeedbackManager, type FeedbackAction, type FeedbackResult } from './feedback-manager.ts';

// ---------- helpers ----------

function mockPool(queryFn: ReturnType<typeof vi.fn>): Pool {
  return { query: queryFn } as unknown as Pool;
}

const TEST_NS = 'test-namespace';
const ROUTINE_ID = '00000000-0000-0000-0000-000000000001';
const FEEDBACK_ID = '00000000-0000-0000-0000-000000000099';

function setupMockForAction(
  queryFn: ReturnType<typeof vi.fn>,
  currentConfidence: number,
  currentStatus: string,
): void {
  // 1st call: SELECT routine
  queryFn.mockResolvedValueOnce({
    rows: [{ id: ROUTINE_ID, confidence: currentConfidence, status: currentStatus }],
  });
  // 2nd call: INSERT feedback
  queryFn.mockResolvedValueOnce({ rows: [{ id: FEEDBACK_ID }] });
  // 3rd call: UPDATE routine
  queryFn.mockResolvedValueOnce({ rows: [], rowCount: 1 });
}

// ---------- tests ----------

describe('FeedbackManager', () => {
  let queryFn: ReturnType<typeof vi.fn>;
  let manager: FeedbackManager;

  beforeEach(() => {
    queryFn = vi.fn();
    manager = new FeedbackManager(mockPool(queryFn));
  });

  // ---------- validation ----------

  describe('validation', () => {
    it('throws for invalid feedback action', async () => {
      await expect(
        manager.recordFeedback(ROUTINE_ID, 'invalid' as FeedbackAction, 'agent', TEST_NS),
      ).rejects.toThrow('Invalid feedback action');
    });

    it('throws when routine not found', async () => {
      queryFn.mockResolvedValueOnce({ rows: [] });

      await expect(
        manager.recordFeedback(ROUTINE_ID, 'confirmed', 'agent', TEST_NS),
      ).rejects.toThrow('not found');
    });
  });

  // ---------- feedback recording ----------

  describe('feedback recording', () => {
    it('inserts feedback record with correct parameters', async () => {
      setupMockForAction(queryFn, 0.5, 'tentative');

      await manager.recordFeedback(ROUTINE_ID, 'confirmed', 'agent', TEST_NS, 'Test note');

      // Verify INSERT call (2nd query call)
      const insertCall = queryFn.mock.calls[1];
      const sql = insertCall[0] as string;
      expect(sql).toContain('INSERT INTO ha_routine_feedback');

      const params = insertCall[1] as unknown[];
      expect(params[0]).toBe(TEST_NS);
      expect(params[1]).toBe(ROUTINE_ID);
      expect(params[2]).toBe('confirmed');
      expect(params[3]).toBe('agent');
      expect(params[4]).toBe('Test note');
    });

    it('inserts null notes when not provided', async () => {
      setupMockForAction(queryFn, 0.5, 'tentative');

      await manager.recordFeedback(ROUTINE_ID, 'confirmed', 'user', TEST_NS);

      const insertParams = queryFn.mock.calls[1][1] as unknown[];
      expect(insertParams[4]).toBeNull();
    });

    it('returns feedback result with ID', async () => {
      setupMockForAction(queryFn, 0.5, 'tentative');

      const result = await manager.recordFeedback(ROUTINE_ID, 'confirmed', 'agent', TEST_NS);

      expect(result.feedback_id).toBe(FEEDBACK_ID);
    });
  });

  // ---------- confidence adjustments ----------

  describe('confirmed action', () => {
    it('increases confidence by 0.1', async () => {
      setupMockForAction(queryFn, 0.5, 'tentative');

      const result = await manager.recordFeedback(ROUTINE_ID, 'confirmed', 'agent', TEST_NS);

      expect(result.new_confidence).toBeCloseTo(0.6, 5);
    });

    it('caps confidence at 1.0', async () => {
      setupMockForAction(queryFn, 0.95, 'confirmed');

      const result = await manager.recordFeedback(ROUTINE_ID, 'confirmed', 'agent', TEST_NS);

      expect(result.new_confidence).toBe(1.0);
    });

    it('does not change status if already tentative', async () => {
      setupMockForAction(queryFn, 0.5, 'tentative');

      const result = await manager.recordFeedback(ROUTINE_ID, 'confirmed', 'agent', TEST_NS);

      expect(result.new_status).toBe('tentative');
    });

    it('changes rejected status to tentative', async () => {
      setupMockForAction(queryFn, 0.0, 'rejected');

      const result = await manager.recordFeedback(ROUTINE_ID, 'confirmed', 'agent', TEST_NS);

      expect(result.new_status).toBe('tentative');
      expect(result.new_confidence).toBeCloseTo(0.1, 5);
    });

    it('preserves confirmed status', async () => {
      setupMockForAction(queryFn, 0.8, 'confirmed');

      const result = await manager.recordFeedback(ROUTINE_ID, 'confirmed', 'agent', TEST_NS);

      expect(result.new_status).toBe('confirmed');
    });
  });

  describe('rejected action', () => {
    it('sets confidence to 0', async () => {
      setupMockForAction(queryFn, 0.85, 'confirmed');

      const result = await manager.recordFeedback(ROUTINE_ID, 'rejected', 'agent', TEST_NS);

      expect(result.new_confidence).toBe(0);
    });

    it('sets status to rejected', async () => {
      setupMockForAction(queryFn, 0.85, 'confirmed');

      const result = await manager.recordFeedback(ROUTINE_ID, 'rejected', 'agent', TEST_NS);

      expect(result.new_status).toBe('rejected');
    });
  });

  describe('modified action', () => {
    it('resets confidence to 0.5', async () => {
      setupMockForAction(queryFn, 0.85, 'confirmed');

      const result = await manager.recordFeedback(ROUTINE_ID, 'modified', 'agent', TEST_NS);

      expect(result.new_confidence).toBe(0.5);
    });

    it('sets status to tentative', async () => {
      setupMockForAction(queryFn, 0.85, 'confirmed');

      const result = await manager.recordFeedback(ROUTINE_ID, 'modified', 'agent', TEST_NS);

      expect(result.new_status).toBe('tentative');
    });

    it('resets from low confidence', async () => {
      setupMockForAction(queryFn, 0.2, 'tentative');

      const result = await manager.recordFeedback(ROUTINE_ID, 'modified', 'agent', TEST_NS);

      expect(result.new_confidence).toBe(0.5);
      expect(result.new_status).toBe('tentative');
    });
  });

  describe('automation_accepted action', () => {
    it('increases confidence by 0.15', async () => {
      setupMockForAction(queryFn, 0.7, 'confirmed');

      const result = await manager.recordFeedback(ROUTINE_ID, 'automation_accepted', 'agent', TEST_NS);

      expect(result.new_confidence).toBeCloseTo(0.85, 5);
    });

    it('caps confidence at 1.0', async () => {
      setupMockForAction(queryFn, 0.9, 'confirmed');

      const result = await manager.recordFeedback(ROUTINE_ID, 'automation_accepted', 'agent', TEST_NS);

      expect(result.new_confidence).toBe(1.0);
    });

    it('preserves current status', async () => {
      setupMockForAction(queryFn, 0.7, 'confirmed');

      const result = await manager.recordFeedback(ROUTINE_ID, 'automation_accepted', 'agent', TEST_NS);

      expect(result.new_status).toBe('confirmed');
    });
  });

  describe('automation_rejected action', () => {
    it('decreases confidence by 0.1', async () => {
      setupMockForAction(queryFn, 0.8, 'confirmed');

      const result = await manager.recordFeedback(ROUTINE_ID, 'automation_rejected', 'agent', TEST_NS);

      expect(result.new_confidence).toBeCloseTo(0.7, 5);
    });

    it('floors confidence at 0.0', async () => {
      setupMockForAction(queryFn, 0.05, 'tentative');

      const result = await manager.recordFeedback(ROUTINE_ID, 'automation_rejected', 'agent', TEST_NS);

      expect(result.new_confidence).toBe(0.0);
    });

    it('preserves current status', async () => {
      setupMockForAction(queryFn, 0.8, 'confirmed');

      const result = await manager.recordFeedback(ROUTINE_ID, 'automation_rejected', 'agent', TEST_NS);

      expect(result.new_status).toBe('confirmed');
    });
  });

  // ---------- summary ----------

  describe('summary', () => {
    it('includes action name', async () => {
      setupMockForAction(queryFn, 0.5, 'tentative');

      const result = await manager.recordFeedback(ROUTINE_ID, 'confirmed', 'agent', TEST_NS);

      expect(result.summary).toContain('"confirmed"');
    });

    it('includes confidence change', async () => {
      setupMockForAction(queryFn, 0.5, 'tentative');

      const result = await manager.recordFeedback(ROUTINE_ID, 'confirmed', 'agent', TEST_NS);

      expect(result.summary).toContain('0.50');
      expect(result.summary).toContain('0.60');
    });

    it('includes status change when applicable', async () => {
      setupMockForAction(queryFn, 0.85, 'confirmed');

      const result = await manager.recordFeedback(ROUTINE_ID, 'rejected', 'agent', TEST_NS);

      expect(result.summary).toContain('confirmed -> rejected');
    });

    it('omits status change when unchanged', async () => {
      setupMockForAction(queryFn, 0.5, 'tentative');

      const result = await manager.recordFeedback(ROUTINE_ID, 'confirmed', 'agent', TEST_NS);

      expect(result.summary).not.toContain('status');
    });
  });

  // ---------- database interaction verification ----------

  describe('database interactions', () => {
    it('makes exactly 3 queries: SELECT, INSERT, UPDATE', async () => {
      setupMockForAction(queryFn, 0.5, 'tentative');

      await manager.recordFeedback(ROUTINE_ID, 'confirmed', 'agent', TEST_NS);

      expect(queryFn).toHaveBeenCalledTimes(3);

      // Verify query types
      const queries = queryFn.mock.calls.map((c) => c[0] as string);
      expect(queries[0]).toContain('SELECT');
      expect(queries[1]).toContain('INSERT INTO ha_routine_feedback');
      expect(queries[2]).toContain('UPDATE ha_routines');
    });

    it('passes namespace to UPDATE query', async () => {
      setupMockForAction(queryFn, 0.5, 'tentative');

      await manager.recordFeedback(ROUTINE_ID, 'confirmed', 'agent', TEST_NS);

      const updateParams = queryFn.mock.calls[2][1] as unknown[];
      // params: [confidence, status, routineId, namespace]
      expect(updateParams[3]).toBe(TEST_NS);
      expect(updateParams[2]).toBe(ROUTINE_ID);
    });

    it('uses parameterized queries (no SQL injection)', async () => {
      setupMockForAction(queryFn, 0.5, 'tentative');

      await manager.recordFeedback(
        ROUTINE_ID,
        'confirmed',
        'agent',
        TEST_NS,
        "Robert'); DROP TABLE ha_routines;--",
      );

      // Notes should be passed as parameter, not interpolated
      const insertParams = queryFn.mock.calls[1][1] as unknown[];
      expect(insertParams[4]).toBe("Robert'); DROP TABLE ha_routines;--");

      // SQL should use $N placeholders
      const insertSql = queryFn.mock.calls[1][0] as string;
      expect(insertSql).toContain('$5');
      expect(insertSql).not.toContain("Robert')");
    });
  });
});
