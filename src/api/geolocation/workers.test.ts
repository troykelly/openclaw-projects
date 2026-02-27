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

/**
 * Build a mock Pool whose .connect() returns a pinned client.
 * queryResults are consumed in order by client.query().
 * The caller must include BEGIN/COMMIT results in the sequence.
 */
function mockPool(queryResults: Array<{ rows: unknown[]; rowCount: number }>) {
  const queryFn = vi.fn();
  for (const r of queryResults) {
    queryFn.mockResolvedValueOnce(r);
  }
  const client = {
    query: queryFn,
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn(), // unused by the pinned-client path
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as Pool;
  return { pool, client };
}

// Shortcut result for BEGIN/COMMIT/ROLLBACK
const txOk = { rows: [], rowCount: 0 };

describe('geolocation/workers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('processGeoGeocode', () => {
    it('returns 0 when no records need geocoding', async () => {
      const { pool } = mockPool([
        txOk, // BEGIN
        { rows: [], rowCount: 0 }, // SELECT
        txOk, // COMMIT
      ]);
      const count = await processGeoGeocode(pool, 10);
      expect(count).toBe(0);
    });

    it('geocodes records and updates address + place_label', async () => {
      const { pool, client } = mockPool([
        txOk, // BEGIN
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
        // UPDATE with address
        { rows: [], rowCount: 1 },
        txOk, // COMMIT
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

      // Verify the UPDATE query (index 2: BEGIN=0, SELECT=1, UPDATE=2)
      const updateCall = client.query.mock.calls[2];
      expect(updateCall[0]).toContain('UPDATE geo_location');
      expect(updateCall[0]).toContain('address');
      expect(updateCall[0]).toContain('place_label');
    });

    it('handles Nominatim API errors gracefully', async () => {
      const { pool } = mockPool([
        txOk, // BEGIN
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
        txOk, // COMMIT (no UPDATE since API failed)
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
      const { pool } = mockPool([
        txOk, // BEGIN
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
        txOk, // COMMIT
      ]);

      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', mockFetch);

      const count = await processGeoGeocode(pool, 10);
      expect(count).toBe(0);
    });

    it('processes multiple records', async () => {
      const { pool } = mockPool([
        txOk, // BEGIN
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
        txOk, // COMMIT
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
      const { pool, client } = mockPool([
        txOk, // BEGIN
        { rows: [], rowCount: 0 }, // SELECT
        txOk, // COMMIT
      ]);
      await processGeoGeocode(pool);
      // SELECT is the second call (index 1: BEGIN=0, SELECT=1)
      const selectCall = client.query.mock.calls[1];
      expect(selectCall[1]).toEqual([50]);
    });
  });

  describe('processGeoEmbeddings', () => {
    it('returns 0 when no records need embedding', async () => {
      const { pool } = mockPool([
        txOk, // BEGIN
        { rows: [], rowCount: 0 }, // SELECT
        txOk, // COMMIT
      ]);
      const count = await processGeoEmbeddings(pool, 10);
      expect(count).toBe(0);
    });

    it('skips records with duplicate addresses for same user+entity', async () => {
      const { pool, client } = mockPool([
        txOk, // BEGIN
        // SELECT records needing embedding
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
        // Check for previous record with same address
        {
          rows: [{ address: '123 George St, Sydney' }],
          rowCount: 1,
        },
        // UPDATE embedding_status to 'skipped'
        { rows: [], rowCount: 1 },
        txOk, // COMMIT
      ]);

      const count = await processGeoEmbeddings(pool, 10);
      expect(count).toBe(1);

      // Verify it set status to 'skipped' (index 3: BEGIN=0, SELECT=1, dupcheck=2, UPDATE=3)
      const updateCall = client.query.mock.calls[3];
      expect(updateCall[0]).toContain('skipped');
    });

    it('generates embeddings for new addresses', async () => {
      const { pool, client } = mockPool([
        txOk, // BEGIN
        // SELECT records needing embedding
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
        // Check for previous record with same address - none found
        { rows: [], rowCount: 0 },
        // UPDATE with embedding + status 'complete'
        { rows: [], rowCount: 1 },
        txOk, // COMMIT
      ]);

      const count = await processGeoEmbeddings(pool, 10);
      expect(count).toBe(1);

      // Verify update with 'complete' status (index 3: BEGIN=0, SELECT=1, dupcheck=2, UPDATE=3)
      const updateCall = client.query.mock.calls[3];
      expect(updateCall[0]).toContain('complete');
    });

    it('uses default batch size of 50', async () => {
      const { pool, client } = mockPool([
        txOk, // BEGIN
        { rows: [], rowCount: 0 }, // SELECT
        txOk, // COMMIT
      ]);
      await processGeoEmbeddings(pool);
      // SELECT is the second call (index 1: BEGIN=0, SELECT=1)
      const selectCall = client.query.mock.calls[1];
      expect(selectCall[1]).toEqual([50]);
    });
  });
});
