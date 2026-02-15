/**
 * Tests for geolocation background workers.
 * Issue #1245.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Pool } from 'pg';

// Mock the embedding service before importing workers
vi.mock('../embeddings/service.ts', () => ({
  createEmbeddingService: () => ({
    isConfigured: () => true,
    embed: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3], model: 'test', dimensions: 3 }),
    clearCache: vi.fn(),
  }),
}));

import { processGeoGeocode, processGeoEmbeddings } from './workers.ts';

function mockPool(queryResults: Array<{ rows: unknown[]; rowCount: number }>): Pool {
  const queryFn = vi.fn();
  for (const r of queryResults) {
    queryFn.mockResolvedValueOnce(r);
  }
  return { query: queryFn } as unknown as Pool;
}

describe('geolocation/workers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('processGeoGeocode', () => {
    it('returns 0 when no records need geocoding', async () => {
      const pool = mockPool([
        { rows: [], rowCount: 0 }, // SELECT query returns no records
      ]);
      const count = await processGeoGeocode(pool, 10);
      expect(count).toBe(0);
    });

    it('geocodes records and updates address + place_label', async () => {
      const pool = mockPool([
        // 1. SELECT records needing geocoding
        {
          rows: [
            {
              time: new Date('2026-01-15T10:00:00Z'),
              user_email: 'user@example.com',
              provider_id: 'p1',
              entity_id: 'person.john',
              lat: -33.8688,
              lng: 151.2093,
            },
          ],
          rowCount: 1,
        },
        // 2. UPDATE with address
        { rows: [], rowCount: 1 },
      ]);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          display_name: '123 George St, Sydney NSW 2000, Australia',
          name: 'George Street',
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const count = await processGeoGeocode(pool, 10);
      expect(count).toBe(1);
      expect(mockFetch).toHaveBeenCalledOnce();

      // Verify the UPDATE query
      const updateCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(updateCall[0]).toContain('UPDATE geo_location');
      expect(updateCall[0]).toContain('address');
      expect(updateCall[0]).toContain('place_label');
    });

    it('handles Nominatim API errors gracefully', async () => {
      const pool = mockPool([
        {
          rows: [
            {
              time: new Date('2026-01-15T10:00:00Z'),
              user_email: 'user@example.com',
              provider_id: 'p1',
              entity_id: 'person.john',
              lat: -33.8688,
              lng: 151.2093,
            },
          ],
          rowCount: 1,
        },
      ]);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });
      vi.stubGlobal('fetch', mockFetch);

      // Should not throw, just skip
      const count = await processGeoGeocode(pool, 10);
      expect(count).toBe(0);
    });

    it('handles fetch errors gracefully', async () => {
      const pool = mockPool([
        {
          rows: [
            {
              time: new Date('2026-01-15T10:00:00Z'),
              user_email: 'user@example.com',
              provider_id: 'p1',
              entity_id: 'person.john',
              lat: -33.8688,
              lng: 151.2093,
            },
          ],
          rowCount: 1,
        },
      ]);

      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', mockFetch);

      const count = await processGeoGeocode(pool, 10);
      expect(count).toBe(0);
    });

    it('processes multiple records', async () => {
      const pool = mockPool([
        {
          rows: [
            { time: new Date(), user_email: 'u1@x.com', provider_id: 'p1', entity_id: 'e1', lat: -33.86, lng: 151.20 },
            { time: new Date(), user_email: 'u2@x.com', provider_id: 'p1', entity_id: 'e2', lat: -33.87, lng: 151.21 },
          ],
          rowCount: 2,
        },
        // UPDATE for first record
        { rows: [], rowCount: 1 },
        // UPDATE for second record
        { rows: [], rowCount: 1 },
      ]);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          display_name: 'Some Address, Sydney',
          name: 'Some Place',
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const count = await processGeoGeocode(pool, 10);
      expect(count).toBe(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('uses default batch size of 50', async () => {
      const pool = mockPool([
        { rows: [], rowCount: 0 },
      ]);
      await processGeoGeocode(pool);
      const selectCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(selectCall[1]).toEqual([50]);
    });
  });

  describe('processGeoEmbeddings', () => {
    it('returns 0 when no records need embedding', async () => {
      const pool = mockPool([
        { rows: [], rowCount: 0 },
      ]);
      const count = await processGeoEmbeddings(pool, 10);
      expect(count).toBe(0);
    });

    it('skips records with duplicate addresses for same user+entity', async () => {
      const pool = mockPool([
        // 1. SELECT records needing embedding
        {
          rows: [
            {
              time: new Date('2026-01-15T10:00:00Z'),
              user_email: 'user@example.com',
              provider_id: 'p1',
              entity_id: 'person.john',
              address: '123 George St, Sydney',
            },
          ],
          rowCount: 1,
        },
        // 2. Check for previous record with same address
        {
          rows: [{ address: '123 George St, Sydney' }],
          rowCount: 1,
        },
        // 3. UPDATE embedding_status to 'skipped'
        { rows: [], rowCount: 1 },
      ]);

      const count = await processGeoEmbeddings(pool, 10);
      expect(count).toBe(1);

      // Verify it set status to 'skipped'
      const updateCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls[2];
      expect(updateCall[0]).toContain('skipped');
    });

    it('generates embeddings for new addresses', async () => {
      const pool = mockPool([
        // 1. SELECT records needing embedding
        {
          rows: [
            {
              time: new Date('2026-01-15T10:00:00Z'),
              user_email: 'user@example.com',
              provider_id: 'p1',
              entity_id: 'person.john',
              address: '456 Pitt St, Sydney',
            },
          ],
          rowCount: 1,
        },
        // 2. Check for previous record with same address - none found
        { rows: [], rowCount: 0 },
        // 3. UPDATE with embedding + status 'complete'
        { rows: [], rowCount: 1 },
      ]);

      const count = await processGeoEmbeddings(pool, 10);
      expect(count).toBe(1);

      // Verify update with 'complete' status
      const updateCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls[2];
      expect(updateCall[0]).toContain('complete');
    });

    it('uses default batch size of 50', async () => {
      const pool = mockPool([
        { rows: [], rowCount: 0 },
      ]);
      await processGeoEmbeddings(pool);
      const selectCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(selectCall[1]).toEqual([50]);
    });
  });
});
