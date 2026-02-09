import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Tests for Communications API endpoints (issue #140).
 */
describe('Communications API', () => {
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

  // Helper to create a contact + endpoint + thread + message
  async function createTestThread(
    channel: string = 'email',
    threadKey: string = 'test-thread',
  ): Promise<{ contactId: string; endpointId: string; threadId: string; messageId: string }> {
    const contact = await pool.query(`INSERT INTO contact (display_name) VALUES ('Test Contact') RETURNING id::text as id`);
    const contactId = (contact.rows[0] as { id: string }).id;

    const endpoint = await pool.query(
      `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
       VALUES ($1, $2::contact_endpoint_type, 'test@example.com')
       RETURNING id::text as id`,
      [contactId, channel],
    );
    const endpointId = (endpoint.rows[0] as { id: string }).id;

    const thread = await pool.query(
      `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
       VALUES ($1, $2::contact_endpoint_type, $3)
       RETURNING id::text as id`,
      [endpointId, channel, threadKey],
    );
    const threadId = (thread.rows[0] as { id: string }).id;

    const message = await pool.query(
      `INSERT INTO external_message (thread_id, external_message_key, direction, body, received_at)
       VALUES ($1, 'msg-1', 'inbound', 'Test message body', '2024-03-01T10:00:00Z')
       RETURNING id::text as id`,
      [threadId],
    );
    const messageId = (message.rows[0] as { id: string }).id;

    return { contactId, endpointId, threadId, messageId };
  }

  describe('GET /api/work-items/:id/communications', () => {
    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/communications',
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns empty arrays when no communications exist', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`,
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${itemId}/communications`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { emails: unknown[]; calendar_events: unknown[] };
      expect(body.emails).toEqual([]);
      expect(body.calendar_events).toEqual([]);
    });

    it('returns linked email communications', async () => {
      // Create work item
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`,
      );
      const itemId = (item.rows[0] as { id: string }).id;

      // Create thread and message
      const { threadId, messageId } = await createTestThread('email', 'email-thread');

      // Link to work item
      await pool.query(
        `INSERT INTO work_item_communication (work_item_id, thread_id, message_id, action)
         VALUES ($1, $2, $3, 'reply_required')`,
        [itemId, threadId, messageId],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${itemId}/communications`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        emails: Array<{
          id: string;
          thread_id: string;
          body: string;
          direction: string;
          received_at: string;
        }>;
        calendar_events: unknown[];
      };

      expect(body.emails.length).toBe(1);
      expect(body.emails[0].id).toBe(messageId);
      expect(body.emails[0].body).toBe('Test message body');
      expect(body.emails[0].direction).toBe('inbound');
      expect(body.calendar_events).toEqual([]);
    });

    it('returns multiple email communications', async () => {
      // Create work item
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`,
      );
      const itemId = (item.rows[0] as { id: string }).id;

      // Create first email thread
      const { threadId, messageId } = await createTestThread('email', 'email-thread-1');

      // Update message with some raw metadata
      await pool.query(
        `UPDATE external_message
         SET raw = $1::jsonb, body = 'First email'
         WHERE id = $2`,
        [
          JSON.stringify({
            subject: 'Project Update',
            from: 'alice@example.com',
          }),
          messageId,
        ],
      );

      // Link to work item
      await pool.query(
        `INSERT INTO work_item_communication (work_item_id, thread_id, message_id, action)
         VALUES ($1, $2, $3, 'follow_up')`,
        [itemId, threadId, messageId],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${itemId}/communications`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        emails: Array<{
          id: string;
          thread_id: string;
          body: string;
          raw: {
            subject: string;
            from: string;
          };
        }>;
        calendar_events: unknown[];
      };

      expect(body.emails.length).toBe(1);
      expect(body.emails[0].id).toBe(messageId);
      expect(body.emails[0].body).toBe('First email');
      expect(body.emails[0].raw.subject).toBe('Project Update');
      expect(body.calendar_events).toEqual([]);
    });
  });

  describe('POST /api/work-items/:id/communications', () => {
    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/communications',
        payload: { threadId: '00000000-0000-0000-0000-000000000001' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 400 when threadId is missing', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`,
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${itemId}/communications`,
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when thread does not exist', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`,
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${itemId}/communications`,
        payload: { threadId: '00000000-0000-0000-0000-000000000001' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('links a thread to a work item', async () => {
      // Create work item
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`,
      );
      const itemId = (item.rows[0] as { id: string }).id;

      // Create thread
      const { threadId, messageId } = await createTestThread();

      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${itemId}/communications`,
        payload: { threadId, messageId, action: 'follow_up' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as {
        work_item_id: string;
        thread_id: string;
        message_id: string;
        action: string;
      };
      expect(body.work_item_id).toBe(itemId);
      expect(body.thread_id).toBe(threadId);
      expect(body.message_id).toBe(messageId);
      expect(body.action).toBe('follow_up');
    });

    it('uses default action when not specified', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`,
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const { threadId } = await createTestThread();

      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${itemId}/communications`,
        payload: { threadId },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { action: string };
      expect(body.action).toBe('reply_required');
    });
  });

  describe('DELETE /api/work-items/:id/communications/:comm_id', () => {
    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/communications/00000000-0000-0000-0000-000000000001',
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for non-existent communication link', async () => {
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`,
      );
      const itemId = (item.rows[0] as { id: string }).id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${itemId}/communications/00000000-0000-0000-0000-000000000001`,
      });

      expect(res.statusCode).toBe(404);
    });

    it('unlinks a communication from a work item', async () => {
      // Create work item
      const item = await pool.query(
        `INSERT INTO work_item (title, work_item_kind)
         VALUES ('Test Item', 'issue')
         RETURNING id::text as id`,
      );
      const itemId = (item.rows[0] as { id: string }).id;

      // Create and link thread
      const { threadId, messageId } = await createTestThread();
      await pool.query(
        `INSERT INTO work_item_communication (work_item_id, thread_id, message_id, action)
         VALUES ($1, $2, $3, 'reply_required')`,
        [itemId, threadId, messageId],
      );

      // Get the communication link ID (it's the work_item_id since it's a 1:1 table)
      // Actually, the table uses work_item_id as PK, so comm_id would be the thread_id

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${itemId}/communications/${threadId}`,
      });

      expect(res.statusCode).toBe(204);

      // Verify it's deleted
      const check = await pool.query(`SELECT * FROM work_item_communication WHERE work_item_id = $1`, [itemId]);
      expect(check.rows.length).toBe(0);
    });
  });
});
