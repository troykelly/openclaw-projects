/**
 * Tests for worker LISTEN/NOTIFY channel configuration.
 * Part of Issue #1348.
 */
import { describe, it, expect } from 'vitest';
import { WORKER_CHANNELS } from './channels.ts';

describe('WORKER_CHANNELS', () => {
  it('includes internal_job_ready', () => {
    expect(WORKER_CHANNELS).toContain('internal_job_ready');
  });

  it('includes webhook_outbox_ready', () => {
    expect(WORKER_CHANNELS).toContain('webhook_outbox_ready');
  });

  it('includes geo_provider_config_changed', () => {
    expect(WORKER_CHANNELS).toContain('geo_provider_config_changed');
  });
});
