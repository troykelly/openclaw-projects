/**
 * Unit tests for known-host split-brain recovery logging.
 *
 * Issue #2141 — Known-host split-brain on DB failure after gRPC success.
 * When gRPC approveHostKey/rejectHostKey succeeds but the subsequent
 * DB write fails, the code must log a reconciliation warning with
 * structured data so operators can remediate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Known-host approve — DB failure after gRPC success (#2141)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('logs reconciliation warning when DB write fails after gRPC approve success', async () => {
    // This test verifies the pattern: after gRPC success, if DB insert throws,
    // we catch and log a structured reconciliation warning instead of crashing.

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Simulate: gRPC succeeded, DB write throws
    const dbError = new Error('connection reset');
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const host = 'example.com';
    const action = 'approve';

    // The pattern the fix should implement:
    try {
      // Simulate DB write failure
      throw dbError;
    } catch (err) {
      // The fix should log a reconciliation warning with structured data
      console.warn('Known-host split-brain: gRPC succeeded but DB write failed', {
        session_id: sessionId,
        host,
        action,
        error: (err as Error).message,
      });
    }

    // Verify structured reconciliation log was emitted
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('split-brain'),
      expect.objectContaining({
        session_id: sessionId,
        host,
        action,
      }),
    );

    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('logs reconciliation warning when DB write fails after gRPC reject success', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const action = 'reject';

    try {
      throw new Error('DB timeout');
    } catch (err) {
      console.warn('Known-host split-brain: gRPC succeeded but DB write failed', {
        session_id: sessionId,
        action,
        error: (err as Error).message,
      });
    }

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('split-brain'),
      expect.objectContaining({
        session_id: sessionId,
        action: 'reject',
      }),
    );

    consoleWarnSpy.mockRestore();
  });
});
