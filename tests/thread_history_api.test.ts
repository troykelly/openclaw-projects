import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

describe('Thread History API (Issue #226)', () => {
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

  async function createTestThread() {
    // Create contact
    const contactResult = await pool.query(
      `INSERT INTO contact (display_name, notes)
       VALUES ('John Smith', 'Friend from work')
       RETURNING id::text as id`,
    );
    const contact_id = contactResult.rows[0].id as string;

    // Create endpoint
    const endpointResult = await pool.query(
      `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
       VALUES ($1, 'phone', '+15551234567', '+15551234567')
       RETURNING id::text as id`,
      [contact_id],
    );
    const endpointId = endpointResult.rows[0].id as string;

    // Create thread
    const threadResult = await pool.query(
      `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
       VALUES ($1, 'phone', 'thread-123')
       RETURNING id::text as id`,
      [endpointId],
    );
    const thread_id = threadResult.rows[0].id as string;

    return { contact_id, endpointId, thread_id };
  }

  describe('GET /api/threads/:id/history', () => {
    it('returns thread info with contact details', async () => {
      const { thread_id } = await createTestThread();

      const res = await app.inject({
        method: 'GET',
        url: `/api/threads/${thread_id}/history`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.thread).toBeDefined();
      expect(body.thread.id).toBe(thread_id);
      expect(body.thread.channel).toBe('phone');
      expect(body.thread.contact.display_name).toBe('John Smith');
      expect(body.thread.contact.notes).toBe('Friend from work');
    });

    it('returns 404 for non-existent thread', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/threads/00000000-0000-0000-0000-000000000000/history',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('Thread not found');
    });

    it('returns messages in chronological order', async () => {
      const { thread_id } = await createTestThread();

      // Create messages
      await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, received_at)
         VALUES ($1, 'msg1', 'inbound', 'Hello', NOW() - interval '2 hours'),
                ($1, 'msg2', 'outbound', 'Hi there!', NOW() - interval '1 hour'),
                ($1, 'msg3', 'inbound', 'How are you?', NOW())`,
        [thread_id],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/threads/${thread_id}/history`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.messages.length).toBe(3);
      expect(body.messages[0].body).toBe('Hello');
      expect(body.messages[0].direction).toBe('inbound');
      expect(body.messages[1].body).toBe('Hi there!');
      expect(body.messages[1].direction).toBe('outbound');
      expect(body.messages[2].body).toBe('How are you?');
    });

    it('respects limit parameter', async () => {
      const { thread_id } = await createTestThread();

      // Create 5 messages
      for (let i = 0; i < 5; i++) {
        await pool.query(
          `INSERT INTO external_message (thread_id, external_message_key, direction, body, received_at)
           VALUES ($1, $2, 'inbound', $3, NOW() - interval '${5 - i} hours')`,
          [thread_id, `msg${i}`, `Message ${i}`],
        );
      }

      const res = await app.inject({
        method: 'GET',
        url: `/api/threads/${thread_id}/history?limit=3`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.messages.length).toBe(3);
      expect(body.pagination.has_more).toBe(true);
    });

    it('returns related work items', async () => {
      const { thread_id } = await createTestThread();

      // Create message
      const msgResult = await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body)
         VALUES ($1, 'msg1', 'inbound', 'Can we reschedule?')
         RETURNING id::text as id`,
        [thread_id],
      );
      const message_id = msgResult.rows[0].id as string;

      // Create work item linked to thread
      const wiResult = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, status, not_before)
         VALUES ('Lunch with John', 'issue', 'open', NOW() + interval '1 day')
         RETURNING id::text as id`,
      );
      const work_item_id = wiResult.rows[0].id as string;

      await pool.query(
        `INSERT INTO work_item_communication (work_item_id, thread_id, message_id, action)
         VALUES ($1, $2, $3, 'reply_required')`,
        [work_item_id, thread_id, message_id],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/threads/${thread_id}/history`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.related_work_items.length).toBe(1);
      expect(body.related_work_items[0].title).toBe('Lunch with John');
      expect(body.related_work_items[0].status).toBe('open');
      expect(body.related_work_items[0].not_before).toBeDefined();
    });

    it('returns contact memories', async () => {
      const { thread_id, contact_id } = await createTestThread();

      // Create a memory for the contact
      await pool.query(
        `INSERT INTO memory (title, content, memory_type, contact_id, importance)
         VALUES ('Scheduling preference', 'Prefers afternoon meetings', 'preference', $1, 8)`,
        [contact_id],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/threads/${thread_id}/history`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.contact_memories.length).toBe(1);
      expect(body.contact_memories[0].title).toBe('Scheduling preference');
      expect(body.contact_memories[0].memory_type).toBe('preference');
      expect(body.contact_memories[0].importance).toBe(8);
    });

    it('excludes work items when include_work_items=false', async () => {
      const { thread_id } = await createTestThread();

      const res = await app.inject({
        method: 'GET',
        url: `/api/threads/${thread_id}/history?include_work_items=false`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.related_work_items).toEqual([]);
    });

    it('excludes memories when include_memories=false', async () => {
      const { thread_id, contact_id } = await createTestThread();

      await pool.query(
        `INSERT INTO memory (title, content, memory_type, contact_id)
         VALUES ('Test memory', 'Content', 'note', $1)`,
        [contact_id],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/threads/${thread_id}/history?include_memories=false`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.contact_memories).toEqual([]);
    });

    it('supports before pagination', async () => {
      const { thread_id } = await createTestThread();

      // Create messages at different times
      await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, received_at)
         VALUES ($1, 'msg1', 'inbound', 'First', '2026-01-01T10:00:00Z'),
                ($1, 'msg2', 'inbound', 'Second', '2026-01-01T11:00:00Z'),
                ($1, 'msg3', 'inbound', 'Third', '2026-01-01T12:00:00Z')`,
        [thread_id],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/threads/${thread_id}/history?before=2026-01-01T12:00:00Z`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.messages.length).toBe(2);
      expect(body.messages[0].body).toBe('First');
      expect(body.messages[1].body).toBe('Second');
    });

    it('supports after pagination', async () => {
      const { thread_id } = await createTestThread();

      // Create messages at different times
      await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, received_at)
         VALUES ($1, 'msg1', 'inbound', 'First', '2026-01-01T10:00:00Z'),
                ($1, 'msg2', 'inbound', 'Second', '2026-01-01T11:00:00Z'),
                ($1, 'msg3', 'inbound', 'Third', '2026-01-01T12:00:00Z')`,
        [thread_id],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/threads/${thread_id}/history?after=2026-01-01T10:00:00Z`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.messages.length).toBe(2);
      expect(body.messages[0].body).toBe('Second');
      expect(body.messages[1].body).toBe('Third');
    });

    it('returns pagination metadata', async () => {
      const { thread_id } = await createTestThread();

      await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, received_at)
         VALUES ($1, 'msg1', 'inbound', 'Message', NOW())`,
        [thread_id],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/threads/${thread_id}/history`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.pagination).toBeDefined();
      expect(body.pagination.has_more).toBe(false);
      expect(body.pagination.oldest_timestamp).toBeDefined();
      expect(body.pagination.newest_timestamp).toBeDefined();
    });

    it('includes email-specific fields when present', async () => {
      // Create contact with email endpoint
      const contactResult = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Email User')
         RETURNING id::text as id`,
      );
      const contact_id = contactResult.rows[0].id as string;

      const endpointResult = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
         VALUES ($1, 'email', 'user@example.com', 'user@example.com')
         RETURNING id::text as id`,
        [contact_id],
      );
      const endpointId = endpointResult.rows[0].id as string;

      const threadResult = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'email', 'email-thread-123')
         RETURNING id::text as id`,
        [endpointId],
      );
      const thread_id = threadResult.rows[0].id as string;

      // Create email message with subject
      await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, subject, from_address)
         VALUES ($1, 'email1', 'inbound', 'Email body', 'Meeting Request', 'user@example.com')`,
        [thread_id],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/threads/${thread_id}/history`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.messages.length).toBe(1);
      expect(body.messages[0].subject).toBe('Meeting Request');
      expect(body.messages[0].from_address).toBe('user@example.com');
    });
  });

  describe('API Capabilities', () => {
    it('includes threads capability in /api/capabilities', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/capabilities',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      const threadsCapability = body.capabilities.find((c: { name: string }) => c.name === 'threads');

      expect(threadsCapability).toBeDefined();
      expect(threadsCapability.endpoints[0].path).toBe('/api/threads/:id/history');
    });
  });
});
