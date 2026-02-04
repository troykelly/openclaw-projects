/**
 * Tests for the relationship type API endpoints.
 * Part of Epic #486, Issue #490
 *
 * TDD: These tests are written before the API route implementation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool } from './helpers/db.ts';

describe('Relationship Types API (Epic #486, Issue #490)', () => {
  const app = buildServer();
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('GET /api/relationship-types', () => {
    it('returns all pre-seeded relationship types', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/relationship-types',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.types).toBeDefined();
      expect(body.total).toBe(32);
      expect(body.types.length).toBe(32);
    });

    it('each type has expected fields', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/relationship-types',
        query: { limit: '1' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const type = body.types[0];

      expect(type.id).toBeDefined();
      expect(type.name).toBeDefined();
      expect(type.label).toBeDefined();
      expect(typeof type.isDirectional).toBe('boolean');
      expect(type.embeddingStatus).toBeDefined();
      expect(type.createdAt).toBeDefined();
      expect(type.updatedAt).toBeDefined();
    });

    it('filters by is_directional=true', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/relationship-types',
        query: { is_directional: 'true' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(26);

      for (const type of body.types) {
        expect(type.isDirectional).toBe(true);
      }
    });

    it('filters by is_directional=false', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/relationship-types',
        query: { is_directional: 'false' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(6);

      for (const type of body.types) {
        expect(type.isDirectional).toBe(false);
      }
    });

    it('supports pagination', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/relationship-types',
        query: { limit: '5', offset: '0' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.types.length).toBe(5);
      expect(body.total).toBe(32);
    });

    it('directional types include inverse type details', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/relationship-types',
        query: { is_directional: 'true', limit: '5' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      for (const type of body.types) {
        expect(type.inverseType).toBeDefined();
        expect(type.inverseType).not.toBeNull();
        expect(type.inverseType.id).toBeDefined();
        expect(type.inverseType.name).toBeDefined();
        expect(type.inverseType.label).toBeDefined();
      }
    });
  });

  describe('GET /api/relationship-types/:id', () => {
    it('returns a specific relationship type', async () => {
      // First get the list to find an ID
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/relationship-types',
        query: { limit: '1' },
      });
      const typeId = listRes.json().types[0].id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/relationship-types/${typeId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(typeId);
      expect(body.name).toBeDefined();
      expect(body.label).toBeDefined();
    });

    it('returns 404 for non-existent ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/relationship-types/00000000-0000-0000-0000-000000000000',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/relationship-types', () => {
    it('creates a new relationship type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/relationship-types',
        payload: {
          name: 'api_test_neighbor_of',
          label: 'Neighbor of',
          is_directional: false,
          description: 'Lives nearby',
          created_by_agent: 'test-agent',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.name).toBe('api_test_neighbor_of');
      expect(body.label).toBe('Neighbor of');
      expect(body.isDirectional).toBe(false);
      expect(body.description).toBe('Lives nearby');
      expect(body.createdByAgent).toBe('test-agent');
      expect(body.embeddingStatus).toBe('pending');

      // Clean up
      await pool.query('DELETE FROM relationship_type WHERE id = $1', [body.id]);
    });

    it('creates a directional pair with inverse', async () => {
      // Create first type
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/relationship-types',
        payload: {
          name: 'api_test_teaches',
          label: 'Teaches',
          is_directional: true,
          created_by_agent: 'test-agent',
        },
      });

      expect(res1.statusCode).toBe(201);
      const type1 = res1.json();

      // Create inverse, linking to first
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/relationship-types',
        payload: {
          name: 'api_test_taught_by',
          label: 'Taught by',
          is_directional: true,
          inverse_type_name: 'api_test_teaches',
          created_by_agent: 'test-agent',
        },
      });

      expect(res2.statusCode).toBe(201);
      const type2 = res2.json();
      expect(type2.inverseTypeId).toBe(type1.id);

      // Verify first type now points back
      const verifyRes = await app.inject({
        method: 'GET',
        url: `/api/relationship-types/${type1.id}`,
      });
      expect(verifyRes.json().inverseTypeId).toBe(type2.id);

      // Clean up
      await pool.query('DELETE FROM relationship_type WHERE id = ANY($1)', [[type1.id, type2.id]]);
    });

    it('returns 400 when name is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/relationship-types',
        payload: {
          label: 'No name',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when label is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/relationship-types',
        payload: {
          name: 'api_test_no_label',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 409 for duplicate name', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/relationship-types',
        payload: {
          name: 'partner_of',
          label: 'Duplicate Partner',
        },
      });

      expect(res.statusCode).toBe(409);
    });
  });

  describe('GET /api/relationship-types/match', () => {
    it('finds matching types by query', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/relationship-types/match',
        query: { q: 'partner' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results).toBeDefined();
      expect(body.results.length).toBeGreaterThan(0);

      const partnerMatch = body.results.find(
        (r: { type: { name: string } }) => r.type.name === 'partner_of'
      );
      expect(partnerMatch).toBeDefined();
    });

    it('returns 400 when q parameter is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/relationship-types/match',
      });

      expect(res.statusCode).toBe(400);
    });

    it('supports limit parameter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/relationship-types/match',
        query: { q: 'of', limit: '3' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.length).toBeLessThanOrEqual(3);
    });
  });
});
