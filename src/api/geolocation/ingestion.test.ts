/**
 * Tests for geolocation ingestion pipeline.
 * Issue #1245.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import {
  validateLocationUpdate,
  haversineDistance,
  shouldDedup,
  shouldRateLimit,
  ingestLocationUpdate,
} from './ingestion.ts';
import type { LocationUpdate } from './types.ts';
import type { GeoLocation } from './service.ts';

function validUpdate(overrides: Partial<LocationUpdate> = {}): LocationUpdate {
  return {
    entity_id: 'person.john',
    lat: -33.8688,
    lng: 151.2093,
    accuracy_m: 10,
    timestamp: new Date(),
    ...overrides,
  };
}

describe('geolocation/ingestion', () => {
  describe('validateLocationUpdate', () => {
    it('accepts a valid update', () => {
      const result = validateLocationUpdate(validUpdate());
      expect(result.ok).toBe(true);
    });

    it('rejects latitude below -90', () => {
      const result = validateLocationUpdate(validUpdate({ lat: -91 }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('lat');
    });

    it('rejects latitude above 90', () => {
      const result = validateLocationUpdate(validUpdate({ lat: 91 }));
      expect(result.ok).toBe(false);
    });

    it('rejects longitude below -180', () => {
      const result = validateLocationUpdate(validUpdate({ lng: -181 }));
      expect(result.ok).toBe(false);
    });

    it('rejects longitude above 180', () => {
      const result = validateLocationUpdate(validUpdate({ lng: 181 }));
      expect(result.ok).toBe(false);
    });

    it('rejects negative accuracy', () => {
      const result = validateLocationUpdate(validUpdate({ accuracy_m: -1 }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('accuracy');
    });

    it('rejects accuracy above 100000m', () => {
      const result = validateLocationUpdate(validUpdate({ accuracy_m: 100001 }));
      expect(result.ok).toBe(false);
    });

    it('accepts accuracy of 0', () => {
      const result = validateLocationUpdate(validUpdate({ accuracy_m: 0 }));
      expect(result.ok).toBe(true);
    });

    it('rejects negative bearing', () => {
      const result = validateLocationUpdate(validUpdate({ bearing: -1 }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('bearing');
    });

    it('rejects bearing >= 360', () => {
      const result = validateLocationUpdate(validUpdate({ bearing: 360 }));
      expect(result.ok).toBe(false);
    });

    it('accepts bearing of 0', () => {
      const result = validateLocationUpdate(validUpdate({ bearing: 0 }));
      expect(result.ok).toBe(true);
    });

    it('accepts bearing of 359.9', () => {
      const result = validateLocationUpdate(validUpdate({ bearing: 359.9 }));
      expect(result.ok).toBe(true);
    });

    it('rejects timestamp in the future (beyond 30s skew)', () => {
      const future = new Date(Date.now() + 60_000);
      const result = validateLocationUpdate(validUpdate({ timestamp: future }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('future');
    });

    it('accepts timestamp within 30s clock skew', () => {
      const nearFuture = new Date(Date.now() + 20_000);
      const result = validateLocationUpdate(validUpdate({ timestamp: nearFuture }));
      expect(result.ok).toBe(true);
    });

    it('rejects timestamp older than 1 hour', () => {
      const old = new Date(Date.now() - 3_700_000);
      const result = validateLocationUpdate(validUpdate({ timestamp: old }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('old');
    });

    it('defaults timestamp to now if not provided', () => {
      const update = validUpdate({ timestamp: undefined });
      const before = Date.now();
      const result = validateLocationUpdate(update);
      const after = Date.now();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.timestamp).toBeDefined();
        const ts = result.value.timestamp!.getTime();
        expect(ts).toBeGreaterThanOrEqual(before);
        expect(ts).toBeLessThanOrEqual(after);
      }
    });

    it('sanitises entity_id by stripping control chars', () => {
      const result = validateLocationUpdate(validUpdate({ entity_id: 'person\x00.john\x01' }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.entity_id).toBe('person.john');
      }
    });

    it('truncates entity_id to 255 chars', () => {
      const longId = 'a'.repeat(300);
      const result = validateLocationUpdate(validUpdate({ entity_id: longId }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.entity_id.length).toBe(255);
      }
    });
  });

  describe('haversineDistance', () => {
    it('returns 0 for identical points', () => {
      expect(haversineDistance(-33.8688, 151.2093, -33.8688, 151.2093)).toBe(0);
    });

    it('calculates known distance (Sydney to Melbourne ~714km)', () => {
      const d = haversineDistance(-33.8688, 151.2093, -37.8136, 144.9631);
      // Should be approximately 714km (within 5km tolerance)
      expect(d).toBeGreaterThan(709_000);
      expect(d).toBeLessThan(719_000);
    });

    it('calculates short distance accurately', () => {
      // ~111m per degree of latitude at equator
      const d = haversineDistance(0, 0, 0.001, 0);
      expect(d).toBeGreaterThan(100);
      expect(d).toBeLessThan(120);
    });
  });

  describe('shouldDedup', () => {
    it('returns false when no previous location', () => {
      const current = validUpdate();
      expect(shouldDedup(current, null)).toBe(false);
    });

    it('returns true when location is very close and recent', () => {
      const current = validUpdate({ lat: -33.8688, lng: 151.2093, timestamp: new Date() });
      const previous: GeoLocation = {
        time: new Date(Date.now() - 10_000), // 10s ago
        userEmail: 'user@example.com',
        providerId: 'p1',
        entityId: 'person.john',
        lat: -33.8688,
        lng: 151.2093,
        accuracyM: 10,
        altitudeM: null,
        speedMps: null,
        bearing: null,
        indoorZone: null,
        address: null,
        placeLabel: null,
        rawPayload: null,
        locationEmbedding: null,
        embeddingStatus: 'pending',
      };
      expect(shouldDedup(current, previous, 5, 30)).toBe(true);
    });

    it('returns false when location has moved significantly', () => {
      const current = validUpdate({ lat: -33.87, lng: 151.21, timestamp: new Date() });
      const previous: GeoLocation = {
        time: new Date(Date.now() - 10_000),
        userEmail: 'user@example.com',
        providerId: 'p1',
        entityId: 'person.john',
        lat: -33.86,
        lng: 151.20,
        accuracyM: 10,
        altitudeM: null,
        speedMps: null,
        bearing: null,
        indoorZone: null,
        address: null,
        placeLabel: null,
        rawPayload: null,
        locationEmbedding: null,
        embeddingStatus: 'pending',
      };
      // Distance of ~1.4km, well above default 5m threshold
      expect(shouldDedup(current, previous, 5, 30)).toBe(false);
    });

    it('returns false when enough time has passed', () => {
      const current = validUpdate({ lat: -33.8688, lng: 151.2093, timestamp: new Date() });
      const previous: GeoLocation = {
        time: new Date(Date.now() - 60_000), // 60s ago
        userEmail: 'user@example.com',
        providerId: 'p1',
        entityId: 'person.john',
        lat: -33.8688,
        lng: 151.2093,
        accuracyM: 10,
        altitudeM: null,
        speedMps: null,
        bearing: null,
        indoorZone: null,
        address: null,
        placeLabel: null,
        rawPayload: null,
        locationEmbedding: null,
        embeddingStatus: 'pending',
      };
      expect(shouldDedup(current, previous, 5, 30)).toBe(false);
    });
  });

  describe('shouldRateLimit', () => {
    it('returns false when no previous insert', () => {
      expect(shouldRateLimit(null, 10)).toBe(false);
    });

    it('returns true when interval too short', () => {
      const lastInsert = new Date(Date.now() - 5_000); // 5s ago
      expect(shouldRateLimit(lastInsert, 10)).toBe(true);
    });

    it('returns false when enough time has passed', () => {
      const lastInsert = new Date(Date.now() - 15_000); // 15s ago
      expect(shouldRateLimit(lastInsert, 10)).toBe(false);
    });

    it('returns false at exactly the minimum interval', () => {
      const lastInsert = new Date(Date.now() - 10_000); // exactly 10s ago
      expect(shouldRateLimit(lastInsert, 10)).toBe(false);
    });
  });

  describe('ingestLocationUpdate', () => {
    function mockPool(queryResults: Array<{ rows: unknown[]; rowCount: number }>): Pool {
      const queryFn = vi.fn();
      for (const r of queryResults) {
        queryFn.mockResolvedValueOnce(r);
      }
      return { query: queryFn } as unknown as Pool;
    }

    it('inserts a valid update for a matched user', async () => {
      const pool = mockPool([
        // 1. Find matching subscriptions
        { rows: [{ user_email: 'user@example.com', provider_id: 'p1' }], rowCount: 1 },
        // 2. Rate limit check - no recent insert
        { rows: [], rowCount: 0 },
        // 3. Dedup check - no recent location
        { rows: [], rowCount: 0 },
        // 4. Insert location
        { rows: [{ time: new Date() }], rowCount: 1 },
        // 5. Update last_seen_at
        { rows: [], rowCount: 0 },
      ]);

      const result = await ingestLocationUpdate(pool, 'p1', validUpdate());
      expect(result.inserted).toBe(true);
    });

    it('rejects invalid location update', async () => {
      const pool = mockPool([]);
      const result = await ingestLocationUpdate(pool, 'p1', validUpdate({ lat: 999 }));
      expect(result.inserted).toBe(false);
      expect(result.reason).toContain('Validation');
    });

    it('skips insert when rate-limited', async () => {
      const pool = mockPool([
        // 1. Find matching subscriptions
        { rows: [{ user_email: 'user@example.com', provider_id: 'p1' }], rowCount: 1 },
        // 2. Rate limit check - recent insert exists
        { rows: [{ time: new Date(Date.now() - 3_000) }], rowCount: 1 },
        // 3. Update last_seen_at
        { rows: [], rowCount: 0 },
      ]);

      const result = await ingestLocationUpdate(pool, 'p1', validUpdate());
      expect(result.inserted).toBe(false);
      expect(result.reason).toContain('rate');
    });

    it('skips insert when deduped', async () => {
      const now = new Date();
      const pool = mockPool([
        // 1. Find matching subscriptions
        { rows: [{ user_email: 'user@example.com', provider_id: 'p1' }], rowCount: 1 },
        // 2. Rate limit check - pass
        { rows: [], rowCount: 0 },
        // 3. Dedup check - identical recent location
        {
          rows: [{
            time: new Date(Date.now() - 10_000),
            lat: -33.8688,
            lng: 151.2093,
          }],
          rowCount: 1,
        },
        // 4. Update last_seen_at
        { rows: [], rowCount: 0 },
      ]);

      const result = await ingestLocationUpdate(pool, 'p1', validUpdate({ timestamp: now }));
      expect(result.inserted).toBe(false);
      expect(result.reason).toContain('dedup');
    });

    it('skips when no subscriptions match', async () => {
      const pool = mockPool([
        // 1. No matching subscriptions
        { rows: [], rowCount: 0 },
        // 2. Update last_seen_at
        { rows: [], rowCount: 0 },
      ]);

      const result = await ingestLocationUpdate(pool, 'p1', validUpdate());
      expect(result.inserted).toBe(false);
      expect(result.reason).toContain('No subscriptions');
    });
  });
});
