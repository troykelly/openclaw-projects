/**
 * Tests for the relationship type service.
 * Part of Epic #486, Issue #490
 *
 * TDD: These tests are written before the service implementation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

// Service imports (will be created next)
import {
  listRelationshipTypes,
  getRelationshipType,
  getRelationshipTypeByName,
  createRelationshipType,
  updateRelationshipType,
  deleteRelationshipType,
  findSemanticMatch,
} from '../src/api/relationship-types/service.ts';

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

describe('Relationship Type Service (Epic #486, Issue #490)', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  // Re-seed all 32 pre-seeded relationship types before each test.
  // Migration 046 seeds these, but if the table was truncated by another
  // test file sharing the same database the seed data is lost.
  beforeEach(async () => {
    await seedAllRelationshipTypes(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('Pre-seeded types', () => {
    beforeEach(async () => {
      // Clean up non-pre-seeded relationship types left by other test files (#554).
      // Must delete relationships first due to FK constraint on relationship_type_id.
      const PRE_SEEDED_NAMES = `
        'partner_of','sibling_of','friend_of','colleague_of','housemate_of','co_parent_of',
        'parent_of','child_of','grandparent_of','grandchild_of','cares_for','cared_for_by',
        'employs','employed_by','manages','managed_by','mentor_of','mentee_of',
        'elder_of','junior_of','member_of','has_member','founder_of','founded_by',
        'client_of','has_client','vendor_of','has_vendor','assigned_to','manages_agent',
        'owned_by','owns'
      `;
      await pool.query(
        `DELETE FROM relationship
         WHERE relationship_type_id IN (
           SELECT id FROM relationship_type WHERE name NOT IN (${PRE_SEEDED_NAMES})
         )`,
      );
      await pool.query(`DELETE FROM relationship_type WHERE name NOT IN (${PRE_SEEDED_NAMES})`);
    });
    it('has symmetric relationship types', async () => {
      const symmetricNames = ['partner_of', 'sibling_of', 'friend_of', 'colleague_of', 'housemate_of', 'co_parent_of'];

      for (const name of symmetricNames) {
        const type = await getRelationshipTypeByName(pool, name);
        expect(type, `Expected symmetric type '${name}' to exist`).not.toBeNull();
        expect(type!.is_directional).toBe(false);
        expect(type!.inverse_type_id).toBeNull();
        expect(type!.created_by_agent).toBeNull();
      }
    });

    it('has directional relationship type pairs with correct inverses', async () => {
      const directionalPairs = [
        ['parent_of', 'child_of'],
        ['grandparent_of', 'grandchild_of'],
        ['cares_for', 'cared_for_by'],
        ['employs', 'employed_by'],
        ['manages', 'managed_by'],
        ['mentor_of', 'mentee_of'],
        ['elder_of', 'junior_of'],
        ['member_of', 'has_member'],
        ['founder_of', 'founded_by'],
        ['client_of', 'has_client'],
        ['vendor_of', 'has_vendor'],
        ['assigned_to', 'manages_agent'],
        ['owned_by', 'owns'],
      ];

      for (const [name, inverseName] of directionalPairs) {
        const type = await getRelationshipTypeByName(pool, name);
        const inverse = await getRelationshipTypeByName(pool, inverseName);

        expect(type, `Expected directional type '${name}' to exist`).not.toBeNull();
        expect(inverse, `Expected directional type '${inverseName}' to exist`).not.toBeNull();

        expect(type!.is_directional).toBe(true);
        expect(inverse!.is_directional).toBe(true);

        // They should reference each other
        expect(type!.inverse_type_id).toBe(inverse!.id);
        expect(inverse!.inverse_type_id).toBe(type!.id);
      }
    });

    it('lists all pre-seeded types', async () => {
      const result = await listRelationshipTypes(pool);

      // 6 symmetric + 13 directional pairs (26 types) = 32 total
      expect(result.total).toBe(32);
      expect(result.types.length).toBe(32);
    });

    it('filters by directional', async () => {
      const directional = await listRelationshipTypes(pool, { is_directional: true });
      expect(directional.total).toBe(26); // 13 pairs = 26 types

      const symmetric = await listRelationshipTypes(pool, { is_directional: false });
      expect(symmetric.total).toBe(6);
    });

    it('filters by pre-seeded only', async () => {
      const preSeeded = await listRelationshipTypes(pool, { pre_seeded_only: true });
      expect(preSeeded.total).toBe(32);

      // All pre-seeded types should have null created_by_agent
      for (const type of preSeeded.types) {
        expect(type.created_by_agent).toBeNull();
      }
    });

    it('includes inverse type details in list results', async () => {
      const result = await listRelationshipTypes(pool, { is_directional: true, limit: 5 });

      for (const type of result.types) {
        expect(type.inverse_type).not.toBeNull();
        expect(type.inverse_type!.id).toBe(type.inverse_type_id);
        expect(type.inverse_type!.name).toBeDefined();
        expect(type.inverse_type!.label).toBeDefined();
      }
    });

    it('each pre-seeded type has a label and description', async () => {
      const result = await listRelationshipTypes(pool);

      for (const type of result.types) {
        expect(type.label, `Type '${type.name}' should have a label`).toBeTruthy();
        expect(type.description, `Type '${type.name}' should have a description`).toBeTruthy();
      }
    });

    it('each pre-seeded type has pending embedding status', async () => {
      const result = await listRelationshipTypes(pool);

      for (const type of result.types) {
        expect(type.embedding_status).toBe('pending');
      }
    });
  });

  describe('getRelationshipType', () => {
    it('gets a type by ID', async () => {
      const partner = await getRelationshipTypeByName(pool, 'partner_of');
      expect(partner).not.toBeNull();

      const fetched = await getRelationshipType(pool, partner!.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe('partner_of');
      expect(fetched!.label).toBe('Partner of');
    });

    it('returns null for non-existent ID', async () => {
      const result = await getRelationshipType(pool, '00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });
  });

  describe('getRelationshipTypeByName', () => {
    it('gets a type by name', async () => {
      const type = await getRelationshipTypeByName(pool, 'parent_of');
      expect(type).not.toBeNull();
      expect(type!.name).toBe('parent_of');
      expect(type!.is_directional).toBe(true);
    });

    it('returns null for non-existent name', async () => {
      const result = await getRelationshipTypeByName(pool, 'nonexistent_type');
      expect(result).toBeNull();
    });
  });

  describe('createRelationshipType', () => {
    it('creates a new symmetric relationship type', async () => {
      const type = await createRelationshipType(pool, {
        name: 'test_neighbor_of',
        label: 'Neighbor of',
        is_directional: false,
        description: 'Lives nearby',
        created_by_agent: 'test-agent',
      });

      expect(type.id).toBeDefined();
      expect(type.name).toBe('test_neighbor_of');
      expect(type.label).toBe('Neighbor of');
      expect(type.is_directional).toBe(false);
      expect(type.inverse_type_id).toBeNull();
      expect(type.description).toBe('Lives nearby');
      expect(type.created_by_agent).toBe('test-agent');
      expect(type.embedding_status).toBe('pending');

      // Clean up
      await deleteRelationshipType(pool, type.id);
    });

    it('creates a new directional relationship type', async () => {
      const type = await createRelationshipType(pool, {
        name: 'test_teacher_of',
        label: 'Teacher of',
        is_directional: true,
        description: 'Teaches someone',
        created_by_agent: 'test-agent',
      });

      expect(type.is_directional).toBe(true);
      expect(type.inverse_type_id).toBeNull(); // No inverse yet

      // Clean up
      await deleteRelationshipType(pool, type.id);
    });

    it('links inverse type by name', async () => {
      // Create first type
      const teacher = await createRelationshipType(pool, {
        name: 'test_teaches',
        label: 'Teaches',
        is_directional: true,
        created_by_agent: 'test-agent',
      });

      // Create inverse, linking to first
      const student = await createRelationshipType(pool, {
        name: 'test_taught_by',
        label: 'Taught by',
        is_directional: true,
        inverse_type_name: 'test_teaches',
        created_by_agent: 'test-agent',
      });

      expect(student.inverse_type_id).toBe(teacher.id);

      // The first type should also now point back
      const refreshedTeacher = await getRelationshipType(pool, teacher.id);
      expect(refreshedTeacher!.inverse_type_id).toBe(student.id);

      // Clean up
      await deleteRelationshipType(pool, student.id);
      await deleteRelationshipType(pool, teacher.id);
    });

    it('rejects duplicate names', async () => {
      await expect(
        createRelationshipType(pool, {
          name: 'partner_of', // Already exists
          label: 'Duplicate',
        }),
      ).rejects.toThrow();
    });

    it('rejects empty name', async () => {
      await expect(
        createRelationshipType(pool, {
          name: '',
          label: 'Empty name',
        }),
      ).rejects.toThrow('Name is required');
    });

    it('rejects empty label', async () => {
      await expect(
        createRelationshipType(pool, {
          name: 'test_empty_label',
          label: '',
        }),
      ).rejects.toThrow('Label is required');
    });
  });

  describe('updateRelationshipType', () => {
    it('updates label and description', async () => {
      const type = await createRelationshipType(pool, {
        name: 'test_update_me',
        label: 'Original Label',
        description: 'Original description',
        created_by_agent: 'test-agent',
      });

      const updated = await updateRelationshipType(pool, type.id, {
        label: 'Updated Label',
        description: 'Updated description',
      });

      expect(updated).not.toBeNull();
      expect(updated!.label).toBe('Updated Label');
      expect(updated!.description).toBe('Updated description');
      expect(updated!.name).toBe('test_update_me'); // Name unchanged

      // Clean up
      await deleteRelationshipType(pool, type.id);
    });

    it('returns null for non-existent ID', async () => {
      const result = await updateRelationshipType(pool, '00000000-0000-0000-0000-000000000000', { label: 'Nope' });
      expect(result).toBeNull();
    });

    it('returns unchanged type when no updates provided', async () => {
      const type = await createRelationshipType(pool, {
        name: 'test_no_update',
        label: 'No Change',
        created_by_agent: 'test-agent',
      });

      const result = await updateRelationshipType(pool, type.id, {});
      expect(result).not.toBeNull();
      expect(result!.label).toBe('No Change');

      // Clean up
      await deleteRelationshipType(pool, type.id);
    });
  });

  describe('deleteRelationshipType', () => {
    it('deletes a custom relationship type', async () => {
      const type = await createRelationshipType(pool, {
        name: 'test_delete_me',
        label: 'Delete Me',
        created_by_agent: 'test-agent',
      });

      const deleted = await deleteRelationshipType(pool, type.id);
      expect(deleted).toBe(true);

      const fetched = await getRelationshipType(pool, type.id);
      expect(fetched).toBeNull();
    });

    it('returns false for non-existent ID', async () => {
      const result = await deleteRelationshipType(pool, '00000000-0000-0000-0000-000000000000');
      expect(result).toBe(false);
    });
  });

  describe('findSemanticMatch (text fallback)', () => {
    it('finds match by text search when no embeddings exist', async () => {
      // Since embeddings won't be generated in tests,
      // this should fall back to text search
      const results = await findSemanticMatch(pool, 'partner');
      expect(results.length).toBeGreaterThan(0);

      const partnerMatch = results.find((r) => r.type.name === 'partner_of');
      expect(partnerMatch).toBeDefined();
    });

    it('finds match for "spouse" via text search on description', async () => {
      // "partner_of" description should mention inclusive of all relationship structures
      const results = await findSemanticMatch(pool, 'spouse');
      expect(results.length).toBeGreaterThan(0);
    });

    it('finds match for "parent" via text search', async () => {
      const results = await findSemanticMatch(pool, 'parent');
      expect(results.length).toBeGreaterThan(0);

      const parentMatch = results.find((r) => r.type.name === 'parent_of');
      expect(parentMatch).toBeDefined();
    });

    it('returns empty array for unrelated query', async () => {
      const results = await findSemanticMatch(pool, 'xyzzy_nonexistent_relationship_qqq');
      expect(results.length).toBe(0);
    });

    it('respects limit parameter', async () => {
      const results = await findSemanticMatch(pool, 'of', { limit: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  describe('pagination', () => {
    it('paginates results with limit and offset', async () => {
      const page1 = await listRelationshipTypes(pool, { limit: 5, offset: 0 });
      const page2 = await listRelationshipTypes(pool, { limit: 5, offset: 5 });

      expect(page1.types.length).toBe(5);
      expect(page2.types.length).toBe(5);

      // Pages should have different types
      const page1Names = page1.types.map((t) => t.name);
      const page2Names = page2.types.map((t) => t.name);
      expect(page1Names).not.toEqual(page2Names);

      // Total should be the same
      expect(page1.total).toBe(page2.total);
    });
  });
});
