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

describe('Relationship Type Service (Epic #486, Issue #490)', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  // NOTE: We do NOT truncate relationship_type in beforeEach because
  // the pre-seeded data is part of the migration and should persist.
  // Tests that create custom types clean up after themselves.

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
        expect(type!.isDirectional).toBe(false);
        expect(type!.inverseTypeId).toBeNull();
        expect(type!.createdByAgent).toBeNull();
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

        expect(type!.isDirectional).toBe(true);
        expect(inverse!.isDirectional).toBe(true);

        // They should reference each other
        expect(type!.inverseTypeId).toBe(inverse!.id);
        expect(inverse!.inverseTypeId).toBe(type!.id);
      }
    });

    it('lists all pre-seeded types', async () => {
      const result = await listRelationshipTypes(pool);

      // 6 symmetric + 13 directional pairs (26 types) = 32 total
      expect(result.total).toBe(32);
      expect(result.types.length).toBe(32);
    });

    it('filters by directional', async () => {
      const directional = await listRelationshipTypes(pool, { isDirectional: true });
      expect(directional.total).toBe(26); // 13 pairs = 26 types

      const symmetric = await listRelationshipTypes(pool, { isDirectional: false });
      expect(symmetric.total).toBe(6);
    });

    it('filters by pre-seeded only', async () => {
      const preSeeded = await listRelationshipTypes(pool, { preSeededOnly: true });
      expect(preSeeded.total).toBe(32);

      // All pre-seeded types should have null createdByAgent
      for (const type of preSeeded.types) {
        expect(type.createdByAgent).toBeNull();
      }
    });

    it('includes inverse type details in list results', async () => {
      const result = await listRelationshipTypes(pool, { isDirectional: true, limit: 5 });

      for (const type of result.types) {
        expect(type.inverseType).not.toBeNull();
        expect(type.inverseType!.id).toBe(type.inverseTypeId);
        expect(type.inverseType!.name).toBeDefined();
        expect(type.inverseType!.label).toBeDefined();
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
        expect(type.embeddingStatus).toBe('pending');
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
      expect(type!.isDirectional).toBe(true);
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
        isDirectional: false,
        description: 'Lives nearby',
        createdByAgent: 'test-agent',
      });

      expect(type.id).toBeDefined();
      expect(type.name).toBe('test_neighbor_of');
      expect(type.label).toBe('Neighbor of');
      expect(type.isDirectional).toBe(false);
      expect(type.inverseTypeId).toBeNull();
      expect(type.description).toBe('Lives nearby');
      expect(type.createdByAgent).toBe('test-agent');
      expect(type.embeddingStatus).toBe('pending');

      // Clean up
      await deleteRelationshipType(pool, type.id);
    });

    it('creates a new directional relationship type', async () => {
      const type = await createRelationshipType(pool, {
        name: 'test_teacher_of',
        label: 'Teacher of',
        isDirectional: true,
        description: 'Teaches someone',
        createdByAgent: 'test-agent',
      });

      expect(type.isDirectional).toBe(true);
      expect(type.inverseTypeId).toBeNull(); // No inverse yet

      // Clean up
      await deleteRelationshipType(pool, type.id);
    });

    it('links inverse type by name', async () => {
      // Create first type
      const teacher = await createRelationshipType(pool, {
        name: 'test_teaches',
        label: 'Teaches',
        isDirectional: true,
        createdByAgent: 'test-agent',
      });

      // Create inverse, linking to first
      const student = await createRelationshipType(pool, {
        name: 'test_taught_by',
        label: 'Taught by',
        isDirectional: true,
        inverseTypeName: 'test_teaches',
        createdByAgent: 'test-agent',
      });

      expect(student.inverseTypeId).toBe(teacher.id);

      // The first type should also now point back
      const refreshedTeacher = await getRelationshipType(pool, teacher.id);
      expect(refreshedTeacher!.inverseTypeId).toBe(student.id);

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
        createdByAgent: 'test-agent',
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
        createdByAgent: 'test-agent',
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
        createdByAgent: 'test-agent',
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
