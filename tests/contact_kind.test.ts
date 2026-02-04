import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.js';
import { createTestPool, truncateAllTables } from './helpers/db.js';
import { buildServer } from '../src/api/server.js';

/**
 * Tests for contact_kind column on contacts table (issue #489).
 *
 * Covers:
 * - Migration: enum type, column, index, search_vector trigger
 * - API: create, read, list, update, filter by contact_kind
 * - Default value: existing contacts default to 'person'
 * - Search vector: contact_kind is included in full-text search
 */
describe('Contact Kind (Issue #489)', () => {
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

  describe('Database schema', () => {
    it('has contact_kind enum type with correct values', async () => {
      const result = await pool.query(
        `SELECT enumlabel FROM pg_enum
         JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
         WHERE pg_type.typname = 'contact_kind'
         ORDER BY enumsortorder`
      );

      expect(result.rows.map((r) => r.enumlabel)).toEqual([
        'person',
        'organisation',
        'group',
        'agent',
      ]);
    });

    it('defaults contact_kind to person', async () => {
      const result = await pool.query(
        `INSERT INTO contact (display_name) VALUES ('Default Kind')
         RETURNING contact_kind::text`
      );

      expect(result.rows[0].contact_kind).toBe('person');
    });

    it('allows creating contacts of each kind', async () => {
      const kinds = ['person', 'organisation', 'group', 'agent'] as const;

      for (const kind of kinds) {
        const result = await pool.query(
          `INSERT INTO contact (display_name, contact_kind) VALUES ($1, $2)
           RETURNING contact_kind::text`,
          [`Test ${kind}`, kind]
        );

        expect(result.rows[0].contact_kind).toBe(kind);
      }
    });

    it('rejects invalid contact_kind values', async () => {
      await expect(
        pool.query(
          `INSERT INTO contact (display_name, contact_kind) VALUES ('Bad', 'robot')`
        )
      ).rejects.toThrow(/invalid input value for enum contact_kind/);
    });

    it('has an index on contact_kind', async () => {
      const result = await pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE tablename = 'contact' AND indexname = 'idx_contact_kind'`
      );

      expect(result.rows.length).toBe(1);
    });

    it('includes contact_kind in search_vector', async () => {
      const result = await pool.query(
        `INSERT INTO contact (display_name, contact_kind) VALUES ('Search Org', 'organisation')
         RETURNING search_vector::text`
      );

      // search_vector should contain 'organisation' as a lexeme
      expect(result.rows[0].search_vector).toContain('organis');
    });
  });

  describe('POST /api/contacts', () => {
    it('creates a contact with default contact_kind (person)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'Default Person' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { contact_kind: string };
      expect(body.contact_kind).toBe('person');
    });

    it('creates contacts with explicit contact_kind values', async () => {
      for (const [name, kind] of [
        ['Acme Corp', 'organisation'],
        ['The Kelly Household', 'group'],
        ['OpenClaw Agent', 'agent'],
      ] as const) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/contacts',
          payload: { displayName: name, contactKind: kind },
        });

        expect(res.statusCode).toBe(201);
        const body = res.json() as { contact_kind: string };
        expect(body.contact_kind).toBe(kind);
      }
    });

    it('rejects invalid contact_kind', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'Bad Kind', contactKind: 'robot' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/contacts', () => {
    it('returns contact_kind in list response', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'Listed Contact', contactKind: 'organisation' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        contacts: Array<{ display_name: string; contact_kind: string }>;
      };
      expect(body.contacts.length).toBe(1);
      expect(body.contacts[0].contact_kind).toBe('organisation');
    });

    it('filters contacts by single contact_kind', async () => {
      // Insert directly to avoid pool pressure
      await pool.query(
        `INSERT INTO contact (display_name, contact_kind) VALUES
         ('Person One', 'person'),
         ('Org One', 'organisation'),
         ('Group One', 'group')`
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts?contact_kind=organisation',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        contacts: Array<{ display_name: string; contact_kind: string }>;
        total: number;
      };
      expect(body.contacts.length).toBe(1);
      expect(body.contacts[0].display_name).toBe('Org One');
      expect(body.contacts[0].contact_kind).toBe('organisation');
      expect(body.total).toBe(1);
    });

    it('filters contacts by multiple contact_kind values', async () => {
      await pool.query(
        `INSERT INTO contact (display_name, contact_kind) VALUES
         ('Person One', 'person'),
         ('Org One', 'organisation'),
         ('Group One', 'group')`
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/contacts?contact_kind=person,group',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        contacts: Array<{ contact_kind: string }>;
        total: number;
      };
      expect(body.total).toBe(2);
      const kinds = body.contacts.map((c) => c.contact_kind).sort();
      expect(kinds).toEqual(['group', 'person']);
    });
  });

  describe('GET /api/contacts/:id', () => {
    it('returns contact_kind in single contact response', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'Agent Smith', contactKind: 'agent' },
      });
      const { id } = created.json() as { id: string };

      const res = await app.inject({
        method: 'GET',
        url: `/api/contacts/${id}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { contact_kind: string };
      expect(body.contact_kind).toBe('agent');
    });
  });

  describe('PATCH /api/contacts/:id', () => {
    it('updates contact_kind', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'Will Become Org' },
      });
      const { id } = created.json() as { id: string };

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/contacts/${id}`,
        payload: { contactKind: 'organisation' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { contact_kind: string };
      expect(body.contact_kind).toBe('organisation');
    });

    it('rejects invalid contact_kind on update', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/contacts',
        payload: { displayName: 'Update Test' },
      });
      const { id } = created.json() as { id: string };

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/contacts/${id}`,
        payload: { contactKind: 'invalid' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/contacts/bulk', () => {
    it('supports contact_kind in bulk create', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/contacts/bulk',
        payload: {
          contacts: [
            { displayName: 'Person Bulk', contactKind: 'person' },
            { displayName: 'Org Bulk', contactKind: 'organisation' },
            { displayName: 'Group Bulk', contactKind: 'group' },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { created: number };
      expect(body.created).toBe(3);

      // Verify in DB directly
      const dbRes = await pool.query(
        `SELECT display_name, contact_kind::text FROM contact ORDER BY display_name`
      );
      expect(dbRes.rows.length).toBe(3);
      expect(dbRes.rows.find((r) => r.display_name === 'Org Bulk')?.contact_kind).toBe('organisation');
      expect(dbRes.rows.find((r) => r.display_name === 'Person Bulk')?.contact_kind).toBe('person');
      expect(dbRes.rows.find((r) => r.display_name === 'Group Bulk')?.contact_kind).toBe('group');
    });
  });

  describe('Migration rollback', () => {
    it('down migration removes contact_kind column and enum', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const downPath = path.resolve(
        __dirname,
        '../migrations/044_contact_kind.down.sql'
      );

      expect(fs.existsSync(downPath)).toBe(true);
      const content = fs.readFileSync(downPath, 'utf-8');
      expect(content).toContain('DROP COLUMN');
      expect(content).toContain('contact_kind');
    });
  });
});
