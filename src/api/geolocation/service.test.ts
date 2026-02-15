/**
 * Tests for geolocation service CRUD layer.
 * Issue #1245.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool, QueryResult } from 'pg';
import {
  createProvider,
  getProvider,
  listProviders,
  updateProvider,
  softDeleteProvider,
  createSubscription,
  listSubscriptions,
  updateSubscription,
  getCurrentLocation,
  getLocationHistory,
  insertLocation,
  rowToProvider,
  rowToProviderUser,
  rowToLocation,
  canDeleteProvider,
  deleteSubscriptionsByProvider,
} from './service.ts';

/** Build a mock Pool that returns the given rows for any query. */
function mockPool(rows: Record<string, unknown>[] = []): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
  } as unknown as Pool;
}

/** Build a mock Pool that returns different results per call. */
function mockPoolSequence(results: QueryResult[]): Pool {
  const queryFn = vi.fn();
  for (const r of results) {
    queryFn.mockResolvedValueOnce(r);
  }
  return { query: queryFn } as unknown as Pool;
}

const providerRow = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  owner_email: 'user@example.com',
  provider_type: 'home_assistant',
  auth_type: 'access_token',
  label: 'My HA',
  status: 'active',
  status_message: null,
  config: { url: 'https://ha.example.com' },
  credentials: 'encrypted-blob',
  poll_interval_seconds: 30,
  max_age_seconds: 300,
  is_shared: false,
  last_seen_at: new Date('2026-01-01T00:00:00Z'),
  deleted_at: null,
  created_at: new Date('2025-12-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
};

