/**
 * Types for internal job processing.
 * Part of Issue #222.
 */

export interface InternalJob {
  id: string;
  kind: string;
  runAt: Date;
  payload: Record<string, unknown>;
  attempts: number;
  lastError: string | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  completedAt: Date | null;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
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

export type JobHandler = (
  job: InternalJob
) => Promise<JobProcessorResult>;
