import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

describe('Agent Bootstrap API (Issue #219)', () => {
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

  describe('GET /api/bootstrap', () => {
    it('returns bootstrap context with all sections', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/bootstrap',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.generated_at).toBeDefined();
      expect(body.next_refresh_hint).toBeDefined();
      expect(body.preferences).toBeDefined();
      expect(body.active_projects).toBeDefined();
      expect(body.pending_reminders).toBeDefined();
      expect(body.recent_activity).toBeDefined();
      expect(body.key_contacts).toBeDefined();
      expect(body.stats).toBeDefined();
    });

    it('returns user preferences when user_email is provided', async () => {
      // Create a preference memory
      await pool.query(
        `INSERT INTO memory (user_email, title, content, memory_type, importance)
         VALUES ('test@example.com', 'Dark Mode', 'User prefers dark mode', 'preference', 8)`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/bootstrap?user_email=test@example.com',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.user.email).toBe('test@example.com');
      expect(body.preferences.length).toBe(1);
      expect(body.preferences[0].title).toBe('Dark Mode');
      expect(body.preferences[0].importance).toBe(8);
    });

    it('returns active projects', async () => {
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, status)
         VALUES ('Active Project', 'project', 'in_progress'),
                ('Completed Project', 'project', 'completed')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/bootstrap',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.active_projects.length).toBe(1);
      expect(body.active_projects[0].title).toBe('Active Project');
      expect(body.active_projects[0].status).toBe('in_progress');
    });

    it('returns pending reminders', async () => {
      const futureDate = new Date(Date.now() + 3600000); // 1 hour from now

      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, status, not_before)
         VALUES ('Future Reminder', 'issue', 'open', $1)`,
        [futureDate],
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/bootstrap',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.pending_reminders.length).toBe(1);
      expect(body.pending_reminders[0].title).toBe('Future Reminder');
    });

    it('returns key contacts', async () => {
      await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('John Doe'), ('Jane Smith')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/bootstrap',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.key_contacts.length).toBe(2);
    });

    it('returns statistics', async () => {
      // Create some work items
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, status)
         VALUES ('Open Issue', 'issue', 'open'),
                ('Completed Issue', 'issue', 'completed')`,
      );

      // Create a contact
      await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Test Contact')`,
      );

      // Create a memory
      await pool.query(
        `INSERT INTO memory (title, content, memory_type)
         VALUES ('Test Memory', 'Content', 'note')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/bootstrap',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.stats.open_items).toBe(1);
      expect(body.stats.total_contacts).toBe(1);
      expect(body.stats.total_memories).toBe(1);
    });

    it('filters sections with include parameter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/bootstrap?include=stats,projects',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      // Should have stats and projects
      expect(body.stats).toBeDefined();
      expect(body.active_projects).toBeDefined();

      // Other sections should be empty (not fetched)
      expect(body.preferences).toEqual([]);
      expect(body.pending_reminders).toEqual([]);
      expect(body.key_contacts).toEqual([]);
    });

    it('excludes sections with exclude parameter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/bootstrap?exclude=activity,messages',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      // Excluded sections should be empty/zero
      expect(body.recent_activity).toEqual([]);
      expect(body.unread_messages).toBe(0);

      // Other sections should still be present
      expect(body.stats).toBeDefined();
      expect(body.active_projects).toBeDefined();
    });

    it('returns unread message count', async () => {
      // Create contact and endpoint first
      const contactResult = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Sender')
         RETURNING id`,
      );
      const contact_id = contactResult.rows[0].id;

      const endpointResult = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
         VALUES ($1, 'phone', '+15551234567', '+15551234567')
         RETURNING id`,
        [contact_id],
      );
      const endpointId = endpointResult.rows[0].id;

      // Create thread with required fields
      const threadResult = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'phone', 'thread-123')
         RETURNING id`,
        [endpointId],
      );
      const thread_id = threadResult.rows[0].id;

      // Create inbound messages (within 24 hours = unread)
      await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, received_at)
         VALUES ($1, 'msg1', 'inbound', 'Hello', NOW()),
                ($1, 'msg2', 'inbound', 'World', NOW())`,
        [thread_id],
      );

      // Create a work item and link one message to it (making it "read"/actioned)
      const workItemResult = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, status)
         VALUES ('Reply to message', 'issue', 'open')
         RETURNING id`,
      );
      const work_item_id = workItemResult.rows[0].id;

      const messageResult = await pool.query(`SELECT id FROM external_message WHERE external_message_key = 'msg1'`);
      const message_id = messageResult.rows[0].id;

      await pool.query(
        `INSERT INTO work_item_communication (work_item_id, thread_id, message_id, action)
         VALUES ($1, $2, $3, 'reply_required')`,
        [work_item_id, thread_id, message_id],
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/bootstrap',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      // msg1 is linked to work_item_communication (actioned), msg2 is not
      expect(body.unread_messages).toBe(1);
    });

    it('returns recent activity', async () => {
      // Create a work item that was updated recently
      await pool.query(
        `INSERT INTO work_item (title, work_item_kind, status, updated_at)
         VALUES ('Recent Work', 'issue', 'open', NOW())`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/bootstrap',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.recent_activity.length).toBeGreaterThan(0);
      expect(body.recent_activity[0].entity_title).toBe('Recent Work');
    });

    it('returns user settings when available', async () => {
      await pool.query(
        `INSERT INTO user_setting (email, theme, timezone)
         VALUES ('test@example.com', 'dark', 'Australia/Sydney')`,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/bootstrap?user_email=test@example.com',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.user.email).toBe('test@example.com');
      expect(body.user.timezone).toBe('Australia/Sydney');
      expect(body.user.settings.theme).toBe('dark');
    });
  });
});
