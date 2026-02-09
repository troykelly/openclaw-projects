/**
 * Tests for audit logging service.
 * Part of Issue #214.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';
import {
  createAuditLog,
  queryAuditLog,
  getEntityAuditLog,
  getActorAuditLog,
  logAuthEvent,
  logWebhookEvent,
  purgeOldEntries,
  updateLatestAuditEntry,
  extractActor,
  buildRequestMetadata,
} from '../../src/api/audit/service.ts';

describe('Audit Service', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createTestPool();
    await truncateAllTables(pool);
    // Clear the audit_log table after truncation since triggers fire during truncation
    await pool.query('TRUNCATE TABLE audit_log CASCADE');
  });

  afterEach(async () => {
    await pool.end();
  });

  describe('createAuditLog', () => {
    it('creates an audit log entry', async () => {
      const id = await createAuditLog(pool, {
        actorType: 'human',
        actorId: 'user@example.com',
        action: 'create',
        entityType: 'work_item',
        entityId: '00000000-0000-0000-0000-000000000001',
        changes: { title: 'New Task' },
        metadata: { ip: '127.0.0.1' },
      });

      expect(id).toBeDefined();

      // Verify the entry
      const result = await pool.query(`SELECT * FROM audit_log WHERE id = $1`, [id]);
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].actor_type).toBe('human');
      expect(result.rows[0].actor_id).toBe('user@example.com');
      expect(result.rows[0].action).toBe('create');
      expect(result.rows[0].entity_type).toBe('work_item');
    });

    it('creates entry with null actor_id for system actor', async () => {
      const id = await createAuditLog(pool, {
        actorType: 'system',
        action: 'create',
        entityType: 'work_item',
      });

      expect(id).toBeDefined();

      const result = await pool.query(`SELECT actor_id FROM audit_log WHERE id = $1`, [id]);
      expect(result.rows[0].actor_id).toBeNull();
    });
  });

  describe('queryAuditLog', () => {
    beforeEach(async () => {
      // Create some test entries
      await createAuditLog(pool, {
        actorType: 'human',
        actorId: 'user1@example.com',
        action: 'create',
        entityType: 'work_item',
        entityId: '00000000-0000-0000-0000-000000000001',
      });
      await createAuditLog(pool, {
        actorType: 'agent',
        actorId: 'agent-1',
        action: 'update',
        entityType: 'work_item',
        entityId: '00000000-0000-0000-0000-000000000001',
      });
      await createAuditLog(pool, {
        actorType: 'human',
        actorId: 'user1@example.com',
        action: 'create',
        entityType: 'contact',
        entityId: '00000000-0000-0000-0000-000000000002',
      });
    });

    it('returns all entries with no filter', async () => {
      const { entries, total } = await queryAuditLog(pool);
      expect(entries.length).toBe(3);
      expect(total).toBe(3);
    });

    it('filters by entity type', async () => {
      const { entries, total } = await queryAuditLog(pool, {
        entityType: 'work_item',
      });
      expect(entries.length).toBe(2);
      expect(total).toBe(2);
    });

    it('filters by entity ID', async () => {
      const { entries, total } = await queryAuditLog(pool, {
        entityId: '00000000-0000-0000-0000-000000000001',
      });
      expect(entries.length).toBe(2);
      expect(total).toBe(2);
    });

    it('filters by actor type', async () => {
      const { entries, total } = await queryAuditLog(pool, {
        actorType: 'human',
      });
      expect(entries.length).toBe(2);
      expect(total).toBe(2);
    });

    it('filters by actor ID', async () => {
      const { entries, total } = await queryAuditLog(pool, {
        actorId: 'agent-1',
      });
      expect(entries.length).toBe(1);
      expect(total).toBe(1);
    });

    it('filters by action', async () => {
      const { entries, total } = await queryAuditLog(pool, {
        action: 'create',
      });
      expect(entries.length).toBe(2);
      expect(total).toBe(2);
    });

    it('supports pagination', async () => {
      const { entries: page1 } = await queryAuditLog(pool, { limit: 2, offset: 0 });
      expect(page1.length).toBe(2);

      const { entries: page2 } = await queryAuditLog(pool, { limit: 2, offset: 2 });
      expect(page2.length).toBe(1);
    });

    it('filters by date range', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const { total: inRange } = await queryAuditLog(pool, {
        startDate: yesterday,
        endDate: tomorrow,
      });
      expect(inRange).toBe(3);

      const { total: beforeNow } = await queryAuditLog(pool, {
        endDate: yesterday,
      });
      expect(beforeNow).toBe(0);
    });
  });

  describe('getEntityAuditLog', () => {
    it('returns audit entries for a specific entity', async () => {
      await createAuditLog(pool, {
        actorType: 'human',
        action: 'create',
        entityType: 'work_item',
        entityId: '00000000-0000-0000-0000-000000000001',
      });
      await createAuditLog(pool, {
        actorType: 'human',
        action: 'update',
        entityType: 'work_item',
        entityId: '00000000-0000-0000-0000-000000000001',
      });

      const entries = await getEntityAuditLog(pool, 'work_item', '00000000-0000-0000-0000-000000000001');
      expect(entries.length).toBe(2);
    });
  });

  describe('getActorAuditLog', () => {
    it('returns audit entries for a specific actor', async () => {
      await createAuditLog(pool, {
        actorType: 'agent',
        actorId: 'my-agent',
        action: 'create',
        entityType: 'work_item',
      });
      await createAuditLog(pool, {
        actorType: 'agent',
        actorId: 'my-agent',
        action: 'update',
        entityType: 'contact',
      });

      const entries = await getActorAuditLog(pool, 'agent', 'my-agent');
      expect(entries.length).toBe(2);
    });
  });

  describe('logAuthEvent', () => {
    it('logs a successful auth event', async () => {
      const id = await logAuthEvent(pool, {
        actorType: 'human',
        actorId: 'user@example.com',
        success: true,
        metadata: { method: 'magic_link' },
      });

      expect(id).toBeDefined();

      const result = await pool.query(`SELECT * FROM audit_log WHERE id = $1`, [id]);
      expect(result.rows[0].action).toBe('auth');
      expect(result.rows[0].entity_type).toBe('session');
      expect(result.rows[0].changes.success).toBe(true);
    });

    it('logs a failed auth event', async () => {
      const id = await logAuthEvent(pool, {
        actorType: 'human',
        actorId: 'attacker@evil.com',
        success: false,
        metadata: { reason: 'invalid_token' },
      });

      const result = await pool.query(`SELECT * FROM audit_log WHERE id = $1`, [id]);
      expect(result.rows[0].changes.success).toBe(false);
    });
  });

  describe('logWebhookEvent', () => {
    it('logs a webhook receipt', async () => {
      const id = await logWebhookEvent(pool, {
        source: 'twilio',
        entityType: 'external_message',
        entityId: '00000000-0000-0000-0000-000000000001',
        metadata: { from: '+15551234567' },
      });

      expect(id).toBeDefined();

      const result = await pool.query(`SELECT * FROM audit_log WHERE id = $1`, [id]);
      expect(result.rows[0].action).toBe('webhook');
      expect(result.rows[0].actor_id).toBe('webhook:twilio');
      expect(result.rows[0].metadata.source).toBe('twilio');
    });
  });

  describe('purgeOldEntries', () => {
    it('purges entries older than retention period', async () => {
      // Create an entry
      await createAuditLog(pool, {
        actorType: 'system',
        action: 'create',
        entityType: 'work_item',
      });

      // Update timestamp to be old
      await pool.query(`UPDATE audit_log SET timestamp = now() - INTERVAL '100 days'`);

      const purged = await purgeOldEntries(pool, 90);
      expect(purged).toBe(1);

      const { total } = await queryAuditLog(pool);
      expect(total).toBe(0);
    });

    it('keeps entries within retention period', async () => {
      await createAuditLog(pool, {
        actorType: 'system',
        action: 'create',
        entityType: 'work_item',
      });

      const purged = await purgeOldEntries(pool, 90);
      expect(purged).toBe(0);

      const { total } = await queryAuditLog(pool);
      expect(total).toBe(1);
    });
  });

  describe('updateLatestAuditEntry', () => {
    it('updates the most recent audit entry for an entity', async () => {
      // The trigger will create an entry when we insert a work_item
      const workItemResult = await pool.query(`INSERT INTO work_item (title) VALUES ('Test Task') RETURNING id::text`);
      const workItemId = workItemResult.rows[0].id;

      // Update the audit entry with actor info
      const updated = await updateLatestAuditEntry(pool, 'work_item', workItemId, { type: 'human', id: 'user@example.com' }, { ip: '192.168.1.1' });

      expect(updated).toBe(true);

      // Verify the update
      const entries = await getEntityAuditLog(pool, 'work_item', workItemId);
      expect(entries[0].actorType).toBe('human');
      expect(entries[0].actorId).toBe('user@example.com');
      expect(entries[0].metadata?.ip).toBe('192.168.1.1');
    });
  });

  describe('extractActor', () => {
    it('extracts agent from X-Agent-Name header', () => {
      const actor = extractActor({ 'x-agent-name': 'my-agent' });
      expect(actor.type).toBe('agent');
      expect(actor.id).toBe('my-agent');
    });

    it('extracts human from X-User-Id header', () => {
      const actor = extractActor({ 'x-user-id': 'user123' });
      expect(actor.type).toBe('human');
      expect(actor.id).toBe('user123');
    });

    it('extracts human from X-User-Email header', () => {
      const actor = extractActor({ 'x-user-email': 'user@example.com' });
      expect(actor.type).toBe('human');
      expect(actor.id).toBe('user@example.com');
    });

    it('prefers agent over human headers', () => {
      const actor = extractActor({
        'x-agent-name': 'my-agent',
        'x-user-id': 'user123',
      });
      expect(actor.type).toBe('agent');
      expect(actor.id).toBe('my-agent');
    });

    it('defaults to system with no headers', () => {
      const actor = extractActor({});
      expect(actor.type).toBe('system');
      expect(actor.id).toBeNull();
    });
  });

  describe('buildRequestMetadata', () => {
    it('builds metadata from request', () => {
      const metadata = buildRequestMetadata({
        ip: '192.168.1.1',
        id: 'req-123',
        headers: { 'user-agent': 'Mozilla/5.0' },
      });

      expect(metadata.ip).toBe('192.168.1.1');
      expect(metadata.requestId).toBe('req-123');
      expect(metadata.userAgent).toBe('Mozilla/5.0');
    });

    it('handles missing fields gracefully', () => {
      const metadata = buildRequestMetadata({});
      expect(Object.keys(metadata)).toHaveLength(0);
    });
  });
});

describe('Automatic Audit Triggers', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createTestPool();
    await truncateAllTables(pool);
    // Clear the audit_log table after truncation since triggers fire during truncation
    await pool.query('TRUNCATE TABLE audit_log CASCADE');
  });

  afterEach(async () => {
    await pool.end();
  });

  describe('work_item triggers', () => {
    it('logs work_item creation', async () => {
      const result = await pool.query(`INSERT INTO work_item (title) VALUES ('Test Task') RETURNING id::text`);
      const workItemId = result.rows[0].id;

      const entries = await getEntityAuditLog(pool, 'work_item', workItemId);
      expect(entries.length).toBe(1);
      expect(entries[0].action).toBe('create');
      expect(entries[0].changes?.new).toBeDefined();
    });

    it('logs work_item update', async () => {
      const result = await pool.query(`INSERT INTO work_item (title) VALUES ('Test Task') RETURNING id::text`);
      const workItemId = result.rows[0].id;

      await pool.query(`UPDATE work_item SET title = 'Updated Task' WHERE id = $1`, [workItemId]);

      const entries = await getEntityAuditLog(pool, 'work_item', workItemId);
      expect(entries.length).toBe(2);
      expect(entries[0].action).toBe('update');
      expect(entries[0].changes?.old).toBeDefined();
      expect(entries[0].changes?.new).toBeDefined();
    });

    it('logs work_item deletion', async () => {
      const result = await pool.query(`INSERT INTO work_item (title) VALUES ('Test Task') RETURNING id::text`);
      const workItemId = result.rows[0].id;

      await pool.query(`DELETE FROM work_item WHERE id = $1`, [workItemId]);

      // The audit entry should still exist even though the work item is deleted
      const auditResult = await pool.query(`SELECT * FROM audit_log WHERE entity_type = 'work_item' AND entity_id = $1 AND action = 'delete'`, [workItemId]);
      expect(auditResult.rows.length).toBe(1);
      expect(auditResult.rows[0].changes.old).toBeDefined();
    });
  });

  describe('contact triggers', () => {
    it('logs contact creation', async () => {
      const result = await pool.query(`INSERT INTO contact (display_name) VALUES ('Test Contact') RETURNING id::text`);
      const contactId = result.rows[0].id;

      const entries = await getEntityAuditLog(pool, 'contact', contactId);
      expect(entries.length).toBe(1);
      expect(entries[0].action).toBe('create');
    });

    it('logs contact update', async () => {
      const result = await pool.query(`INSERT INTO contact (display_name) VALUES ('Test Contact') RETURNING id::text`);
      const contactId = result.rows[0].id;

      await pool.query(`UPDATE contact SET display_name = 'Updated Contact' WHERE id = $1`, [contactId]);

      const entries = await getEntityAuditLog(pool, 'contact', contactId);
      expect(entries.length).toBe(2);
      expect(entries[0].action).toBe('update');
    });
  });

  describe('memory triggers', () => {
    it('logs memory creation', async () => {
      const result = await pool.query(`INSERT INTO memory (title, content, memory_type) VALUES ('Test Memory', 'Content', 'note') RETURNING id::text`);
      const memoryId = result.rows[0].id;

      const entries = await getEntityAuditLog(pool, 'memory', memoryId);
      expect(entries.length).toBe(1);
      expect(entries[0].action).toBe('create');
    });

    it('logs memory update', async () => {
      const result = await pool.query(`INSERT INTO memory (title, content, memory_type) VALUES ('Test Memory', 'Content', 'note') RETURNING id::text`);
      const memoryId = result.rows[0].id;

      await pool.query(`UPDATE memory SET title = 'Updated Memory' WHERE id = $1`, [memoryId]);

      const entries = await getEntityAuditLog(pool, 'memory', memoryId);
      expect(entries.length).toBe(2);
      expect(entries[0].action).toBe('update');
    });
  });
});
