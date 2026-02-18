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

/**
 * Ensure all 32 pre-seeded relationship types exist in the database.
 * Migration 046 seeds these, but if the table was ever truncated by another
 * test run the seed data is lost. This function re-seeds all types
 * (using ON CONFLICT DO NOTHING for safety).
 */
async function seedAllRelationshipTypes(pool: Pool): Promise<void> {
  // Symmetric types (6)
  await pool.query(
    `INSERT INTO relationship_type (name, label, is_directional, description) VALUES
       ('partner_of', 'Partner of', false, 'Romantic or life partner.'),
       ('sibling_of', 'Sibling of', false, 'Sibling relationship.'),
       ('friend_of', 'Friend of', false, 'Friendship or close social bond.'),
       ('colleague_of', 'Colleague of', false, 'Colleague or coworker.'),
       ('housemate_of', 'Housemate of', false, 'Shares a dwelling.'),
       ('co_parent_of', 'Co-parent of', false, 'Shares parenting responsibilities.')
     ON CONFLICT (name) DO NOTHING`,
  );

  // Directional types (26)
  await pool.query(
    `INSERT INTO relationship_type (name, label, is_directional, description) VALUES
       ('parent_of', 'Parent of', true, 'Parent relationship.'),
       ('child_of', 'Child of', true, 'Child relationship.'),
       ('grandparent_of', 'Grandparent of', true, 'Grandparent relationship.'),
       ('grandchild_of', 'Grandchild of', true, 'Grandchild relationship.'),
       ('cares_for', 'Cares for', true, 'Provides care.'),
       ('cared_for_by', 'Cared for by', true, 'Receives care.'),
       ('employs', 'Employs', true, 'Employer relationship.'),
       ('employed_by', 'Employed by', true, 'Employee relationship.'),
       ('manages', 'Manages', true, 'Direct management.'),
       ('managed_by', 'Managed by', true, 'Reports to.'),
       ('mentor_of', 'Mentor of', true, 'Mentorship relationship.'),
       ('mentee_of', 'Mentee of', true, 'Mentee relationship.'),
       ('elder_of', 'Elder of', true, 'Elder figure.'),
       ('junior_of', 'Junior of', true, 'Junior member.'),
       ('member_of', 'Member of', true, 'Member of a group.'),
       ('has_member', 'Has member', true, 'Group that has a member.'),
       ('founder_of', 'Founder of', true, 'Founded an org.'),
       ('founded_by', 'Founded by', true, 'Founded by someone.'),
       ('client_of', 'Client of', true, 'Client of a service provider.'),
       ('has_client', 'Has client', true, 'Has a client.'),
       ('vendor_of', 'Vendor of', true, 'Vendor to a client.'),
       ('has_vendor', 'Has vendor', true, 'Has a vendor.'),
       ('assigned_to', 'Assigned to', true, 'Assigned to an agent.'),
       ('manages_agent', 'Manages agent', true, 'Agent that manages a person.'),
       ('owned_by', 'Owned by', true, 'Owned by a person.'),
       ('owns', 'Owns', true, 'Owns an entity.')
     ON CONFLICT (name) DO NOTHING`,
  );

  // Link inverse types for all 13 directional pairs
  const inversePairs: [string, string][] = [
    ['parent_of', 'child_of'],
    ['grandparent_of', 'grandchild_of'],
    ['cares_for', 'cared_for_by'],
    ['employs', 'employed_by'],
    ['manages', 'managed_by'],
    ['mentor_of', 'mentee_of'],
    ['elder_of', 'junior_of'],
    ['has_member', 'member_of'],
    ['founder_of', 'founded_by'],
    ['client_of', 'has_client'],
    ['vendor_of', 'has_vendor'],
    ['assigned_to', 'manages_agent'],
    ['owned_by', 'owns'],
  ];

  for (const [a, b] of inversePairs) {
    await pool.query(
      `UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = $2)
       WHERE name = $1 AND inverse_type_id IS NULL`,
      [a, b],
    );
    await pool.query(
      `UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = $1)
       WHERE name = $2 AND inverse_type_id IS NULL`,
      [a, b],
    );
  }
}

describe('Relationship Types API (Epic #486, Issue #490)', () => {
  const app = buildServer();
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await seedAllRelationshipTypes(pool);
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
      expect(typeof type.is_directional).toBe('boolean');
      expect(type.embedding_status).toBeDefined();
      expect(type.created_at).toBeDefined();
      expect(type.updated_at).toBeDefined();
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
        expect(type.is_directional).toBe(true);
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
        expect(type.is_directional).toBe(false);
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
        expect(type.inverse_type).toBeDefined();
        expect(type.inverse_type).not.toBeNull();
        expect(type.inverse_type.id).toBeDefined();
        expect(type.inverse_type.name).toBeDefined();
        expect(type.inverse_type.label).toBeDefined();
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
      expect(body.is_directional).toBe(false);
      expect(body.description).toBe('Lives nearby');
      expect(body.created_by_agent).toBe('test-agent');
      expect(body.embedding_status).toBe('pending');

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
      expect(type2.inverse_type_id).toBe(type1.id);

      // Verify first type now points back
      const verifyRes = await app.inject({
        method: 'GET',
        url: `/api/relationship-types/${type1.id}`,
      });
      expect(verifyRes.json().inverse_type_id).toBe(type2.id);

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

      const partnerMatch = body.results.find((r: { type: { name: string } }) => r.type.name === 'partner_of');
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
