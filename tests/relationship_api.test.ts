/**
 * Tests for the relationship API endpoints.
 * Part of Epic #486, Issue #491
 *
 * TDD: Tests written before the API route implementation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

/** Helper: create a test contact directly in the DB.
 *  Works whether or not contact_kind column exists (separate 044 migration). */
async function createContactDirect(pool: Pool, display_name: string, kind = 'person'): Promise<string> {
  const colCheck = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'contact' AND column_name = 'contact_kind'`,
  );
  const hasContactKind = colCheck.rows.length > 0;

  if (hasContactKind) {
    const result = await pool.query(
      `INSERT INTO contact (display_name, contact_kind)
       VALUES ($1, $2::contact_kind)
       RETURNING id::text as id`,
      [display_name, kind],
    );
    return (result.rows[0] as { id: string }).id;
  }

  const result = await pool.query(
    `INSERT INTO contact (display_name)
     VALUES ($1)
     RETURNING id::text as id`,
    [display_name],
  );
  return (result.rows[0] as { id: string }).id;
}

/** Helper: get relationship type ID by name */
async function getTypeId(pool: Pool, name: string): Promise<string> {
  const result = await pool.query(`SELECT id::text as id FROM relationship_type WHERE name = $1`, [name]);
  if (result.rows.length === 0) {
    throw new Error(`Relationship type '${name}' not found in database`);
  }
  return (result.rows[0] as { id: string }).id;
}

/**
 * Ensure required relationship types exist in the database.
 * Migration 046 seeds these, but if the table was ever truncated by another
 * test run the seed data is lost. This function re-seeds only the types
 * needed by the tests in this file (using ON CONFLICT DO NOTHING for safety).
 */
async function seedRequiredRelationshipTypes(pool: Pool): Promise<void> {
  // Symmetric types used by tests
  await pool.query(
    `INSERT INTO relationship_type (name, label, is_directional, description) VALUES
       ('friend_of', 'Friend of', false, 'Friendship or close social bond.'),
       ('colleague_of', 'Colleague of', false, 'Colleague or coworker.')
     ON CONFLICT (name) DO NOTHING`,
  );

  // Directional pair: parent_of / child_of
  await pool.query(
    `INSERT INTO relationship_type (name, label, is_directional, description) VALUES
       ('parent_of', 'Parent of', true, 'Parent relationship.'),
       ('child_of', 'Child of', true, 'Child relationship.')
     ON CONFLICT (name) DO NOTHING`,
  );
  await pool.query(
    `UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'child_of')
     WHERE name = 'parent_of' AND inverse_type_id IS NULL`,
  );
  await pool.query(
    `UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'parent_of')
     WHERE name = 'child_of' AND inverse_type_id IS NULL`,
  );

  // Directional pair: has_member / member_of
  await pool.query(
    `INSERT INTO relationship_type (name, label, is_directional, description) VALUES
       ('has_member', 'Has member', true, 'Group has a member.'),
       ('member_of', 'Member of', true, 'Member of a group.')
     ON CONFLICT (name) DO NOTHING`,
  );
  await pool.query(
    `UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'member_of')
     WHERE name = 'has_member' AND inverse_type_id IS NULL`,
  );
  await pool.query(
    `UPDATE relationship_type SET inverse_type_id = (SELECT id FROM relationship_type WHERE name = 'has_member')
     WHERE name = 'member_of' AND inverse_type_id IS NULL`,
  );
}

describe('Relationships API (Epic #486, Issue #491)', () => {
  const app = buildServer();
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    await seedRequiredRelationshipTypes(pool);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('POST /api/relationships', () => {
    it('creates a relationship between two contacts', async () => {
      const aliceId = await createContactDirect(pool, 'Alice');
      const bobId = await createContactDirect(pool, 'Bob');
      const friendTypeId = await getTypeId(pool, 'friend_of');

      const res = await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: {
          contact_a_id: aliceId,
          contact_b_id: bobId,
          relationship_type_id: friendTypeId,
          notes: 'Good friends',
          created_by_agent: 'test-agent',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.contact_a_id).toBe(aliceId);
      expect(body.contact_b_id).toBe(bobId);
      expect(body.relationship_type_id).toBe(friendTypeId);
      expect(body.notes).toBe('Good friends');
    });

    it('returns 400 when contact_a_id is missing', async () => {
      const bobId = await createContactDirect(pool, 'Bob');
      const friendTypeId = await getTypeId(pool, 'friend_of');

      const res = await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: {
          contact_b_id: bobId,
          relationship_type_id: friendTypeId,
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when contact_b_id is missing', async () => {
      const aliceId = await createContactDirect(pool, 'Alice');
      const friendTypeId = await getTypeId(pool, 'friend_of');

      const res = await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: {
          contact_a_id: aliceId,
          relationship_type_id: friendTypeId,
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when relationship_type_id is missing', async () => {
      const aliceId = await createContactDirect(pool, 'Alice');
      const bobId = await createContactDirect(pool, 'Bob');

      const res = await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: {
          contact_a_id: aliceId,
          contact_b_id: bobId,
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 409 for duplicate relationship', async () => {
      const aliceId = await createContactDirect(pool, 'Alice');
      const bobId = await createContactDirect(pool, 'Bob');
      const friendTypeId = await getTypeId(pool, 'friend_of');

      await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: {
          contact_a_id: aliceId,
          contact_b_id: bobId,
          relationship_type_id: friendTypeId,
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: {
          contact_a_id: aliceId,
          contact_b_id: bobId,
          relationship_type_id: friendTypeId,
        },
      });

      expect(res.statusCode).toBe(409);
    });
  });

  describe('GET /api/relationships/:id', () => {
    it('returns a relationship with details', async () => {
      const aliceId = await createContactDirect(pool, 'Alice');
      const bobId = await createContactDirect(pool, 'Bob');
      const friendTypeId = await getTypeId(pool, 'friend_of');

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: {
          contact_a_id: aliceId,
          contact_b_id: bobId,
          relationship_type_id: friendTypeId,
        },
      });
      const relId = createRes.json().id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/relationships/${relId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(relId);
      expect(body.contact_a_name).toBe('Alice');
      expect(body.contact_b_name).toBe('Bob');
      expect(body.relationship_type.name).toBe('friend_of');
    });

    it('returns 404 for non-existent ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/relationships/00000000-0000-0000-0000-000000000000',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('PATCH /api/relationships/:id', () => {
    it('updates relationship notes', async () => {
      const aliceId = await createContactDirect(pool, 'Alice');
      const bobId = await createContactDirect(pool, 'Bob');
      const friendTypeId = await getTypeId(pool, 'friend_of');

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: {
          contact_a_id: aliceId,
          contact_b_id: bobId,
          relationship_type_id: friendTypeId,
          notes: 'Original',
        },
      });
      const relId = createRes.json().id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/relationships/${relId}`,
        payload: { notes: 'Updated notes' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().notes).toBe('Updated notes');
    });

    it('returns 404 for non-existent ID', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/relationships/00000000-0000-0000-0000-000000000000',
        payload: { notes: 'Nope' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/relationships/:id', () => {
    it('deletes a relationship', async () => {
      const aliceId = await createContactDirect(pool, 'Alice');
      const bobId = await createContactDirect(pool, 'Bob');
      const friendTypeId = await getTypeId(pool, 'friend_of');

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: {
          contact_a_id: aliceId,
          contact_b_id: bobId,
          relationship_type_id: friendTypeId,
        },
      });
      const relId = createRes.json().id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/relationships/${relId}`,
      });

      expect(res.statusCode).toBe(204);

      // Verify it's gone
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/relationships/${relId}`,
      });
      expect(getRes.statusCode).toBe(404);
    });

    it('returns 404 for non-existent ID', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/relationships/00000000-0000-0000-0000-000000000000',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/relationships', () => {
    it('lists all relationships', async () => {
      const aliceId = await createContactDirect(pool, 'Alice');
      const bobId = await createContactDirect(pool, 'Bob');
      const friendTypeId = await getTypeId(pool, 'friend_of');

      await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: {
          contact_a_id: aliceId,
          contact_b_id: bobId,
          relationship_type_id: friendTypeId,
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/relationships',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(1);
      expect(body.relationships.length).toBe(1);
    });

    it('filters by contact_id', async () => {
      const aliceId = await createContactDirect(pool, 'Alice');
      const bobId = await createContactDirect(pool, 'Bob');
      const charlieId = await createContactDirect(pool, 'Charlie');
      const friendTypeId = await getTypeId(pool, 'friend_of');

      await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: { contact_a_id: aliceId, contact_b_id: bobId, relationship_type_id: friendTypeId },
      });
      await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: { contact_a_id: bobId, contact_b_id: charlieId, relationship_type_id: friendTypeId },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/relationships',
        query: { contact_id: bobId },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().total).toBe(2);
    });

    it('supports pagination', async () => {
      const aliceId = await createContactDirect(pool, 'Alice');
      const bobId = await createContactDirect(pool, 'Bob');
      const charlieId = await createContactDirect(pool, 'Charlie');
      const friendTypeId = await getTypeId(pool, 'friend_of');
      const colleagueTypeId = await getTypeId(pool, 'colleague_of');

      await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: { contact_a_id: aliceId, contact_b_id: bobId, relationship_type_id: friendTypeId },
      });
      await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: { contact_a_id: aliceId, contact_b_id: charlieId, relationship_type_id: colleagueTypeId },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/relationships',
        query: { limit: '1', offset: '0' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.relationships.length).toBe(1);
      expect(body.total).toBe(2);
    });
  });

  describe('GET /api/contacts/:id/relationships', () => {
    it('returns graph traversal for a contact', async () => {
      const aliceId = await createContactDirect(pool, 'Alice');
      const bobId = await createContactDirect(pool, 'Bob');
      const friendTypeId = await getTypeId(pool, 'friend_of');

      await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: {
          contact_a_id: aliceId,
          contact_b_id: bobId,
          relationship_type_id: friendTypeId,
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/contacts/${aliceId}/relationships`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.contact_id).toBe(aliceId);
      expect(body.related_contacts.length).toBe(1);
      expect(body.related_contacts[0].contact_name).toBe('Bob');
      expect(body.related_contacts[0].relationship_type_name).toBe('friend_of');
    });

    it('resolves directional inverse types', async () => {
      const parent_id = await createContactDirect(pool, 'Parent');
      const childId = await createContactDirect(pool, 'Child');
      const parentTypeId = await getTypeId(pool, 'parent_of');

      await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: {
          contact_a_id: parent_id,
          contact_b_id: childId,
          relationship_type_id: parentTypeId,
        },
      });

      // From child's perspective: should show "child_of Parent"
      const res = await app.inject({
        method: 'GET',
        url: `/api/contacts/${childId}/relationships`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.related_contacts.length).toBe(1);
      expect(body.related_contacts[0].contact_name).toBe('Parent');
      expect(body.related_contacts[0].relationship_type_name).toBe('child_of');
    });
  });

  describe('GET /api/contacts/:id/groups', () => {
    it('returns groups the contact belongs to', async () => {
      const group_id = await createContactDirect(pool, 'Team', 'group');
      const aliceId = await createContactDirect(pool, 'Alice');
      const hasMemberTypeId = await getTypeId(pool, 'has_member');

      await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: {
          contact_a_id: group_id,
          contact_b_id: aliceId,
          relationship_type_id: hasMemberTypeId,
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/contacts/${aliceId}/groups`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.groups.length).toBe(1);
      expect(body.groups[0].group_name).toBe('Team');
    });
  });

  describe('GET /api/contacts/:id/members', () => {
    it('returns members of a group contact', async () => {
      const group_id = await createContactDirect(pool, 'Team', 'group');
      const aliceId = await createContactDirect(pool, 'Alice');
      const bobId = await createContactDirect(pool, 'Bob');
      const hasMemberTypeId = await getTypeId(pool, 'has_member');

      await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: {
          contact_a_id: group_id,
          contact_b_id: aliceId,
          relationship_type_id: hasMemberTypeId,
        },
      });
      await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: {
          contact_a_id: group_id,
          contact_b_id: bobId,
          relationship_type_id: hasMemberTypeId,
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/contacts/${group_id}/members`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.members.length).toBe(2);
      const names = body.members.map((m: { member_name: string }) => m.member_name);
      expect(names).toContain('Alice');
      expect(names).toContain('Bob');
    });
  });

  describe('POST /api/relationships/set', () => {
    it('creates relationship via smart creation', async () => {
      await createContactDirect(pool, 'Alice');
      await createContactDirect(pool, 'Bob');

      const res = await app.inject({
        method: 'POST',
        url: '/api/relationships/set',
        payload: {
          contact_a: 'Alice',
          contact_b: 'Bob',
          relationship_type: 'friend_of',
          notes: 'Smart creation',
          created_by_agent: 'test-agent',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.created).toBe(true);
      expect(body.contact_a.display_name).toBe('Alice');
      expect(body.contact_b.display_name).toBe('Bob');
      expect(body.relationship_type.name).toBe('friend_of');
    });

    it('returns 400 when contact_a is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/relationships/set',
        payload: {
          contact_b: 'Bob',
          relationship_type: 'friend_of',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 when contact cannot be resolved', async () => {
      await createContactDirect(pool, 'Alice');

      const res = await app.inject({
        method: 'POST',
        url: '/api/relationships/set',
        payload: {
          contact_a: 'Alice',
          contact_b: 'NonexistentPerson',
          relationship_type: 'friend_of',
        },
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
