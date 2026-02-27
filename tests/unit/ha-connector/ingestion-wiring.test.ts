/**
 * Tests for GeoIngestorProcessor ingestion wiring.
 * Validates that the processor calls ingestLocationUpdate with correct args.
 * Issue #1895.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the ingestion module
vi.mock('@/api/geolocation/ingestion', () => ({
  ingestLocationUpdate: vi.fn().mockResolvedValue({ inserted: true }),
}));

describe('GeoIngestorProcessor ingestion wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls ingestLocationUpdate with correct providerId from namespace', async () => {
    const { GeoIngestorProcessor } = await import(
      '@/api/geolocation/processors/geo-ingestor-processor'
    );
    const { ingestLocationUpdate } = await import('@/api/geolocation/ingestion');

    const mockPool = {} as any;
    const processor = new GeoIngestorProcessor(mockPool);

    await processor.onStateChange(
      {
        entity_id: 'device_tracker.phone',
        domain: 'device_tracker',
        old_state: null,
        new_state: 'home',
        old_attributes: {},
        new_attributes: { latitude: -33.86, longitude: 151.20 },
        last_changed: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        context: { id: '', parent_id: null, user_id: null },
      },
      'provider-uuid-123:user@example.com',
    );

    expect(ingestLocationUpdate).toHaveBeenCalledWith(
      mockPool,
      'provider-uuid-123',
      expect.objectContaining({
        entity_id: 'device_tracker.phone',
        lat: -33.86,
        lng: 151.20,
      }),
    );
  });

  it('skips ingestion when namespace has no separator', async () => {
    const { GeoIngestorProcessor } = await import(
      '@/api/geolocation/processors/geo-ingestor-processor'
    );
    const { ingestLocationUpdate } = await import('@/api/geolocation/ingestion');

    const logHandler = vi.fn();
    const processor = new GeoIngestorProcessor({} as any, logHandler);

    await processor.onStateChange(
      {
        entity_id: 'device_tracker.phone',
        domain: 'device_tracker',
        old_state: null,
        new_state: 'home',
        old_attributes: {},
        new_attributes: { latitude: -33.86, longitude: 151.20 },
        last_changed: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        context: { id: '', parent_id: null, user_id: null },
      },
      'default',
    );

    expect(ingestLocationUpdate).not.toHaveBeenCalled();
    expect(logHandler).toHaveBeenCalled();
  });
});
