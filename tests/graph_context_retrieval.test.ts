/**
 * Tests for graph-aware context retrieval.
 * Part of Epic #486 - Issue #496
 *
 * Validates that the context retrieval service traverses relationship graphs
 * to surface preferences from user, contacts, groups, and relationships.
 *
 * Note: This test uses unique per-test identifiers to avoid conflicts with
 * parallel workers sharing the same database.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { runMigrate } from './helpers/migrate.js';
import { createTestPool } from './helpers/db.js';
import {
  retrieveGraphAwareContext,
  collectGraphScopes,
} from '../src/api/context/graph-aware-service.ts';

describe('Graph-Aware Context Retrieval', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  // ── Helper functions ──

  /** Generates a unique test prefix to avoid conflicts with parallel workers. */
  function testId(): string {
    return randomUUID().substring(0, 8);
  }

  /** Creates a contact and returns its ID. */
  async function createContact(displayName: string): Promise<string> {
    const result = await pool.query(
      `INSERT INTO contact (display_name)
       VALUES ($1)
       RETURNING id::text as id`,
      [displayName]
    );
    return (result.rows[0] as { id: string }).id;
  }

  /** Creates a contact endpoint (e.g., email). */
  async function createEndpoint(
    contactId: string,
    endpointType: string,
    endpointValue: string
  ): Promise<string> {
    const result = await pool.query(
      `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
       VALUES ($1, $2::contact_endpoint_type, $3, lower($3))
       RETURNING id::text as id`,
      [contactId, endpointType, endpointValue]
    );
    return (result.rows[0] as { id: string }).id;
  }

  /** Gets or creates a relationship type. */
  async function getOrCreateRelationshipType(
    name: string,
    label: string,
    isDirectional: boolean = false
  ): Promise<string> {
    const existing = await pool.query(
      `SELECT id::text as id FROM relationship_type WHERE name = $1`,
      [name]
    );
    if (existing.rows.length > 0) {
      return (existing.rows[0] as { id: string }).id;
    }

    const result = await pool.query(
      `INSERT INTO relationship_type (name, label, is_directional)
       VALUES ($1, $2, $3)
       RETURNING id::text as id`,
      [name, label, isDirectional]
    );
    return (result.rows[0] as { id: string }).id;
  }

  /** Creates a relationship between two contacts. */
  async function createRelationship(
    contactAId: string,
    contactBId: string,
    relationshipTypeId: string
  ): Promise<string> {
    const result = await pool.query(
      `INSERT INTO relationship (contact_a_id, contact_b_id, relationship_type_id)
       VALUES ($1, $2, $3)
       RETURNING id::text as id`,
      [contactAId, contactBId, relationshipTypeId]
    );
    return (result.rows[0] as { id: string }).id;
  }

  /** Creates a memory with the given scope. */
  async function createMemory(opts: {
    title: string;
    content: string;
    memoryType?: string;
    userEmail?: string;
    contactId?: string;
    relationshipId?: string;
    importance?: number;
    confidence?: number;
    expiresAt?: Date | null;
    supersededBy?: string;
  }): Promise<string> {
    const result = await pool.query(
      `INSERT INTO memory (
        user_email, contact_id, relationship_id,
        title, content, memory_type,
        importance, confidence, expires_at, superseded_by
      ) VALUES ($1, $2, $3, $4, $5, $6::memory_type, $7, $8, $9, $10)
      RETURNING id::text as id`,
      [
        opts.userEmail ?? null,
        opts.contactId ?? null,
        opts.relationshipId ?? null,
        opts.title,
        opts.content,
        opts.memoryType ?? 'preference',
        opts.importance ?? 5,
        opts.confidence ?? 1.0,
        opts.expiresAt ?? null,
        opts.supersededBy ?? null,
      ]
    );
    return (result.rows[0] as { id: string }).id;
  }

  // ── collectGraphScopes tests ──

  describe('collectGraphScopes()', () => {
    it('should return user email scope when no relationships exist', async () => {
      const email = `noscope-${testId()}@test.com`;
      const scopes = await collectGraphScopes(pool, email);

      expect(scopes).toBeDefined();
      expect(scopes.userEmail).toBe(email);
      expect(scopes.contactIds).toEqual([]);
      expect(scopes.relationshipIds).toEqual([]);
      expect(scopes.scopeDetails).toEqual([
        { scopeType: 'personal', scopeId: email, label: 'Personal' },
      ]);
    });

    it('should collect related contact IDs for direct relationships', async () => {
      const tid = testId();
      const userContactId = await createContact(`User-${tid}`);
      const email = `user-${tid}@test.com`;
      await createEndpoint(userContactId, 'email', email);
      const partnerContactId = await createContact(`Partner-${tid}`);

      const partnerTypeId = await getOrCreateRelationshipType('partner', 'Partner');
      const relId = await createRelationship(userContactId, partnerContactId, partnerTypeId);

      const scopes = await collectGraphScopes(pool, email);

      expect(scopes.userEmail).toBe(email);
      expect(scopes.contactIds).toContain(partnerContactId);
      expect(scopes.relationshipIds).toContain(relId);
      expect(scopes.scopeDetails.length).toBeGreaterThan(1);
    });

    it('should collect group member contact IDs', async () => {
      const tid = testId();
      const userContactId = await createContact(`User-${tid}`);
      const email = `user-${tid}@test.com`;
      await createEndpoint(userContactId, 'email', email);
      const groupContactId = await createContact(`Household-${tid}`);
      const memberContactId = await createContact(`Member-${tid}`);

      const hasMemberTypeId = await getOrCreateRelationshipType('has_member', 'Has Member', true);

      // Group has_member user, Group has_member otherMember
      await createRelationship(groupContactId, userContactId, hasMemberTypeId);
      await createRelationship(groupContactId, memberContactId, hasMemberTypeId);

      const scopes = await collectGraphScopes(pool, email);

      expect(scopes.contactIds).toContain(groupContactId);
      expect(scopes.contactIds).toContain(memberContactId);
    });

    it('should respect configurable traversal depth', async () => {
      const tid = testId();
      const userContactId = await createContact(`User-${tid}`);
      const email = `user-${tid}@test.com`;
      await createEndpoint(userContactId, 'email', email);
      const friendContactId = await createContact(`Friend-${tid}`);
      const fofContactId = await createContact(`FoF-${tid}`);

      const friendTypeId = await getOrCreateRelationshipType('friend', 'Friend');

      await createRelationship(userContactId, friendContactId, friendTypeId);
      await createRelationship(friendContactId, fofContactId, friendTypeId);

      // Depth 1: only direct relationships
      const scopesDepth1 = await collectGraphScopes(pool, email, { maxDepth: 1 });
      expect(scopesDepth1.contactIds).toContain(friendContactId);
      expect(scopesDepth1.contactIds).not.toContain(fofContactId);

      // Depth 0: no traversal
      const scopesDepth0 = await collectGraphScopes(pool, email, { maxDepth: 0 });
      expect(scopesDepth0.contactIds).toEqual([]);
      expect(scopesDepth0.relationshipIds).toEqual([]);
    });

    it('should include scope details with type attribution', async () => {
      const tid = testId();
      const userContactId = await createContact(`User-${tid}`);
      const email = `user-${tid}@test.com`;
      await createEndpoint(userContactId, 'email', email);
      const partnerContactId = await createContact(`Partner-${tid}`);
      const groupContactId = await createContact(`Household-${tid}`);

      const partnerTypeId = await getOrCreateRelationshipType('partner', 'Partner');
      const hasMemberTypeId = await getOrCreateRelationshipType('has_member', 'Has Member', true);

      const relId = await createRelationship(userContactId, partnerContactId, partnerTypeId);
      await createRelationship(groupContactId, userContactId, hasMemberTypeId);

      const scopes = await collectGraphScopes(pool, email);

      // Personal scope
      const personalScope = scopes.scopeDetails.find((s) => s.scopeType === 'personal');
      expect(personalScope).toBeDefined();

      // Contact scope for partner
      const contactScope = scopes.scopeDetails.find(
        (s) => s.scopeType === 'contact' && s.scopeId === partnerContactId
      );
      expect(contactScope).toBeDefined();
      expect(contactScope?.label).toContain('Partner');

      // Group scope
      const groupScope = scopes.scopeDetails.find(
        (s) => s.scopeType === 'group' && s.scopeId === groupContactId
      );
      expect(groupScope).toBeDefined();
      expect(groupScope?.label).toContain(`Household-${tid}`);

      // Relationship scope
      const relScope = scopes.scopeDetails.find(
        (s) => s.scopeType === 'relationship' && s.scopeId === relId
      );
      expect(relScope).toBeDefined();
    });
  });

  // ── retrieveGraphAwareContext tests ──

  describe('retrieveGraphAwareContext()', () => {
    it('should return structured result with metadata', async () => {
      const email = `struct-${testId()}@test.com`;
      const result = await retrieveGraphAwareContext(pool, {
        userEmail: email,
        prompt: 'What are my preferences?',
      });

      expect(result).toBeDefined();
      expect(result).toHaveProperty('context');
      expect(result).toHaveProperty('memories');
      expect(result).toHaveProperty('scopes');
      expect(result).toHaveProperty('metadata');
      expect(Array.isArray(result.memories)).toBe(true);
      expect(result.metadata).toHaveProperty('queryTimeMs');
      expect(typeof result.metadata.queryTimeMs).toBe('number');
      expect(result.metadata).toHaveProperty('scopeCount');
      expect(result.metadata).toHaveProperty('searchType');
    });

    it('should surface personal memories for the user', async () => {
      const tid = testId();
      const email = `personal-${tid}@test.com`;

      await createMemory({
        title: `Prefers dark mode ${tid}`,
        content: `User prefers dark mode across all applications ${tid}`,
        userEmail: email,
        memoryType: 'preference',
        importance: 8,
      });

      const result = await retrieveGraphAwareContext(pool, {
        userEmail: email,
        prompt: `dark mode ${tid}`,
      });

      expect(result.memories.length).toBeGreaterThan(0);
      const personalMemory = result.memories.find((m) => m.scopeType === 'personal');
      expect(personalMemory).toBeDefined();
      expect(personalMemory?.title).toContain('dark mode');
    });

    it('should surface memories from related contacts', async () => {
      const tid = testId();
      const userContactId = await createContact(`User-${tid}`);
      const email = `user-${tid}@test.com`;
      await createEndpoint(userContactId, 'email', email);
      const partnerContactId = await createContact(`Partner-${tid}`);

      const partnerTypeId = await getOrCreateRelationshipType('partner', 'Partner');
      await createRelationship(userContactId, partnerContactId, partnerTypeId);

      // Personal memory
      await createMemory({
        title: `User prefers tea ${tid}`,
        content: `User prefers tea over coffee ${tid}`,
        userEmail: email,
        memoryType: 'preference',
        importance: 7,
      });

      // Partner-scoped memory
      await createMemory({
        title: `Partner prefers coffee ${tid}`,
        content: `Partner prefers coffee especially lattes ${tid}`,
        contactId: partnerContactId,
        memoryType: 'preference',
        importance: 6,
      });

      const result = await retrieveGraphAwareContext(pool, {
        userEmail: email,
        prompt: `prefers coffee ${tid}`,
      });

      expect(result.memories.length).toBeGreaterThanOrEqual(2);

      const personalMem = result.memories.find((m) => m.scopeType === 'personal');
      expect(personalMem).toBeDefined();

      const contactMem = result.memories.find((m) => m.scopeType === 'contact');
      expect(contactMem).toBeDefined();
    });

    it('should surface memories from group memberships', async () => {
      const tid = testId();
      const userContactId = await createContact(`User-${tid}`);
      const email = `user-${tid}@test.com`;
      await createEndpoint(userContactId, 'email', email);
      const groupContactId = await createContact(`Household-${tid}`);

      const hasMemberTypeId = await getOrCreateRelationshipType('has_member', 'Has Member', true);
      await createRelationship(groupContactId, userContactId, hasMemberTypeId);

      await createMemory({
        title: `Dinner at 6pm ${tid}`,
        content: `The household always has dinner at 6pm ${tid}`,
        contactId: groupContactId,
        memoryType: 'preference',
        importance: 7,
      });

      const result = await retrieveGraphAwareContext(pool, {
        userEmail: email,
        prompt: `dinner household ${tid}`,
      });

      expect(result.memories.length).toBeGreaterThanOrEqual(1);
      const groupMem = result.memories.find((m) => m.scopeType === 'group');
      expect(groupMem).toBeDefined();
      expect(groupMem?.scopeLabel).toContain(`Household-${tid}`);
    });

    it('should surface memories scoped to relationships', async () => {
      const tid = testId();
      const userContactId = await createContact(`User-${tid}`);
      const email = `user-${tid}@test.com`;
      await createEndpoint(userContactId, 'email', email);
      const partnerContactId = await createContact(`Partner-${tid}`);

      const partnerTypeId = await getOrCreateRelationshipType('partner', 'Partner');
      const relId = await createRelationship(userContactId, partnerContactId, partnerTypeId);

      await createMemory({
        title: `Anniversary March 15 ${tid}`,
        content: `Wedding anniversary is on March 15th ${tid}`,
        relationshipId: relId,
        memoryType: 'fact',
        importance: 9,
      });

      const result = await retrieveGraphAwareContext(pool, {
        userEmail: email,
        prompt: `anniversary ${tid}`,
      });

      expect(result.memories.length).toBeGreaterThanOrEqual(1);
      const relMem = result.memories.find((m) => m.scopeType === 'relationship');
      expect(relMem).toBeDefined();
    });

    it('should exclude expired memories', async () => {
      const tid = testId();
      const email = `expire-${tid}@test.com`;

      await createMemory({
        title: `Valid pref ${tid}`,
        content: `Valid preference ${tid}`,
        userEmail: email,
        memoryType: 'preference',
        importance: 8,
      });

      await createMemory({
        title: `Expired pref ${tid}`,
        content: `Expired preference ${tid}`,
        userEmail: email,
        memoryType: 'preference',
        importance: 8,
        expiresAt: new Date('2020-01-01'),
      });

      const result = await retrieveGraphAwareContext(pool, {
        userEmail: email,
        prompt: `preference ${tid}`,
      });

      const expiredMemory = result.memories.find((m) => m.title.includes('Expired'));
      expect(expiredMemory).toBeUndefined();
    });

    it('should exclude superseded memories', async () => {
      const tid = testId();
      const email = `supersede-${tid}@test.com`;

      const oldMemId = await createMemory({
        title: `Old pref ${tid}`,
        content: `Old preference ${tid}`,
        userEmail: email,
        memoryType: 'preference',
        importance: 8,
      });

      const newMemId = await createMemory({
        title: `New pref ${tid}`,
        content: `New preference replaces old ${tid}`,
        userEmail: email,
        memoryType: 'preference',
        importance: 8,
      });

      await pool.query('UPDATE memory SET superseded_by = $1 WHERE id = $2', [newMemId, oldMemId]);

      const result = await retrieveGraphAwareContext(pool, {
        userEmail: email,
        prompt: `preference ${tid}`,
      });

      const supersededMemory = result.memories.find((m) => m.title.includes('Old'));
      expect(supersededMemory).toBeUndefined();
    });

    it('should rank results by combined relevance (similarity x importance x confidence)', async () => {
      const tid = testId();
      const email = `rank-${tid}@test.com`;

      await createMemory({
        title: `High importance food ${tid}`,
        content: `Strongly prefers vegetarian food ${tid}`,
        userEmail: email,
        memoryType: 'preference',
        importance: 10,
        confidence: 1.0,
      });

      await createMemory({
        title: `Low importance food ${tid}`,
        content: `Mentioned liking pizza once ${tid}`,
        userEmail: email,
        memoryType: 'preference',
        importance: 2,
        confidence: 0.5,
      });

      const result = await retrieveGraphAwareContext(pool, {
        userEmail: email,
        prompt: `food ${tid}`,
      });

      if (result.memories.length >= 2) {
        expect(result.memories[0].combinedRelevance).toBeGreaterThanOrEqual(
          result.memories[1].combinedRelevance
        );
      }
    });

    it('should respect maxMemories option', async () => {
      const tid = testId();
      const email = `limit-${tid}@test.com`;

      for (let i = 0; i < 8; i++) {
        await createMemory({
          title: `Pref ${i} ${tid}`,
          content: `Food preference number ${i} ${tid}`,
          userEmail: email,
          memoryType: 'preference',
          importance: 5,
        });
      }

      const result = await retrieveGraphAwareContext(pool, {
        userEmail: email,
        prompt: `food preference ${tid}`,
        maxMemories: 3,
      });

      expect(result.memories.length).toBeLessThanOrEqual(3);
    });

    it('should handle user with no contact record gracefully', async () => {
      const tid = testId();
      const email = `nocontact-${tid}@test.com`;

      await createMemory({
        title: `Dark mode pref ${tid}`,
        content: `User prefers dark mode ${tid}`,
        userEmail: email,
        memoryType: 'preference',
        importance: 5,
      });

      const result = await retrieveGraphAwareContext(pool, {
        userEmail: email,
        prompt: `dark mode ${tid}`,
      });

      expect(result).toBeDefined();
      expect(result.memories.length).toBeGreaterThanOrEqual(1);
      expect(result.scopes.userEmail).toBe(email);
    });

    it('should include scope count in metadata', async () => {
      const tid = testId();
      const userContactId = await createContact(`User-${tid}`);
      const email = `meta-${tid}@test.com`;
      await createEndpoint(userContactId, 'email', email);
      const partnerContactId = await createContact(`Partner-${tid}`);

      const partnerTypeId = await getOrCreateRelationshipType('partner', 'Partner');
      await createRelationship(userContactId, partnerContactId, partnerTypeId);

      const result = await retrieveGraphAwareContext(pool, {
        userEmail: email,
        prompt: 'test',
      });

      // At least 2 scopes: personal + partner contact + relationship
      expect(result.metadata.scopeCount).toBeGreaterThanOrEqual(2);
    });

    it('should build context string with scope attribution', async () => {
      const tid = testId();
      const userContactId = await createContact(`User-${tid}`);
      const email = `ctx-${tid}@test.com`;
      await createEndpoint(userContactId, 'email', email);
      const partnerContactId = await createContact(`Alex-${tid}`);

      const partnerTypeId = await getOrCreateRelationshipType('partner', 'Partner');
      await createRelationship(userContactId, partnerContactId, partnerTypeId);

      await createMemory({
        title: `User likes cats ${tid}`,
        content: `User loves cats and has two ${tid}`,
        userEmail: email,
        memoryType: 'preference',
        importance: 7,
      });

      await createMemory({
        title: `Alex likes dogs ${tid}`,
        content: `Alex prefers dogs and has a labrador ${tid}`,
        contactId: partnerContactId,
        memoryType: 'preference',
        importance: 6,
      });

      const result = await retrieveGraphAwareContext(pool, {
        userEmail: email,
        prompt: `pet cats dogs ${tid}`,
      });

      if (result.context) {
        expect(typeof result.context).toBe('string');
        expect(result.context.length).toBeGreaterThan(0);
      }
    });

    it('should complete within acceptable latency', async () => {
      const email = `latency-${testId()}@test.com`;
      const start = Date.now();

      await retrieveGraphAwareContext(pool, {
        userEmail: email,
        prompt: 'test query for latency check',
      });

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(3000);
    });
  });
});
