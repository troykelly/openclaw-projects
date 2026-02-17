/**
 * Types for internal job processing.
 * All property names use snake_case to match the project-wide convention (Issue #1412).
 * Part of Issue #222.
 */

export interface InternalJob {
  id: string;
  kind: string;
  run_at: Date;
  payload: Record<string, unknown>;
  attempts: number;
  last_error: string | null;
  locked_at: Date | null;
  locked_by: string | null;
  completed_at: Date | null;
  idempotency_key: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface JobProcessorResult {
  success: boolean;
  error?: string;
}

export interface JobProcessorStats {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

export type JobHandler = (job: InternalJob) => Promise<JobProcessorResult>;
