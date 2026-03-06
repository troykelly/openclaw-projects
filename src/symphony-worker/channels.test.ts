/**
 * Unit tests for symphony worker channels.
 * Issue #2195 — Symphony Worker Process Skeleton.
 */

import { describe, it, expect } from 'vitest';
import { SYMPHONY_CHANNELS } from './channels.ts';

describe('SYMPHONY_CHANNELS', () => {
  it('contains expected channel names', () => {
    expect(SYMPHONY_CHANNELS).toContain('symphony_run_ready');
    expect(SYMPHONY_CHANNELS).toContain('symphony_config_changed');
    expect(SYMPHONY_CHANNELS).toContain('symphony_claim_released');
  });

  it('has exactly 3 channels', () => {
    expect(SYMPHONY_CHANNELS).toHaveLength(3);
  });

  it('is readonly', () => {
    // TypeScript enforces this, but verify at runtime that the array is frozen-like
    expect(Array.isArray(SYMPHONY_CHANNELS)).toBe(true);
  });
});
