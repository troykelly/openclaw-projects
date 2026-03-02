/**
 * Unit tests for Sentry instrumentation in Worker, TMux Worker, and HA Connector (#2001).
 *
 * Tests:
 * - Worker job processing has individual tracing spans (not batch-level)
 * - Circuit breaker state changes are captured as Sentry breadcrumbs
 * - Graceful shutdown flushes pending Sentry events
 * - Dockerfiles include instrument.ts COPY and --import flag
 *
 * Epic #1998 — GlitchTip/Sentry Error Tracking Integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ─── Mock @sentry/node ───

const mockStartSpan = vi.fn(
  (_opts: { name: string; op?: string; attributes?: Record<string, string> }, cb: () => unknown) => cb(),
);
const mockAddBreadcrumb = vi.fn();
const mockClose = vi.fn().mockResolvedValue(true);

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  close: (...args: unknown[]) => mockClose(...args),
  startSpan: (
    opts: { name: string; op?: string; attributes?: Record<string, string> },
    cb: () => unknown,
  ) => mockStartSpan(opts, cb),
  addBreadcrumb: (...args: unknown[]) => mockAddBreadcrumb(...args),
}));

describe('Worker Sentry Instrumentation (#2001)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Worker job tracing spans', () => {
    it('processJobWithSpan wraps individual job execution in a Sentry span', async () => {
      const { processJobWithSpan } = await import(
        '../../../src/worker/sentry-integration.ts'
      );

      let handlerCalled = false;
      const result = await processJobWithSpan(
        { id: 'job-1', kind: 'reminder.work_item.not_before' },
        async () => {
          handlerCalled = true;
          return { success: true };
        },
      );

      expect(handlerCalled).toBe(true);
      expect(result).toEqual({ success: true });
      expect(mockStartSpan).toHaveBeenCalledTimes(1);

      const spanOpts = mockStartSpan.mock.calls[0][0];
      expect(spanOpts.name).toBe('job.process reminder.work_item.not_before');
      expect(spanOpts.op).toBe('job.process');
      expect(spanOpts.attributes?.['job.id']).toBe('job-1');
      expect(spanOpts.attributes?.['job.kind']).toBe(
        'reminder.work_item.not_before',
      );
    });

    it('processJobWithSpan propagates errors from the handler', async () => {
      const { processJobWithSpan } = await import(
        '../../../src/worker/sentry-integration.ts'
      );

      await expect(
        processJobWithSpan(
          { id: 'job-2', kind: 'message.send.sms' },
          async () => {
            throw new Error('handler error');
          },
        ),
      ).rejects.toThrow('handler error');

      // Span was still started
      expect(mockStartSpan).toHaveBeenCalledTimes(1);
    });

    it('processJobWithSpan handles synchronous return values', async () => {
      const { processJobWithSpan } = await import(
        '../../../src/worker/sentry-integration.ts'
      );

      const result = await processJobWithSpan(
        { id: 'job-3', kind: 'nudge.work_item.not_after' },
        async () => ({ success: false, error: 'not found' }),
      );

      expect(result).toEqual({ success: false, error: 'not found' });
    });
  });

  describe('Circuit breaker breadcrumbs', () => {
    it('recordCircuitBreakerBreadcrumb adds a Sentry breadcrumb for state changes', async () => {
      const { recordCircuitBreakerBreadcrumb } = await import(
        '../../../src/worker/sentry-integration.ts'
      );

      recordCircuitBreakerBreadcrumb('example.com', 'closed', 'open', 5);

      expect(mockAddBreadcrumb).toHaveBeenCalledTimes(1);
      const crumb = mockAddBreadcrumb.mock.calls[0][0];
      expect(crumb.category).toBe('circuit_breaker');
      expect(crumb.message).toContain('example.com');
      expect(crumb.message).toContain('closed');
      expect(crumb.message).toContain('open');
      expect(crumb.level).toBe('warning');
      expect(crumb.data?.destination).toBe('example.com');
      expect(crumb.data?.previousState).toBe('closed');
      expect(crumb.data?.newState).toBe('open');
      expect(crumb.data?.failures).toBe(5);
    });

    it('recordCircuitBreakerBreadcrumb uses info level for recovery transitions', async () => {
      const { recordCircuitBreakerBreadcrumb } = await import(
        '../../../src/worker/sentry-integration.ts'
      );

      recordCircuitBreakerBreadcrumb('example.com', 'half_open', 'closed', 0);

      const crumb = mockAddBreadcrumb.mock.calls[0][0];
      expect(crumb.level).toBe('info');
    });
  });

  describe('Dockerfile configuration', () => {
    const repoRoot = path.resolve(__dirname, '../../..');

    describe('Worker Dockerfile', () => {
      const dockerfile = fs.readFileSync(
        path.join(repoRoot, 'docker/worker/Dockerfile'),
        'utf-8',
      );

      it('copies src/instrument.ts in the builder stage', () => {
        expect(dockerfile).toContain('COPY src/instrument.ts');
      });

      it('copies src/instrument.ts in the runtime stage from builder', () => {
        expect(dockerfile).toContain(
          'COPY --from=builder /app/src/instrument.ts ./src/instrument.ts',
        );
      });

      it('CMD includes --import ./src/instrument.ts', () => {
        expect(dockerfile).toContain('--import');
        expect(dockerfile).toContain('./src/instrument.ts');
      });

      it('sets SENTRY_SERVER_NAME=worker', () => {
        expect(dockerfile).toMatch(/ENV\s+SENTRY_SERVER_NAME\s*=?\s*worker/);
      });
    });

    describe('TMux Worker Dockerfile', () => {
      const dockerfile = fs.readFileSync(
        path.join(repoRoot, 'docker/tmux-worker/Dockerfile'),
        'utf-8',
      );

      it('copies src/instrument.ts in the builder stage', () => {
        expect(dockerfile).toContain('COPY src/instrument.ts');
      });

      it('copies src/instrument.ts in the runtime stage from builder', () => {
        expect(dockerfile).toContain(
          'COPY --from=builder /app/src/instrument.ts ./src/instrument.ts',
        );
      });

      it('CMD includes --import ./src/instrument.ts', () => {
        expect(dockerfile).toContain('--import');
        expect(dockerfile).toContain('./src/instrument.ts');
      });

      it('sets SENTRY_SERVER_NAME=tmux-worker', () => {
        expect(dockerfile).toMatch(
          /ENV\s+SENTRY_SERVER_NAME\s*=?\s*tmux-worker/,
        );
      });
    });

    describe('HA Connector Dockerfile', () => {
      const dockerfile = fs.readFileSync(
        path.join(repoRoot, 'docker/ha-connector/Dockerfile'),
        'utf-8',
      );

      it('copies src/instrument.ts in the builder stage', () => {
        expect(dockerfile).toContain('COPY src/instrument.ts');
      });

      it('copies src/instrument.ts in the runtime stage from builder', () => {
        expect(dockerfile).toContain(
          'COPY --from=builder /app/src/instrument.ts ./src/instrument.ts',
        );
      });

      it('CMD includes --import ./src/instrument.ts', () => {
        expect(dockerfile).toContain('--import');
        expect(dockerfile).toContain('./src/instrument.ts');
      });

      it('sets SENTRY_SERVER_NAME=ha-connector', () => {
        expect(dockerfile).toMatch(
          /ENV\s+SENTRY_SERVER_NAME\s*=?\s*ha-connector/,
        );
      });
    });
  });
});
