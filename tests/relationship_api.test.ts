/**
 * Tests for the relationship API endpoints.
 * Part of Epic #486, Issue #491
 *
 * TDD: Tests written before the API route implementation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.js';
import { createTestPool, truncateAllTables } from './helpers/db.js';

/** Helper: create a test contact via API */
async function createContactViaApi(
  app: ReturnType<typeof buildServer>,
  displayName: string,
  contactKind = 'person'
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/contacts',
    payload: { displayName, contactKind },
  });
  return (res.json() as { id: string }).id;
}

/** Helper: get relationship type ID by name */
async function getTypeId(pool: Pool, name: string): Promise<string> {
  const result = await pool.query(
    `SELECT id::text as id FROM relationship_type WHERE name = $1`,
    [name]
  );
  return (result.rows[0] as { id: string }).id;
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
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('POST /api/relationships', () => {
    it('creates a relationship between two contacts', async () => {
      const aliceId = await createContactViaApi(app, 'Alice');
      const bobId = await createContactViaApi(app, 'Bob');
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
      expect(body.contactAId).toBe(aliceId);
      expect(body.contactBId).toBe(bobId);
      expect(body.relationshipTypeId).toBe(friendTypeId);
      expect(body.notes).toBe('Good friends');
    });

    it('returns 400 when contact_a_id is missing', async () => {
      const bobId = await createContactViaApi(app, 'Bob');
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
      const aliceId = await createContactViaApi(app, 'Alice');
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
      const aliceId = await createContactViaApi(app, 'Alice');
      const bobId = await createContactViaApi(app, 'Bob');

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
      const aliceId = await createContactViaApi(app, 'Alice');
      const bobId = await createContactViaApi(app, 'Bob');
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
      const aliceId = await createContactViaApi(app, 'Alice');
      const bobId = await createContactViaApi(app, 'Bob');
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
      expect(body.contactAName).toBe('Alice');
      expect(body.contactBName).toBe('Bob');
      expect(body.relationshipType.name).toBe('friend_of');
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
      const aliceId = await createContactViaApi(app, 'Alice');
      const bobId = await createContactViaApi(app, 'Bob');
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
      const aliceId = await createContactViaApi(app, 'Alice');
      const bobId = await createContactViaApi(app, 'Bob');
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
      const aliceId = await createContactViaApi(app, 'Alice');
      const bobId = await createContactViaApi(app, 'Bob');
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
      const aliceId = await createContactViaApi(app, 'Alice');
      const bobId = await createContactViaApi(app, 'Bob');
      const charlieId = await createContactViaApi(app, 'Charlie');
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
      const aliceId = await createContactViaApi(app, 'Alice');
      const bobId = await createContactViaApi(app, 'Bob');
      const charlieId = await createContactViaApi(app, 'Charlie');
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
      const aliceId = await createContactViaApi(app, 'Alice');
      const bobId = await createContactViaApi(app, 'Bob');
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
      expect(body.contactId).toBe(aliceId);
      expect(body.relatedContacts.length).toBe(1);
      expect(body.relatedContacts[0].contactName).toBe('Bob');
      expect(body.relatedContacts[0].relationshipTypeName).toBe('friend_of');
    });

    it('resolves directional inverse types', async () => {
      const parentId = await createContactViaApi(app, 'Parent');
      const childId = await createContactViaApi(app, 'Child');
      const parentTypeId = await getTypeId(pool, 'parent_of');

      await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: {
          contact_a_id: parentId,
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
      expect(body.relatedContacts.length).toBe(1);
      expect(body.relatedContacts[0].contactName).toBe('Parent');
      expect(body.relatedContacts[0].relationshipTypeName).toBe('child_of');
    });
  });

  describe('GET /api/contacts/:id/groups', () => {
    it('returns groups the contact belongs to', async () => {
      const groupId = await createContactViaApi(app, 'Team', 'group');
      const aliceId = await createContactViaApi(app, 'Alice');
      const hasMemberTypeId = await getTypeId(pool, 'has_member');

      await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: {
          contact_a_id: groupId,
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
      expect(body.groups[0].groupName).toBe('Team');
    });
  });

  describe('GET /api/contacts/:id/members', () => {
    it('returns members of a group contact', async () => {
      const groupId = await createContactViaApi(app, 'Team', 'group');
      const aliceId = await createContactViaApi(app, 'Alice');
      const bobId = await createContactViaApi(app, 'Bob');
      const hasMemberTypeId = await getTypeId(pool, 'has_member');

      await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: {
          contact_a_id: groupId,
          contact_b_id: aliceId,
          relationship_type_id: hasMemberTypeId,
        },
      });
      await app.inject({
        method: 'POST',
        url: '/api/relationships',
        payload: {
          contact_a_id: groupId,
          contact_b_id: bobId,
          relationship_type_id: hasMemberTypeId,
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/contacts/${groupId}/members`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.members.length).toBe(2);
      const names = body.members.map((m: { memberName: string }) => m.memberName);
      expect(names).toContain('Alice');
      expect(names).toContain('Bob');
    });
  });

  describe('POST /api/relationships/set', () => {
    it('creates relationship via smart creation', async () => {
      await createContactViaApi(app, 'Alice');
      await createContactViaApi(app, 'Bob');

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
      expect(body.contactA.displayName).toBe('Alice');
      expect(body.contactB.displayName).toBe('Bob');
      expect(body.relationshipType.name).toBe('friend_of');
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
      await createContactViaApi(app, 'Alice');

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