const subscriptionRow = {
  id: '660e8400-e29b-41d4-a716-446655440001',
  provider_id: '550e8400-e29b-41d4-a716-446655440001',
  user_email: 'user@example.com',
  priority: 1,
  is_active: true,
  entities: [{ id: 'person.john', subPriority: 0 }],
  created_at: new Date('2025-12-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
};

const locationRow = {
  time: new Date('2026-01-15T10:00:00Z'),
  user_email: 'user@example.com',
  provider_id: '550e8400-e29b-41d4-a716-446655440001',
  entity_id: 'person.john',
  lat: -33.8688,
  lng: 151.2093,
  accuracy_m: 10,
  altitude_m: 50,
  speed_mps: 1.5,
  bearing: 90,
  indoor_zone: null,
  address: '123 George St, Sydney',
  place_label: 'Sydney CBD',
  raw_payload: { source: 'gps' },
  location_embedding: null,
  embedding_status: 'pending',
};

describe('geolocation/service', () => {
  describe('rowToProvider', () => {
    it('maps snake_case DB row to camelCase', () => {
      const result = rowToProvider(providerRow);
      expect(result).toEqual({
        id: providerRow.id,
        ownerEmail: 'user@example.com',
        providerType: 'home_assistant',
        authType: 'access_token',
        label: 'My HA',
        status: 'active',
        statusMessage: null,
        config: { url: 'https://ha.example.com' },
        credentials: 'encrypted-blob',
        pollIntervalSeconds: 30,
        maxAgeSeconds: 300,
        isShared: false,
        lastSeenAt: providerRow.last_seen_at,
        deletedAt: null,
        createdAt: providerRow.created_at,
        updatedAt: providerRow.updated_at,
      });
    });
  });

  describe('rowToProviderUser', () => {
    it('maps snake_case DB row to camelCase', () => {
      const result = rowToProviderUser(subscriptionRow);
      expect(result).toEqual({
        id: subscriptionRow.id,
        providerId: subscriptionRow.provider_id,
        userEmail: 'user@example.com',
        priority: 1,
        isActive: true,
        entities: [{ id: 'person.john', subPriority: 0 }],
        createdAt: subscriptionRow.created_at,
        updatedAt: subscriptionRow.updated_at,
      });
    });
  });

  describe('rowToLocation', () => {
    it('maps snake_case DB row to camelCase', () => {
      const result = rowToLocation(locationRow);
      expect(result).toEqual({
        time: locationRow.time,
        userEmail: 'user@example.com',
        providerId: locationRow.provider_id,
        entityId: 'person.john',
        lat: -33.8688,
        lng: 151.2093,
        accuracyM: 10,
        altitudeM: 50,
        speedMps: 1.5,
        bearing: 90,
        indoorZone: null,
        address: '123 George St, Sydney',
        placeLabel: 'Sydney CBD',
        rawPayload: { source: 'gps' },
        locationEmbedding: null,
        embeddingStatus: 'pending',
      });
    });
  });

  describe('createProvider', () => {
    it('inserts a provider and returns mapped result', async () => {
      const pool = mockPool([providerRow]);
      const result = await createProvider(pool, {
        ownerEmail: 'user@example.com',
        providerType: 'home_assistant',
        authType: 'access_token',
        label: 'My HA',
        config: { url: 'https://ha.example.com' },
        credentials: 'encrypted-blob',
        pollIntervalSeconds: 30,
        maxAgeSeconds: 300,
        isShared: false,
      });

      expect(result.id).toBe(providerRow.id);
      expect(result.ownerEmail).toBe('user@example.com');
      const query = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(query[0]).toContain('INSERT INTO geo_provider');
    });
  });

  describe('getProvider', () => {
    it('returns mapped provider when found', async () => {
      const pool = mockPool([providerRow]);
      const result = await getProvider(pool, providerRow.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(providerRow.id);
      const query = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(query[0]).toContain('deleted_at IS NULL');
      expect(query[1]).toEqual([providerRow.id]);
    });

    it('returns null when not found', async () => {
      const pool = mockPool([]);
      const result = await getProvider(pool, 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('listProviders', () => {
    it('queries owned and subscribed providers', async () => {
      const pool = mockPool([providerRow]);
      const result = await listProviders(pool, 'user@example.com');
      expect(result).toHaveLength(1);
      expect(result[0].ownerEmail).toBe('user@example.com');
      const query = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(query[1]).toEqual(['user@example.com']);
    });
  });

  describe('updateProvider', () => {
    it('updates specified fields', async () => {
      const pool = mockPool([{ ...providerRow, label: 'Updated HA' }]);
      const result = await updateProvider(pool, providerRow.id, { label: 'Updated HA' });
      expect(result).not.toBeNull();
      expect(result!.label).toBe('Updated HA');
    });

    it('returns null if no fields to update', async () => {
      const pool = mockPool([]);
      const result = await updateProvider(pool, providerRow.id, {});
      expect(result).toBeNull();
    });
  });

  describe('softDeleteProvider', () => {
    it('sets deleted_at', async () => {
      const pool = mockPool([{ ...providerRow, deleted_at: new Date() }]);
      await softDeleteProvider(pool, providerRow.id);
      const query = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(query[0]).toContain('deleted_at = now()');
      expect(query[1]).toEqual([providerRow.id]);
    });
  });

  describe('createSubscription', () => {
    it('inserts a subscription and returns mapped result', async () => {
      const pool = mockPool([subscriptionRow]);
      const result = await createSubscription(pool, {
        providerId: subscriptionRow.provider_id,
        userEmail: 'user@example.com',
        priority: 1,
        isActive: true,
        entities: [{ id: 'person.john', subPriority: 0 }],
      });
      expect(result.providerId).toBe(subscriptionRow.provider_id);
      const query = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(query[0]).toContain('INSERT INTO geo_provider_user');
    });
  });

  describe('listSubscriptions', () => {
    it('returns subscriptions for user', async () => {
      const pool = mockPool([subscriptionRow]);
      const result = await listSubscriptions(pool, 'user@example.com');
      expect(result).toHaveLength(1);
      expect(result[0].userEmail).toBe('user@example.com');
    });
  });

  describe('updateSubscription', () => {
    it('updates specified fields', async () => {
      const pool = mockPool([{ ...subscriptionRow, priority: 2 }]);
      const result = await updateSubscription(pool, subscriptionRow.id, { priority: 2 });
      expect(result).not.toBeNull();
    });

    it('returns null if no fields to update', async () => {
      const pool = mockPool([]);
      const result = await updateSubscription(pool, subscriptionRow.id, {});
      expect(result).toBeNull();
    });
  });

  describe('getCurrentLocation', () => {
    it('returns best current location for user', async () => {
      const pool = mockPool([locationRow]);
      const result = await getCurrentLocation(pool, 'user@example.com');
      expect(result).not.toBeNull();
      expect(result!.lat).toBe(-33.8688);
      const query = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(query[0]).toContain('geo_provider_user');
      expect(query[0]).toContain('geo_location');
      expect(query[0]).toContain('ORDER BY');
      expect(query[0]).toContain('LIMIT 1');
    });

    it('returns null when no location found', async () => {
      const pool = mockPool([]);
      const result = await getCurrentLocation(pool, 'user@example.com');
      expect(result).toBeNull();
    });
  });

  describe('getLocationHistory', () => {
    it('returns locations within time range', async () => {
      const pool = mockPool([locationRow]);
      const from = new Date('2026-01-01T00:00:00Z');
      const to = new Date('2026-02-01T00:00:00Z');
      const result = await getLocationHistory(pool, 'user@example.com', from, to, 100);
      expect(result).toHaveLength(1);
      const query = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(query[1]).toEqual(['user@example.com', from, to, 100]);
    });
  });

  describe('insertLocation', () => {
    it('inserts a location record', async () => {
      const pool = mockPool([locationRow]);
      await insertLocation(pool, {
        time: locationRow.time,
        userEmail: 'user@example.com',
        providerId: locationRow.provider_id,
        entityId: 'person.john',
        lat: -33.8688,
        lng: 151.2093,
        accuracyM: 10,
        altitudeM: 50,
        speedMps: 1.5,
        bearing: 90,
        indoorZone: null,
        address: null,
        placeLabel: null,
        rawPayload: { source: 'gps' },
      });
      const query = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(query[0]).toContain('INSERT INTO geo_location');
    });
  });

  describe('canDeleteProvider', () => {
    it('allows deleting a non-shared provider', async () => {
      // First query: get provider (non-shared)
      // Second query: subscriber count (irrelevant for non-shared)
      const pool = mockPoolSequence([
        { rows: [{ ...providerRow, is_shared: false }], rowCount: 1 } as QueryResult,
        { rows: [{ count: '0' }], rowCount: 1 } as QueryResult,
      ]);
      const result = await canDeleteProvider(pool, providerRow.id);
      expect(result.canDelete).toBe(true);
    });

    it('allows deleting a shared provider with no other subscribers', async () => {
      const pool = mockPoolSequence([
        { rows: [{ ...providerRow, is_shared: true }], rowCount: 1 } as QueryResult,
        { rows: [{ count: '0' }], rowCount: 1 } as QueryResult,
      ]);
      const result = await canDeleteProvider(pool, providerRow.id);
      expect(result.canDelete).toBe(true);
    });

    it('blocks deleting a shared provider with other subscribers', async () => {
      const pool = mockPoolSequence([
        { rows: [{ ...providerRow, is_shared: true }], rowCount: 1 } as QueryResult,
        { rows: [{ count: '3' }], rowCount: 1 } as QueryResult,
      ]);
      const result = await canDeleteProvider(pool, providerRow.id);
      expect(result.canDelete).toBe(false);
      expect(result.subscriberCount).toBe(3);
      expect(result.reason).toContain('subscriber');
    });

    it('returns canDelete false when provider not found', async () => {
      const pool = mockPoolSequence([
        { rows: [], rowCount: 0 } as unknown as QueryResult,
      ]);
      const result = await canDeleteProvider(pool, 'nonexistent-id');
      expect(result.canDelete).toBe(false);
      expect(result.reason).toContain('not found');
    });
  });

  describe('deleteSubscriptionsByProvider', () => {
    it('deletes all subscriptions for a provider', async () => {
      const pool = mockPool([]);
      await deleteSubscriptionsByProvider(pool, providerRow.id);
      const query = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(query[0]).toContain('DELETE FROM geo_provider_user');
      expect(query[0]).toContain('provider_id');
      expect(query[1]).toEqual([providerRow.id]);
    });
  });
});
