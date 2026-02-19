import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

describe('Inbound routing tables (migration 092)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  describe('prompt_template', () => {
    it('creates prompt_template table with expected columns', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'prompt_template'
        ORDER BY ordinal_position
      `);
      const columns = result.rows.map((r) => r.column_name);
      expect(columns).toEqual([
        'id',
        'namespace',
        'label',
        'content',
        'channel_type',
        'is_default',
        'is_active',
        'created_at',
        'updated_at',
      ]);
    });

    it('inserts a prompt template with defaults', async () => {
      const result = await pool.query(
        `INSERT INTO prompt_template (label, content, channel_type)
         VALUES ('Test prompt', 'You are a helpful agent', 'sms')
         RETURNING *`,
      );
      const row = result.rows[0];
      expect(row.id).toBeDefined();
      expect(row.namespace).toBe('default');
      expect(row.label).toBe('Test prompt');
      expect(row.content).toBe('You are a helpful agent');
      expect(row.channel_type).toBe('sms');
      expect(row.is_default).toBe(false);
      expect(row.is_active).toBe(true);
      expect(row.created_at).toBeDefined();
      expect(row.updated_at).toBeDefined();
    });

    it('rejects empty label', async () => {
      await expect(
        pool.query(
          `INSERT INTO prompt_template (label, content, channel_type)
           VALUES ('', 'content', 'sms')`,
        ),
      ).rejects.toThrow();
    });

    it('rejects whitespace-only label', async () => {
      await expect(
        pool.query(
          `INSERT INTO prompt_template (label, content, channel_type)
           VALUES ('   ', 'content', 'sms')`,
        ),
      ).rejects.toThrow();
    });

    it('rejects invalid channel_type', async () => {
      await expect(
        pool.query(
          `INSERT INTO prompt_template (label, content, channel_type)
           VALUES ('Test', 'content', 'whatsapp')`,
        ),
      ).rejects.toThrow();
    });

    it('rejects invalid namespace format', async () => {
      await expect(
        pool.query(
          `INSERT INTO prompt_template (label, content, channel_type, namespace)
           VALUES ('Test', 'content', 'sms', 'INVALID!')`,
        ),
      ).rejects.toThrow();
    });

    it('enforces unique default per (namespace, channel_type)', async () => {
      await pool.query(
        `INSERT INTO prompt_template (label, content, channel_type, is_default)
         VALUES ('Default SMS', 'content 1', 'sms', true)`,
      );
      await expect(
        pool.query(
          `INSERT INTO prompt_template (label, content, channel_type, is_default)
           VALUES ('Another Default SMS', 'content 2', 'sms', true)`,
        ),
      ).rejects.toThrow();
    });

    it('allows multiple defaults across different channel types', async () => {
      await pool.query(
        `INSERT INTO prompt_template (label, content, channel_type, is_default)
         VALUES ('Default SMS', 'sms content', 'sms', true)`,
      );
      const result = await pool.query(
        `INSERT INTO prompt_template (label, content, channel_type, is_default)
         VALUES ('Default Email', 'email content', 'email', true)
         RETURNING id`,
      );
      expect(result.rows[0].id).toBeDefined();
    });

    it('allows multiple defaults across different namespaces', async () => {
      await pool.query(
        `INSERT INTO prompt_template (label, content, channel_type, is_default, namespace)
         VALUES ('Default SMS ns1', 'content', 'sms', true, 'ns1')`,
      );
      const result = await pool.query(
        `INSERT INTO prompt_template (label, content, channel_type, is_default, namespace)
         VALUES ('Default SMS ns2', 'content', 'sms', true, 'ns2')
         RETURNING id`,
      );
      expect(result.rows[0].id).toBeDefined();
    });

    it('allows inactive default + new active default for same (namespace, channel_type)', async () => {
      await pool.query(
        `INSERT INTO prompt_template (label, content, channel_type, is_default, is_active)
         VALUES ('Old Default', 'content', 'sms', true, false)`,
      );
      const result = await pool.query(
        `INSERT INTO prompt_template (label, content, channel_type, is_default)
         VALUES ('New Default', 'content', 'sms', true)
         RETURNING id`,
      );
      expect(result.rows[0].id).toBeDefined();
    });

    it('updates updated_at on UPDATE', async () => {
      const insert = await pool.query(
        `INSERT INTO prompt_template (label, content, channel_type)
         VALUES ('Test', 'content', 'sms')
         RETURNING id, updated_at`,
      );
      const originalUpdatedAt = insert.rows[0].updated_at;

      // Small delay to ensure timestamp changes
      await new Promise((r) => setTimeout(r, 10));

      const update = await pool.query(
        `UPDATE prompt_template SET label = 'Updated' WHERE id = $1 RETURNING updated_at`,
        [insert.rows[0].id],
      );
      expect(update.rows[0].updated_at.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
    });
  });

  describe('inbound_destination', () => {
    it('creates inbound_destination table with expected columns', async () => {
      const result = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'inbound_destination'
        ORDER BY ordinal_position
      `);
      const columns = result.rows.map((r) => r.column_name);
      expect(columns).toEqual([
        'id',
        'namespace',
        'address',
        'channel_type',
        'display_name',
        'agent_id',
        'prompt_template_id',
        'context_id',
        'is_active',
        'created_at',
        'updated_at',
      ]);
    });

    it('inserts a destination with minimal fields', async () => {
      const result = await pool.query(
        `INSERT INTO inbound_destination (address, channel_type)
         VALUES ('+61412345678', 'sms')
         RETURNING *`,
      );
      const row = result.rows[0];
      expect(row.address).toBe('+61412345678');
      expect(row.channel_type).toBe('sms');
      expect(row.namespace).toBe('default');
      expect(row.agent_id).toBeNull();
      expect(row.prompt_template_id).toBeNull();
      expect(row.context_id).toBeNull();
      expect(row.is_active).toBe(true);
    });

    it('enforces unique (address, channel_type)', async () => {
      await pool.query(
        `INSERT INTO inbound_destination (address, channel_type)
         VALUES ('test@example.com', 'email')`,
      );
      await expect(
        pool.query(
          `INSERT INTO inbound_destination (address, channel_type)
           VALUES ('test@example.com', 'email')`,
        ),
      ).rejects.toThrow();
    });

    it('allows same address across different channel types', async () => {
      await pool.query(
        `INSERT INTO inbound_destination (address, channel_type)
         VALUES ('+61412345678', 'sms')`,
      );
      // Same address, different channel type — should work (though unusual)
      const result = await pool.query(
        `INSERT INTO inbound_destination (address, channel_type)
         VALUES ('+61412345678', 'email')
         RETURNING id`,
      );
      expect(result.rows[0].id).toBeDefined();
    });

    it('references prompt_template via FK', async () => {
      const template = await pool.query(
        `INSERT INTO prompt_template (label, content, channel_type)
         VALUES ('Test', 'content', 'sms')
         RETURNING id`,
      );
      const result = await pool.query(
        `INSERT INTO inbound_destination (address, channel_type, prompt_template_id)
         VALUES ('+61412345678', 'sms', $1)
         RETURNING prompt_template_id`,
        [template.rows[0].id],
      );
      expect(result.rows[0].prompt_template_id).toBe(template.rows[0].id);
    });

    it('sets prompt_template_id to NULL on template delete (ON DELETE SET NULL)', async () => {
      const template = await pool.query(
        `INSERT INTO prompt_template (label, content, channel_type)
         VALUES ('Test', 'content', 'sms')
         RETURNING id`,
      );
      await pool.query(
        `INSERT INTO inbound_destination (address, channel_type, prompt_template_id)
         VALUES ('+61412345678', 'sms', $1)`,
        [template.rows[0].id],
      );
      await pool.query('DELETE FROM prompt_template WHERE id = $1', [template.rows[0].id]);
      const result = await pool.query(
        `SELECT prompt_template_id FROM inbound_destination WHERE address = '+61412345678'`,
      );
      expect(result.rows[0].prompt_template_id).toBeNull();
    });

    it('supports INSERT ON CONFLICT DO NOTHING for auto-discovery', async () => {
      await pool.query(
        `INSERT INTO inbound_destination (address, channel_type, display_name)
         VALUES ('test@example.com', 'email', 'Test')`,
      );
      // Second insert should be a no-op
      const result = await pool.query(
        `INSERT INTO inbound_destination (address, channel_type, display_name)
         VALUES ('test@example.com', 'email', 'Different Name')
         ON CONFLICT (address, channel_type) DO NOTHING
         RETURNING id`,
      );
      expect(result.rows).toHaveLength(0);

      // Original row unchanged
      const check = await pool.query(
        `SELECT display_name FROM inbound_destination WHERE address = 'test@example.com'`,
      );
      expect(check.rows[0].display_name).toBe('Test');
    });

    it('updates updated_at on UPDATE', async () => {
      const insert = await pool.query(
        `INSERT INTO inbound_destination (address, channel_type)
         VALUES ('+61412345678', 'sms')
         RETURNING id, updated_at`,
      );
      await new Promise((r) => setTimeout(r, 10));
      const update = await pool.query(
        `UPDATE inbound_destination SET display_name = 'Updated' WHERE id = $1 RETURNING updated_at`,
        [insert.rows[0].id],
      );
      expect(update.rows[0].updated_at.getTime()).toBeGreaterThan(insert.rows[0].updated_at.getTime());
    });
  });

  describe('channel_default', () => {
    it('creates channel_default table with expected columns', async () => {
      const result = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'channel_default'
        ORDER BY ordinal_position
      `);
      const columns = result.rows.map((r) => r.column_name);
      expect(columns).toEqual([
        'id',
        'namespace',
        'channel_type',
        'agent_id',
        'prompt_template_id',
        'context_id',
        'created_at',
        'updated_at',
      ]);
    });

    it('inserts a channel default', async () => {
      const result = await pool.query(
        `INSERT INTO channel_default (channel_type, agent_id)
         VALUES ('sms', 'agent-sms-handler')
         RETURNING *`,
      );
      const row = result.rows[0];
      expect(row.namespace).toBe('default');
      expect(row.channel_type).toBe('sms');
      expect(row.agent_id).toBe('agent-sms-handler');
      expect(row.prompt_template_id).toBeNull();
    });

    it('enforces unique (namespace, channel_type)', async () => {
      await pool.query(
        `INSERT INTO channel_default (channel_type, agent_id)
         VALUES ('sms', 'agent-1')`,
      );
      await expect(
        pool.query(
          `INSERT INTO channel_default (channel_type, agent_id)
           VALUES ('sms', 'agent-2')`,
        ),
      ).rejects.toThrow();
    });

    it('allows same channel_type across different namespaces', async () => {
      await pool.query(
        `INSERT INTO channel_default (channel_type, agent_id, namespace)
         VALUES ('sms', 'agent-1', 'ns1')`,
      );
      const result = await pool.query(
        `INSERT INTO channel_default (channel_type, agent_id, namespace)
         VALUES ('sms', 'agent-2', 'ns2')
         RETURNING id`,
      );
      expect(result.rows[0].id).toBeDefined();
    });

    it('rejects invalid channel_type', async () => {
      await expect(
        pool.query(
          `INSERT INTO channel_default (channel_type, agent_id)
           VALUES ('telegram', 'agent-1')`,
        ),
      ).rejects.toThrow();
    });

    it('requires agent_id (NOT NULL)', async () => {
      await expect(
        pool.query(
          `INSERT INTO channel_default (channel_type, agent_id)
           VALUES ('sms', NULL)`,
        ),
      ).rejects.toThrow();
    });

    it('references prompt_template via FK', async () => {
      const template = await pool.query(
        `INSERT INTO prompt_template (label, content, channel_type)
         VALUES ('SMS Default', 'content', 'sms')
         RETURNING id`,
      );
      const result = await pool.query(
        `INSERT INTO channel_default (channel_type, agent_id, prompt_template_id)
         VALUES ('sms', 'agent-1', $1)
         RETURNING prompt_template_id`,
        [template.rows[0].id],
      );
      expect(result.rows[0].prompt_template_id).toBe(template.rows[0].id);
    });

    it('updates updated_at on UPDATE', async () => {
      const insert = await pool.query(
        `INSERT INTO channel_default (channel_type, agent_id)
         VALUES ('email', 'agent-email')
         RETURNING id, updated_at`,
      );
      await new Promise((r) => setTimeout(r, 10));
      const update = await pool.query(
        `UPDATE channel_default SET agent_id = 'agent-email-v2' WHERE id = $1 RETURNING updated_at`,
        [insert.rows[0].id],
      );
      expect(update.rows[0].updated_at.getTime()).toBeGreaterThan(insert.rows[0].updated_at.getTime());
    });
  });
});
