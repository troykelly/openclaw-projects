/**
 * Tests for Symphony Trace Correlation — Structured Logging Context
 * Issue #2212 — Structured Logging & Trace Correlation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createSymphonyTrace,
  withProvisioningStep,
  withRunningStage,
  formatTraceFields,
  symphonyLog,
  buildNotificationPayload,
  type SymphonyTraceContext,
  type SymphonyNotificationPayload,
} from './trace.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('symphony trace', () => {
  describe('createSymphonyTrace', () => {
    it('generates a trace_id when none provided', () => {
      const trace = createSymphonyTrace({
        run_id: 'run-1',
        issue_identifier: '#100',
        project_id: 'proj-1',
        orchestrator_id: 'orch-1',
      });

      expect(trace.trace_id).toMatch(UUID_REGEX);
      expect(trace.run_id).toBe('run-1');
      expect(trace.issue_identifier).toBe('#100');
      expect(trace.project_id).toBe('proj-1');
      expect(trace.orchestrator_id).toBe('orch-1');
    });

    it('uses provided trace_id when valid', () => {
      const trace = createSymphonyTrace({
        run_id: 'run-2',
        issue_identifier: '#101',
        project_id: null,
        orchestrator_id: null,
        trace_id: 'my-valid-trace-id',
      });

      expect(trace.trace_id).toBe('my-valid-trace-id');
    });

    it('generates a new trace_id when provided value is invalid', () => {
      const trace = createSymphonyTrace({
        run_id: 'run-3',
        issue_identifier: '#102',
        project_id: null,
        orchestrator_id: null,
        trace_id: '<script>alert(1)</script>',
      });

      // Should fall back to a generated UUID
      expect(trace.trace_id).toMatch(UUID_REGEX);
    });

    it('handles null project_id and orchestrator_id', () => {
      const trace = createSymphonyTrace({
        run_id: 'run-4',
        issue_identifier: '#103',
        project_id: null,
        orchestrator_id: null,
      });

      expect(trace.project_id).toBeNull();
      expect(trace.orchestrator_id).toBeNull();
    });
  });

  describe('withProvisioningStep', () => {
    it('extends base context with step_name', () => {
      const base: SymphonyTraceContext = {
        trace_id: 'trace-1',
        run_id: 'run-1',
        issue_identifier: '#100',
        project_id: 'proj-1',
        orchestrator_id: 'orch-1',
      };

      const prov = withProvisioningStep(base, 'clone_repo');
      expect(prov.step_name).toBe('clone_repo');
      expect(prov.trace_id).toBe('trace-1');
      expect(prov.run_id).toBe('run-1');
    });
  });

  describe('withRunningStage', () => {
    it('extends base context with stage', () => {
      const base: SymphonyTraceContext = {
        trace_id: 'trace-2',
        run_id: 'run-2',
        issue_identifier: '#101',
        project_id: null,
        orchestrator_id: null,
      };

      const running = withRunningStage(base, 'coding');
      expect(running.stage).toBe('coding');
      expect(running.trace_id).toBe('trace-2');
    });
  });

  describe('formatTraceFields', () => {
    it('formats all required fields', () => {
      const ctx: SymphonyTraceContext = {
        trace_id: 'trace-fmt',
        run_id: 'run-fmt',
        issue_identifier: '#200',
        project_id: 'proj-fmt',
        orchestrator_id: 'orch-fmt',
      };

      const result = formatTraceFields(ctx);
      expect(result).toContain('trace_id=trace-fmt');
      expect(result).toContain('run_id=run-fmt');
      expect(result).toContain('issue=#200');
      expect(result).toContain('project_id=proj-fmt');
      expect(result).toContain('orchestrator_id=orch-fmt');
    });

    it('omits null project_id and orchestrator_id', () => {
      const ctx: SymphonyTraceContext = {
        trace_id: 'trace-null',
        run_id: 'run-null',
        issue_identifier: '#201',
        project_id: null,
        orchestrator_id: null,
      };

      const result = formatTraceFields(ctx);
      expect(result).not.toContain('project_id=');
      expect(result).not.toContain('orchestrator_id=');
    });

    it('includes step_name for provisioning contexts', () => {
      const ctx: SymphonyTraceContext = {
        trace_id: 'trace-prov',
        run_id: 'run-prov',
        issue_identifier: '#202',
        project_id: null,
        orchestrator_id: null,
      };
      const prov = withProvisioningStep(ctx, 'build_devcontainer');
      const result = formatTraceFields(prov);
      expect(result).toContain('step=build_devcontainer');
    });

    it('includes stage for running contexts', () => {
      const ctx: SymphonyTraceContext = {
        trace_id: 'trace-run',
        run_id: 'run-run',
        issue_identifier: '#203',
        project_id: null,
        orchestrator_id: null,
      };
      const running = withRunningStage(ctx, 'testing');
      const result = formatTraceFields(running);
      expect(result).toContain('stage=testing');
    });
  });

  describe('symphonyLog', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    let warnSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;
    let debugSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    });

    afterEach(() => {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
      debugSpy.mockRestore();
    });

    const ctx: SymphonyTraceContext = {
      trace_id: 'trace-log',
      run_id: 'run-log',
      issue_identifier: '#300',
      project_id: null,
      orchestrator_id: null,
    };

    it('logs info level via console.log', () => {
      symphonyLog('info', 'Test message', ctx);
      expect(logSpy).toHaveBeenCalledOnce();
      expect(logSpy.mock.calls[0][0]).toContain('[Symphony]');
      expect(logSpy.mock.calls[0][0]).toContain('Test message');
      expect(logSpy.mock.calls[0][0]).toContain('trace_id=trace-log');
    });

    it('logs warn level via console.warn', () => {
      symphonyLog('warn', 'Warning', ctx);
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it('logs error level via console.error', () => {
      symphonyLog('error', 'Error occurred', ctx);
      expect(errorSpy).toHaveBeenCalledOnce();
    });

    it('logs debug level via console.debug', () => {
      symphonyLog('debug', 'Debug info', ctx);
      expect(debugSpy).toHaveBeenCalledOnce();
    });
  });

  describe('buildNotificationPayload', () => {
    it('builds a complete notification payload', () => {
      const payload = buildNotificationPayload({
        run_id: 'run-notif',
        issue_identifier: '#400',
        event: 'run_failed',
        severity: 'error',
        summary: 'Run failed due to SSH connection loss',
        root_cause: 'SSH connection dropped',
        auto_actions_taken: ['retry_queued'],
        user_action_needed: false,
        action_url: '/app/symphony/runs/run-notif',
      });

      expect(payload.run_id).toBe('run-notif');
      expect(payload.issue_identifier).toBe('#400');
      expect(payload.event).toBe('run_failed');
      expect(payload.severity).toBe('error');
      expect(payload.summary).toBe('Run failed due to SSH connection loss');
      expect(payload.root_cause).toBe('SSH connection dropped');
      expect(payload.auto_actions_taken).toEqual(['retry_queued']);
      expect(payload.user_action_needed).toBe(false);
      expect(payload.action_url).toBe('/app/symphony/runs/run-notif');
    });

    it('defaults optional fields', () => {
      const payload = buildNotificationPayload({
        run_id: 'run-min',
        issue_identifier: '#401',
        event: 'run_succeeded',
        severity: 'info',
        summary: 'Run completed successfully',
      });

      expect(payload.root_cause).toBeNull();
      expect(payload.auto_actions_taken).toEqual([]);
      expect(payload.user_action_needed).toBe(false);
      expect(payload.action_url).toBeNull();
    });
  });
});
