/**
 * Symphony Trace Correlation — Structured Logging Context
 *
 * Every Symphony log entry includes: trace_id, run_id, issue_identifier,
 * project_id, orchestrator_id. Provisioning logs add step name;
 * running logs add stage.
 *
 * Extends existing trace-context.ts module for Symphony-specific needs.
 *
 * Issue #2212 — Structured Logging & Trace Correlation
 */

import { generateTraceId, validateTraceId } from '../api/terminal/trace-context.ts';

/** Required context fields for every Symphony log entry. */
export interface SymphonyTraceContext {
  /** Unique trace ID for this run (UUID v4). */
  trace_id: string;
  /** Symphony run ID. */
  run_id: string;
  /** Work item identifier (e.g., issue number or slug). */
  issue_identifier: string;
  /** Project ID (nullable for unlinked runs). */
  project_id: string | null;
  /** Orchestrator ID that owns this run. */
  orchestrator_id: string | null;
}

/** Extended context for provisioning-phase logs. */
export interface ProvisioningTraceContext extends SymphonyTraceContext {
  /** Name of the provisioning pipeline step. */
  step_name: string;
}

/** Extended context for running-phase logs. */
export interface RunningTraceContext extends SymphonyTraceContext {
  /** Advisory stage inferred from terminal output. */
  stage: string;
}

/** Notification payload with required actionable fields. */
export interface SymphonyNotificationPayload {
  run_id: string;
  issue_identifier: string;
  event: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  summary: string;
  root_cause: string | null;
  auto_actions_taken: string[];
  user_action_needed: boolean;
  action_url: string | null;
}

/**
 * Create a new SymphonyTraceContext for a run.
 * Generates a fresh trace_id if none provided.
 */
export function createSymphonyTrace(params: {
  run_id: string;
  issue_identifier: string;
  project_id: string | null;
  orchestrator_id: string | null;
  trace_id?: string;
}): SymphonyTraceContext {
  let trace_id: string;
  if (params.trace_id) {
    const validated = validateTraceId(params.trace_id);
    trace_id = validated ?? generateTraceId();
  } else {
    trace_id = generateTraceId();
  }

  return {
    trace_id,
    run_id: params.run_id,
    issue_identifier: params.issue_identifier,
    project_id: params.project_id,
    orchestrator_id: params.orchestrator_id,
  };
}

/**
 * Extend a base trace context with provisioning step info.
 */
export function withProvisioningStep(
  base: SymphonyTraceContext,
  stepName: string,
): ProvisioningTraceContext {
  return { ...base, step_name: stepName };
}

/**
 * Extend a base trace context with running stage info.
 */
export function withRunningStage(
  base: SymphonyTraceContext,
  stage: string,
): RunningTraceContext {
  return { ...base, stage };
}

/**
 * Format a trace context into structured log fields (key=value pairs).
 * Follows existing codebase logging patterns.
 */
export function formatTraceFields(ctx: SymphonyTraceContext): string {
  const fields: string[] = [
    `trace_id=${ctx.trace_id}`,
    `run_id=${ctx.run_id}`,
    `issue=${ctx.issue_identifier}`,
  ];

  if (ctx.project_id) {
    fields.push(`project_id=${ctx.project_id}`);
  }
  if (ctx.orchestrator_id) {
    fields.push(`orchestrator_id=${ctx.orchestrator_id}`);
  }

  // Provisioning step
  if ('step_name' in ctx) {
    fields.push(`step=${(ctx as ProvisioningTraceContext).step_name}`);
  }

  // Running stage
  if ('stage' in ctx) {
    fields.push(`stage=${(ctx as RunningTraceContext).stage}`);
  }

  return fields.join(' ');
}

/**
 * Create a structured log message with trace context.
 */
export function symphonyLog(
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  ctx: SymphonyTraceContext,
): void {
  const fields = formatTraceFields(ctx);
  const prefix = '[Symphony]';
  const logFn = level === 'error' ? console.error
    : level === 'warn' ? console.warn
    : level === 'debug' ? console.debug
    : console.log;

  logFn(`${prefix} ${message} ${fields}`);
}

/**
 * Build a notification payload with all required actionable fields.
 */
export function buildNotificationPayload(params: {
  run_id: string;
  issue_identifier: string;
  event: string;
  severity: SymphonyNotificationPayload['severity'];
  summary: string;
  root_cause?: string | null;
  auto_actions_taken?: string[];
  user_action_needed?: boolean;
  action_url?: string | null;
}): SymphonyNotificationPayload {
  return {
    run_id: params.run_id,
    issue_identifier: params.issue_identifier,
    event: params.event,
    severity: params.severity,
    summary: params.summary,
    root_cause: params.root_cause ?? null,
    auto_actions_taken: params.auto_actions_taken ?? [],
    user_action_needed: params.user_action_needed ?? false,
    action_url: params.action_url ?? null,
  };
}
