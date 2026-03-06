/**
 * LISTEN/NOTIFY channels the symphony worker subscribes to.
 * Issue #2195 — Symphony Worker Process Skeleton.
 */

export const SYMPHONY_CHANNELS = [
  'symphony_run_ready',
  'symphony_config_changed',
  'symphony_claim_released',
] as const;

export type SymphonyChannel = (typeof SYMPHONY_CHANNELS)[number];
