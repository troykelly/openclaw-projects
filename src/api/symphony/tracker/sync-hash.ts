/**
 * Sync hash computation for drift detection.
 * Epic #2186, Issue #2202 — GitHub Issue Sync.
 *
 * A deterministic hash of issue fields used to detect when a synced
 * work_item has drifted from its tracker source. Comparing sync_hash
 * values is cheaper than field-by-field comparison.
 */
import { createHash } from 'node:crypto';
import type { SyncHashInput } from './types.ts';

/**
 * Compute a deterministic SHA-256 hash of the issue fields that
 * matter for sync. Labels and assignees are sorted for stability.
 *
 * @param input - Fields to hash
 * @returns Hex-encoded SHA-256 hash
 */
export function computeSyncHash(input: SyncHashInput): string {
  const normalized = {
    title: input.title,
    body: input.body ?? '',
    state: input.state,
    labels: [...input.labels].sort(),
    assignees: [...input.assignees].sort(),
    milestone: input.milestone ?? '',
    updatedAt: input.updatedAt,
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
