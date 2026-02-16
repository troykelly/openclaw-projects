/**
 * LISTEN/NOTIFY channels the worker subscribes to.
 * Part of Issue #1348.
 */

export const WORKER_CHANNELS = [
  'internal_job_ready',
  'webhook_outbox_ready',
  'geo_provider_config_changed',
] as const;

export type WorkerChannel = (typeof WORKER_CHANNELS)[number];
