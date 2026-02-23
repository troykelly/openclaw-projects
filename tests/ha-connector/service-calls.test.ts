/**
 * Tests for the HA Connector service call handler.
 * Issue #1637, parent #1603.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from '../../src/api/geolocation/types.ts';
import { ServiceCallHandler } from '../../src/ha-connector/service-calls.ts';
import type { ProviderLifecycleManager } from '../../src/ha-connector/lifecycle.ts';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockConnection(sendResult = true): Connection & { sendServiceCall: ReturnType<typeof vi.fn> } {
  return {
    disconnect: vi.fn().mockResolvedValue(undefined),
    addEntities: vi.fn(),
    removeEntities: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    sendServiceCall: vi.fn().mockResolvedValue(sendResult ? { success: true } : { success: false, error: 'Failed' }),
  };
}

function createMockLifecycle(conn?: Connection): ProviderLifecycleManager {
  return {
    getConnection: vi.fn().mockReturnValue(conn ?? undefined),
    isRunning: vi.fn().mockReturnValue(true),
  } as unknown as ProviderLifecycleManager;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ServiceCallHandler', () => {
  let handler: ServiceCallHandler;
  let lifecycle: ProviderLifecycleManager;
  let mockConn: Connection & { sendServiceCall: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockConn = createMockConnection();
    lifecycle = createMockLifecycle(mockConn);
    handler = new ServiceCallHandler(lifecycle);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses a valid service call payload and finds the provider', async () => {
    const payload = JSON.stringify({
      provider_id: 'prov-1',
      domain: 'light',
      service: 'turn_on',
      entity_id: 'light.living_room',
      service_data: { brightness: 255 },
      request_id: 'req-1',
    });

    const result = await handler.handleNotification(payload);

    expect(result.success).toBe(true);
    expect(lifecycle.getConnection).toHaveBeenCalledWith('prov-1');
  });

  it('returns error when provider is not connected', async () => {
    lifecycle = createMockLifecycle(undefined);
    handler = new ServiceCallHandler(lifecycle);

    const payload = JSON.stringify({
      provider_id: 'prov-missing',
      domain: 'light',
      service: 'turn_on',
      entity_id: 'light.kitchen',
    });

    const result = await handler.handleNotification(payload);

    expect(result.success).toBe(false);
    expect(result.error).toContain('not connected');
  });

  it('returns error for invalid JSON payload', async () => {
    const result = await handler.handleNotification('not json');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid');
  });

  it('returns error when provider_id is missing', async () => {
    const payload = JSON.stringify({
      domain: 'light',
      service: 'turn_on',
      entity_id: 'light.office',
    });

    const result = await handler.handleNotification(payload);

    expect(result.success).toBe(false);
    expect(result.error).toContain('provider_id');
  });

  it('returns error when domain is missing', async () => {
    const payload = JSON.stringify({
      provider_id: 'prov-1',
      service: 'turn_on',
      entity_id: 'light.office',
    });

    const result = await handler.handleNotification(payload);

    expect(result.success).toBe(false);
    expect(result.error).toContain('domain');
  });

  it('returns error when service is missing', async () => {
    const payload = JSON.stringify({
      provider_id: 'prov-1',
      domain: 'light',
      entity_id: 'light.office',
    });

    const result = await handler.handleNotification(payload);

    expect(result.success).toBe(false);
    expect(result.error).toContain('service');
  });

  it('handles optional service_data and entity_id', async () => {
    const payload = JSON.stringify({
      provider_id: 'prov-1',
      domain: 'homeassistant',
      service: 'restart',
    });

    const result = await handler.handleNotification(payload);

    expect(result.success).toBe(true);
  });
});
