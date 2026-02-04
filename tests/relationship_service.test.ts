/**
 * Tests for the relationship service.
 * Part of Epic #486, Issue #491
 *
 * TDD: Tests written before service implementation.
 * Covers CRUD, graph traversal, group membership, and smart creation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.js';
import { createTestPool, truncateAllTables } from './helpers/db.js';

import {
  createRelationship,
  getRelationship,
  updateRelationship,
  deleteRelationship,
  listRelationships,
  getRelatedContacts,
  getGroupMembers,
  getContactGroups,
  relationshipSet,
} from '../src/api/relationships/index.ts';

import {
  getRelationshipTypeByName,
} from '../src/api/relationship-types/index.ts';

/** Helper: create a test contact and return its ID.
 *  Supports both schemas: with and without contact_kind column. */
async function createContact(pool: Pool, displayName: string, kind = 'person'): Promise<string> {
  // Check if contact_kind column exists (it's from a separate 044 migration)
  const colCheck = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'contact' AND column_name = 'contact_kind'`
  );
  const hasContactKind = colCheck.rows.length > 0;

  if (hasContactKind) {
    const result = await pool.query(
      `INSERT INTO contact (display_name, contact_kind)
       VALUES ($1, $2::contact_kind)
       RETURNING id::text as id`,
      [displayName, kind]
    );
    return (result.rows[0] as { id: string }).id;
  }

  const result = await pool.query(
    `INSERT INTO contact (display_name)
     VALUES ($1)
     RETURNING id::text as id`,
    [displayName]
  );
  return (result.rows[0] as { id: string }).id;
}

describe('Relationship Service (Epic #486, Issue #491)', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('createRelationship', () => {
    it('creates a symmetric relationship between two contacts', async () => {
      const contactAId = await createContact(pool, 'Alice');
      const contactBId = await createContact(pool, 'Bob');
      const partnerType = await getRelationshipTypeByName(pool, 'partner_of');

      const rel = await createRelationship(pool, {
        contactAId,
        contactBId,
        relationshipTypeId: partnerType!.id,
        notes: 'Met in college',
        createdByAgent: 'test-agent',
      });

      expect(rel.id).toBeDefined();
      expect(rel.contactAId).toBe(contactAId);
      expect(rel.contactBId).toBe(contactBId);
      expect(rel.relationshipTypeId).toBe(partnerType!.id);
      expect(rel.notes).toBe('Met in college');
      expect(rel.createdByAgent).toBe('test-agent');
      expect(rel.embeddingStatus).toBe('pending');
      expect(rel.createdAt).toBeInstanceOf(Date);
      expect(rel.updatedAt).toBeInstanceOf(Date);
    });

    it('creates a directional relationship', async () => {
      const parentId = await createContact(pool, 'Parent');
      const childId = await createContact(pool, 'Child');
      const parentType = await getRelationshipTypeByName(pool, 'parent_of');

      const rel = await createRelationship(pool, {
        contactAId: parentId,
        contactBId: childId,
        relationshipTypeId: parentType!.id,
      });

      expect(rel.contactAId).toBe(parentId);
      expect(rel.contactBId).toBe(childId);
      expect(rel.relationshipTypeId).toBe(parentType!.id);
    });

    it('rejects self-relationships', async () => {
      const contactId = await createContact(pool, 'Solo');
      const friendType = await getRelationshipTypeByName(pool, 'friend_of');

      await expect(
        createRelationship(pool, {
          contactAId: contactId,
          contactBId: contactId,
          relationshipTypeId: friendType!.id,
        })
      ).rejects.toThrow();
    });

    it('rejects duplicate relationships (same contacts, same type)', async () => {
      const contactAId = await createContact(pool, 'Alice');
      const contactBId = await createContact(pool, 'Bob');
      const friendType = await getRelationshipTypeByName(pool, 'friend_of');

      await createRelationship(pool, {
        contactAId,
        contactBId,
        relationshipTypeId: friendType!.id,
      });

      await expect(
        createRelationship(pool, {
          contactAId,
          contactBId,
          relationshipTypeId: friendType!.id,
        })
      ).rejects.toThrow();
    });

    it('allows same contacts with different relationship types', async () => {
      const contactAId = await createContact(pool, 'Alice');
      const contactBId = await createContact(pool, 'Bob');
      const friendType = await getRelationshipTypeByName(pool, 'friend_of');
      const colleagueType = await getRelationshipTypeByName(pool, 'colleague_of');

      const rel1 = await createRelationship(pool, {
        contactAId,
        contactBId,
        relationshipTypeId: friendType!.id,
      });

      const rel2 = await createRelationship(pool, {
        contactAId,
        contactBId,
        relationshipTypeId: colleagueType!.id,
      });

      expect(rel1.id).not.toBe(rel2.id);
    });
  });

  describe('getRelationship', () => {
    it('gets a relationship by ID with details', async () => {
      const contactAId = await createContact(pool, 'Alice');
      const contactBId = await createContact(pool, 'Bob');
      const partnerType = await getRelationshipTypeByName(pool, 'partner_of');

      const created = await createRelationship(pool, {
        contactAId,
        contactBId,
        relationshipTypeId: partnerType!.id,
        notes: 'Test',
      });

      const fetched = await getRelationship(pool, created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.contactAName).toBe('Alice');
      expect(fetched!.contactBName).toBe('Bob');
      expect(fetched!.relationshipType.name).toBe('partner_of');
      expect(fetched!.relationshipType.label).toBe('Partner of');
      expect(fetched!.relationshipType.isDirectional).toBe(false);
    });

    it('returns null for non-existent ID', async () => {
      const result = await getRelationship(pool, '00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });
  });

  describe('updateRelationship', () => {
    it('updates notes', async () => {
      const contactAId = await createContact(pool, 'Alice');
      const contactBId = await createContact(pool, 'Bob');
      const friendType = await getRelationshipTypeByName(pool, 'friend_of');

      const created = await createRelationship(pool, {
        contactAId,
        contactBId,
        relationshipTypeId: friendType!.id,
        notes: 'Original',
      });

      const updated = await updateRelationship(pool, created.id, {
        notes: 'Updated notes',
      });

      expect(updated).not.toBeNull();
      expect(updated!.notes).toBe('Updated notes');
    });

    it('updates relationship type', async () => {
      const contactAId = await createContact(pool, 'Alice');
      const contactBId = await createContact(pool, 'Bob');
      const friendType = await getRelationshipTypeByName(pool, 'friend_of');
      const partnerType = await getRelationshipTypeByName(pool, 'partner_of');

      const created = await createRelationship(pool, {
        contactAId,
        contactBId,
        relationshipTypeId: friendType!.id,
      });

      const updated = await updateRelationship(pool, created.id, {
        relationshipTypeId: partnerType!.id,
      });

      expect(updated).not.toBeNull();
      expect(updated!.relationshipTypeId).toBe(partnerType!.id);
    });

    it('returns null for non-existent ID', async () => {
      const result = await updateRelationship(
        pool,
        '00000000-0000-0000-0000-000000000000',
        { notes: 'Nope' }
      );
      expect(result).toBeNull();
    });
  });

  describe('deleteRelationship', () => {
    it('deletes a relationship', async () => {
      const contactAId = await createContact(pool, 'Alice');
      const contactBId = await createContact(pool, 'Bob');
      const friendType = await getRelationshipTypeByName(pool, 'friend_of');

      const created = await createRelationship(pool, {
        contactAId,
        contactBId,
        relationshipTypeId: friendType!.id,
      });

      const deleted = await deleteRelationship(pool, created.id);
      expect(deleted).toBe(true);

      const fetched = await getRelationship(pool, created.id);
      expect(fetched).toBeNull();
    });

    it('returns false for non-existent ID', async () => {
      const result = await deleteRelationship(pool, '00000000-0000-0000-0000-000000000000');
      expect(result).toBe(false);
    });
  });

  describe('listRelationships', () => {
    it('lists all relationships', async () => {
      const a = await createContact(pool, 'Alice');
      const b = await createContact(pool, 'Bob');
      const c = await createContact(pool, 'Charlie');
      const friendType = await getRelationshipTypeByName(pool, 'friend_of');

      await createRelationship(pool, { contactAId: a, contactBId: b, relationshipTypeId: friendType!.id });
      await createRelationship(pool, { contactAId: b, contactBId: c, relationshipTypeId: friendType!.id });

      const result = await listRelationships(pool);
      expect(result.total).toBe(2);
      expect(result.relationships.length).toBe(2);
    });

    it('filters by contactId (either side)', async () => {
      const a = await createContact(pool, 'Alice');
      const b = await createContact(pool, 'Bob');
      const c = await createContact(pool, 'Charlie');
      const friendType = await getRelationshipTypeByName(pool, 'friend_of');

      await createRelationship(pool, { contactAId: a, contactBId: b, relationshipTypeId: friendType!.id });
      await createRelationship(pool, { contactAId: b, contactBId: c, relationshipTypeId: friendType!.id });
      await createRelationship(pool, { contactAId: a, contactBId: c, relationshipTypeId: friendType!.id });

      // Bob is in relationships with Alice (as B) and Charlie (as A)
      const result = await listRelationships(pool, { contactId: b });
      expect(result.total).toBe(2);
    });

    it('filters by relationship type', async () => {
      const a = await createContact(pool, 'Alice');
      const b = await createContact(pool, 'Bob');
      const friendType = await getRelationshipTypeByName(pool, 'friend_of');
      const colleagueType = await getRelationshipTypeByName(pool, 'colleague_of');

      await createRelationship(pool, { contactAId: a, contactBId: b, relationshipTypeId: friendType!.id });
      await createRelationship(pool, { contactAId: a, contactBId: b, relationshipTypeId: colleagueType!.id });

      const result = await listRelationships(pool, { relationshipTypeId: friendType!.id });
      expect(result.total).toBe(1);
    });

    it('supports pagination', async () => {
      const a = await createContact(pool, 'Alice');
      const b = await createContact(pool, 'Bob');
      const c = await createContact(pool, 'Charlie');
      const friendType = await getRelationshipTypeByName(pool, 'friend_of');
      const colleagueType = await getRelationshipTypeByName(pool, 'colleague_of');

      await createRelationship(pool, { contactAId: a, contactBId: b, relationshipTypeId: friendType!.id });
      await createRelationship(pool, { contactAId: a, contactBId: c, relationshipTypeId: friendType!.id });
      await createRelationship(pool, { contactAId: b, contactBId: c, relationshipTypeId: colleagueType!.id });

      const page1 = await listRelationships(pool, { limit: 2, offset: 0 });
      expect(page1.relationships.length).toBe(2);
      expect(page1.total).toBe(3);

      const page2 = await listRelationships(pool, { limit: 2, offset: 2 });
      expect(page2.relationships.length).toBe(1);
      expect(page2.total).toBe(3);
    });
  });

  describe('getRelatedContacts (graph traversal)', () => {
    it('returns related contacts for symmetric relationships', async () => {
      const alice = await createContact(pool, 'Alice');
      const bob = await createContact(pool, 'Bob');
      const friendType = await getRelationshipTypeByName(pool, 'friend_of');

      await createRelationship(pool, {
        contactAId: alice,
        contactBId: bob,
        relationshipTypeId: friendType!.id,
      });

      // From Alice's perspective
      const aliceResult = await getRelatedContacts(pool, alice);
      expect(aliceResult.contactId).toBe(alice);
      expect(aliceResult.relatedContacts.length).toBe(1);
      expect(aliceResult.relatedContacts[0].contactId).toBe(bob);
      expect(aliceResult.relatedContacts[0].relationshipTypeName).toBe('friend_of');

      // From Bob's perspective (symmetric, same type)
      const bobResult = await getRelatedContacts(pool, bob);
      expect(bobResult.contactId).toBe(bob);
      expect(bobResult.relatedContacts.length).toBe(1);
      expect(bobResult.relatedContacts[0].contactId).toBe(alice);
      expect(bobResult.relatedContacts[0].relationshipTypeName).toBe('friend_of');
    });

    it('resolves inverse types for directional relationships', async () => {
      const parent = await createContact(pool, 'Parent');
      const child = await createContact(pool, 'Child');
      const parentType = await getRelationshipTypeByName(pool, 'parent_of');

      // Store "Parent parent_of Child"
      await createRelationship(pool, {
        contactAId: parent,
        contactBId: child,
        relationshipTypeId: parentType!.id,
      });

      // From Parent's perspective: "parent_of Child"
      const parentResult = await getRelatedContacts(pool, parent);
      expect(parentResult.relatedContacts.length).toBe(1);
      expect(parentResult.relatedContacts[0].contactId).toBe(child);
      expect(parentResult.relatedContacts[0].contactName).toBe('Child');
      expect(parentResult.relatedContacts[0].relationshipTypeName).toBe('parent_of');

      // From Child's perspective: "child_of Parent" (inverse resolved)
      const childResult = await getRelatedContacts(pool, child);
      expect(childResult.relatedContacts.length).toBe(1);
      expect(childResult.relatedContacts[0].contactId).toBe(parent);
      expect(childResult.relatedContacts[0].contactName).toBe('Parent');
      expect(childResult.relatedContacts[0].relationshipTypeName).toBe('child_of');
    });

    it('handles multiple relationships for one contact', async () => {
      const alice = await createContact(pool, 'Alice');
      const bob = await createContact(pool, 'Bob');
      const charlie = await createContact(pool, 'Charlie');
      const friendType = await getRelationshipTypeByName(pool, 'friend_of');
      const colleagueType = await getRelationshipTypeByName(pool, 'colleague_of');

      await createRelationship(pool, {
        contactAId: alice,
        contactBId: bob,
        relationshipTypeId: friendType!.id,
      });
      await createRelationship(pool, {
        contactAId: alice,
        contactBId: charlie,
        relationshipTypeId: colleagueType!.id,
      });

      const result = await getRelatedContacts(pool, alice);
      expect(result.relatedContacts.length).toBe(2);

      const names = result.relatedContacts.map((r) => r.contactName);
      expect(names).toContain('Bob');
      expect(names).toContain('Charlie');
    });

    it('returns empty array for contact with no relationships', async () => {
      const lonely = await createContact(pool, 'Lonely');

      const result = await getRelatedContacts(pool, lonely);
      expect(result.relatedContacts.length).toBe(0);
    });
  });

  describe('Group membership queries', () => {
    it('getGroupMembers returns all members of a group', async () => {
      const group = await createContact(pool, 'Engineering Team', 'group');
      const alice = await createContact(pool, 'Alice');
      const bob = await createContact(pool, 'Bob');

      const hasMemberType = await getRelationshipTypeByName(pool, 'has_member');

      await createRelationship(pool, {
        contactAId: group,
        contactBId: alice,
        relationshipTypeId: hasMemberType!.id,
      });
      await createRelationship(pool, {
        contactAId: group,
        contactBId: bob,
        relationshipTypeId: hasMemberType!.id,
      });

      const members = await getGroupMembers(pool, group);
      expect(members.length).toBe(2);

      const memberNames = members.map((m) => m.memberName);
      expect(memberNames).toContain('Alice');
      expect(memberNames).toContain('Bob');

      for (const m of members) {
        expect(m.groupId).toBe(group);
        expect(m.groupName).toBe('Engineering Team');
      }
    });

    it('getContactGroups returns all groups a contact belongs to', async () => {
      const group1 = await createContact(pool, 'Engineering', 'group');
      const group2 = await createContact(pool, 'Book Club', 'group');
      const alice = await createContact(pool, 'Alice');

      const hasMemberType = await getRelationshipTypeByName(pool, 'has_member');

      await createRelationship(pool, {
        contactAId: group1,
        contactBId: alice,
        relationshipTypeId: hasMemberType!.id,
      });
      await createRelationship(pool, {
        contactAId: group2,
        contactBId: alice,
        relationshipTypeId: hasMemberType!.id,
      });

      const groups = await getContactGroups(pool, alice);
      expect(groups.length).toBe(2);

      const groupNames = groups.map((g) => g.groupName);
      expect(groupNames).toContain('Engineering');
      expect(groupNames).toContain('Book Club');
    });

    it('returns empty array for group with no members', async () => {
      const group = await createContact(pool, 'Empty Group', 'group');
      const members = await getGroupMembers(pool, group);
      expect(members.length).toBe(0);
    });

    it('returns empty array for contact with no groups', async () => {
      const alice = await createContact(pool, 'Alice');
      const groups = await getContactGroups(pool, alice);
      expect(groups.length).toBe(0);
    });
  });

  describe('relationshipSet (smart creation)', () => {
    it('creates relationship resolving contacts by name and type by name', async () => {
      const _alice = await createContact(pool, 'Alice');
      const _bob = await createContact(pool, 'Bob');

      const result = await relationshipSet(pool, {
        contactA: 'Alice',
        contactB: 'Bob',
        relationshipType: 'friend_of',
        notes: 'BFFs',
        createdByAgent: 'test-agent',
      });

      expect(result.created).toBe(true);
      expect(result.contactA.displayName).toBe('Alice');
      expect(result.contactB.displayName).toBe('Bob');
      expect(result.relationshipType.name).toBe('friend_of');
      expect(result.relationship.notes).toBe('BFFs');
    });

    it('creates relationship resolving contacts by ID', async () => {
      const aliceId = await createContact(pool, 'Alice');
      const bobId = await createContact(pool, 'Bob');

      const result = await relationshipSet(pool, {
        contactA: aliceId,
        contactB: bobId,
        relationshipType: 'partner_of',
      });

      expect(result.created).toBe(true);
      expect(result.contactA.id).toBe(aliceId);
      expect(result.contactB.id).toBe(bobId);
    });

    it('returns existing relationship if it already exists', async () => {
      const _alice = await createContact(pool, 'Alice');
      const _bob = await createContact(pool, 'Bob');

      const first = await relationshipSet(pool, {
        contactA: 'Alice',
        contactB: 'Bob',
        relationshipType: 'friend_of',
      });
      expect(first.created).toBe(true);

      const second = await relationshipSet(pool, {
        contactA: 'Alice',
        contactB: 'Bob',
        relationshipType: 'friend_of',
      });
      expect(second.created).toBe(false);
      expect(second.relationship.id).toBe(first.relationship.id);
    });

    it('semantic-matches relationship type', async () => {
      const _alice = await createContact(pool, 'Alice');
      const _bob = await createContact(pool, 'Bob');

      // "partner" should match "partner_of" via text search fallback
      const result = await relationshipSet(pool, {
        contactA: 'Alice',
        contactB: 'Bob',
        relationshipType: 'partner',
      });

      expect(result.created).toBe(true);
      expect(result.relationshipType.name).toBe('partner_of');
    });

    it('throws error when contact cannot be resolved', async () => {
      await createContact(pool, 'Alice');

      await expect(
        relationshipSet(pool, {
          contactA: 'Alice',
          contactB: 'NonexistentPerson',
          relationshipType: 'friend_of',
        })
      ).rejects.toThrow(/cannot be resolved/i);
    });
  });

  describe('Cascade behavior', () => {
    it('deletes relationships when contact A is deleted', async () => {
      const alice = await createContact(pool, 'Alice');
      const bob = await createContact(pool, 'Bob');
      const friendType = await getRelationshipTypeByName(pool, 'friend_of');

      const rel = await createRelationship(pool, {
        contactAId: alice,
        contactBId: bob,
        relationshipTypeId: friendType!.id,
      });

      // Delete Alice
      await pool.query('DELETE FROM contact WHERE id = $1', [alice]);

      const fetched = await getRelationship(pool, rel.id);
      expect(fetched).toBeNull();
    });

    it('deletes relationships when contact B is deleted', async () => {
      const alice = await createContact(pool, 'Alice');
      const bob = await createContact(pool, 'Bob');
      const friendType = await getRelationshipTypeByName(pool, 'friend_of');

      const rel = await createRelationship(pool, {
        contactAId: alice,
        contactBId: bob,
        relationshipTypeId: friendType!.id,
      });

      // Delete Bob
      await pool.query('DELETE FROM contact WHERE id = $1', [bob]);

      const fetched = await getRelationship(pool, rel.id);
      expect(fetched).toBeNull();
    });
  });
});
