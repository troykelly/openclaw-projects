import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Tests for Communications in Work Item detail (issue #141).
 * These tests verify the communications API endpoints work for the detail view.
 */
describe('Communications in Work Item Detail', () => {
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

  describe('GET /api/work-items/:id/communications', () => {
    it('returns emails and calendar events for a work item', async () => {
      // Create a work item
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`,
      );
      const item_id = (item.rows[0] as { id: string }).id;

      // Create a contact with endpoint
      const contact = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Test Contact')
         RETURNING id::text as id`,
      );
      const contact_id = (contact.rows[0] as { id: string }).id;

      const endpoint = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
         VALUES ($1, 'email', 'test@example.com', 'test@example.com')
         RETURNING id::text as id`,
        [contact_id],
      );
      const endpointId = (endpoint.rows[0] as { id: string }).id;

      // Create external thread
      const thread = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'email', 'thread-123')
         RETURNING id::text as id`,
        [endpointId],
      );
      const thread_id = (thread.rows[0] as { id: string }).id;

      // Create email message (uses direction, body, received_at)
      const message = await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, received_at)
         VALUES ($1, 'msg-123', 'inbound', 'Test body content', now())
         RETURNING id::text as id`,
        [thread_id],
      );
      const message_id = (message.rows[0] as { id: string }).id;

      // Link thread to work item with message
      await pool.query(
        `INSERT INTO work_item_communication (work_item_id, thread_id, message_id, action)
         VALUES ($1, $2, $3, 'reply_required')`,
        [item_id, thread_id, message_id],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${item_id}/communications`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { emails: unknown[]; calendar_events: unknown[] };
      expect(body.emails).toBeDefined();
      expect(body.calendar_events).toBeDefined();
      expect(body.emails.length).toBe(1);
    });

    it('returns empty arrays for work item with no communications', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Empty Item', 'issue')
         RETURNING id::text as id`,
      );
      const item_id = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${item_id}/communications`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { emails: unknown[]; calendar_events: unknown[] };
      expect(body.emails).toEqual([]);
      expect(body.calendar_events).toEqual([]);
    });

    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/communications',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/work-items/:id/communications', () => {
    it('links a communication thread to a work item', async () => {
      // Create a work item
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`,
      );
      const item_id = (item.rows[0] as { id: string }).id;

      // Create a contact with endpoint
      const contact = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Test Contact')
         RETURNING id::text as id`,
      );
      const contact_id = (contact.rows[0] as { id: string }).id;

      const endpoint = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
         VALUES ($1, 'email', 'link@example.com', 'link@example.com')
         RETURNING id::text as id`,
        [contact_id],
      );
      const endpointId = (endpoint.rows[0] as { id: string }).id;

      // Create unlinked thread
      const thread = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'email', 'unlinked-thread')
         RETURNING id::text as id`,
        [endpointId],
      );
      const thread_id = (thread.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${item_id}/communications`,
        payload: {
          thread_id: thread_id, // camelCase as expected by API
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { work_item_id: string; thread_id: string };
      expect(body.work_item_id).toBe(item_id);
      expect(body.thread_id).toBe(thread_id);
    });

    it('returns 400 when thread_id is missing', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`,
      );
      const item_id = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${item_id}/communications`,
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('DELETE /api/work-items/:id/communications/:commId', () => {
    it('unlinks a communication from a work item', async () => {
      // Create a work item
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`,
      );
      const item_id = (item.rows[0] as { id: string }).id;

      // Create a contact with endpoint
      const contact = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Test Contact')
         RETURNING id::text as id`,
      );
      const contact_id = (contact.rows[0] as { id: string }).id;

      const endpoint = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
         VALUES ($1, 'email', 'delete@example.com', 'delete@example.com')
         RETURNING id::text as id`,
        [contact_id],
      );
      const endpointId = (endpoint.rows[0] as { id: string }).id;

      // Create thread
      const thread = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'email', 'delete-thread')
         RETURNING id::text as id`,
        [endpointId],
      );
      const thread_id = (thread.rows[0] as { id: string }).id;

      // Create message
      const message = await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, received_at)
         VALUES ($1, 'delete-msg', 'inbound', 'Delete me', now())
         RETURNING id::text as id`,
        [thread_id],
      );
      const message_id = (message.rows[0] as { id: string }).id;

      // Link thread to work item - work_item_id is PK, thread_id is used as commId for deletion
      await pool.query(
        `INSERT INTO work_item_communication (work_item_id, thread_id, message_id, action)
         VALUES ($1, $2, $3, 'reply_required')`,
        [item_id, thread_id, message_id],
      );

      // DELETE uses thread_id as commId
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${item_id}/communications/${thread_id}`,
      });

      expect(res.statusCode).toBe(204);

      // Verify unlinked
      const checkRes = await app.inject({
        method: 'GET',
        url: `/api/work-items/${item_id}/communications`,
      });
      const body = checkRes.json() as { emails: unknown[] };
      expect(body.emails.length).toBe(0);
    });

    it('returns 404 for non-existent communication', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`,
      );
      const item_id = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${item_id}/communications/00000000-0000-0000-0000-000000000000`,
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
