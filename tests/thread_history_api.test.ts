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
    const contactId = contactResult.rows[0].id as string;

    // Create endpoint
    const endpointResult = await pool.query(
      `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
       VALUES ($1, 'phone', '+15551234567', '+15551234567')
       RETURNING id::text as id`,
      [contactId],
    );
    const endpointId = endpointResult.rows[0].id as string;

    // Create thread
    const threadResult = await pool.query(
      `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
       VALUES ($1, 'phone', 'thread-123')
       RETURNING id::text as id`,
      [endpointId],
    );
    const threadId = threadResult.rows[0].id as string;

    return { contactId, endpointId, threadId };
  }

  describe('GET /api/threads/:id/history', () => {
    it('returns thread info with contact details', async () => {
      const { threadId } = await createTestThread();

      const res = await app.inject({
        method: 'GET',
        url: `/api/threads/${threadId}/history`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.thread).toBeDefined();
      expect(body.thread.id).toBe(threadId);
      expect(body.thread.channel).toBe('phone');
      expect(body.thread.contact.displayName).toBe('John Smith');
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
      const { threadId } = await createTestThread();

      // Create messages
      await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, received_at)
         VALUES ($1, 'msg1', 'inbound', 'Hello', NOW() - interval '2 hours'),
                ($1, 'msg2', 'outbound', 'Hi there!', NOW() - interval '1 hour'),
                ($1, 'msg3', 'inbound', 'How are you?', NOW())`,
        [threadId],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/threads/${threadId}/history`,
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
      const { threadId } = await createTestThread();

      // Create 5 messages
      for (let i = 0; i < 5; i++) {
        await pool.query(
          `INSERT INTO external_message (thread_id, external_message_key, direction, body, received_at)
           VALUES ($1, $2, 'inbound', $3, NOW() - interval '${5 - i} hours')`,
          [threadId, `msg${i}`, `Message ${i}`],
        );
      }

      const res = await app.inject({
        method: 'GET',
        url: `/api/threads/${threadId}/history?limit=3`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.messages.length).toBe(3);
      expect(body.pagination.hasMore).toBe(true);
    });

    it('returns related work items', async () => {
      const { threadId } = await createTestThread();

      // Create message
      const msgResult = await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body)
         VALUES ($1, 'msg1', 'inbound', 'Can we reschedule?')
         RETURNING id::text as id`,
        [threadId],
      );
      const messageId = msgResult.rows[0].id as string;

      // Create work item linked to thread
      const wiResult = await pool.query(
        `INSERT INTO work_item (title, work_item_kind, status, not_before)
         VALUES ('Lunch with John', 'issue', 'open', NOW() + interval '1 day')
         RETURNING id::text as id`,
      );
      const workItemId = wiResult.rows[0].id as string;

      await pool.query(
        `INSERT INTO work_item_communication (work_item_id, thread_id, message_id, action)
         VALUES ($1, $2, $3, 'reply_required')`,
        [workItemId, threadId, messageId],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/threads/${threadId}/history`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.relatedWorkItems.length).toBe(1);
      expect(body.relatedWorkItems[0].title).toBe('Lunch with John');
      expect(body.relatedWorkItems[0].status).toBe('open');
      expect(body.relatedWorkItems[0].notBefore).toBeDefined();
    });

    it('returns contact memories', async () => {
      const { threadId, contactId } = await createTestThread();

      // Create a memory for the contact
      await pool.query(
        `INSERT INTO memory (title, content, memory_type, contact_id, importance)
         VALUES ('Scheduling preference', 'Prefers afternoon meetings', 'preference', $1, 8)`,
        [contactId],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/threads/${threadId}/history`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.contactMemories.length).toBe(1);
      expect(body.contactMemories[0].title).toBe('Scheduling preference');
      expect(body.contactMemories[0].memoryType).toBe('preference');
      expect(body.contactMemories[0].importance).toBe(8);
    });

    it('excludes work items when include_work_items=false', async () => {
      const { threadId } = await createTestThread();

      const res = await app.inject({
        method: 'GET',
        url: `/api/threads/${threadId}/history?include_work_items=false`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.relatedWorkItems).toEqual([]);
    });

    it('excludes memories when include_memories=false', async () => {
      const { threadId, contactId } = await createTestThread();

      await pool.query(
        `INSERT INTO memory (title, content, memory_type, contact_id)
         VALUES ('Test memory', 'Content', 'note', $1)`,
        [contactId],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/threads/${threadId}/history?include_memories=false`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.contactMemories).toEqual([]);
    });

    it('supports before pagination', async () => {
      const { threadId } = await createTestThread();

      // Create messages at different times
      await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, received_at)
         VALUES ($1, 'msg1', 'inbound', 'First', '2026-01-01T10:00:00Z'),
                ($1, 'msg2', 'inbound', 'Second', '2026-01-01T11:00:00Z'),
                ($1, 'msg3', 'inbound', 'Third', '2026-01-01T12:00:00Z')`,
        [threadId],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/threads/${threadId}/history?before=2026-01-01T12:00:00Z`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.messages.length).toBe(2);
      expect(body.messages[0].body).toBe('First');
      expect(body.messages[1].body).toBe('Second');
    });

    it('supports after pagination', async () => {
      const { threadId } = await createTestThread();

      // Create messages at different times
      await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, received_at)
         VALUES ($1, 'msg1', 'inbound', 'First', '2026-01-01T10:00:00Z'),
                ($1, 'msg2', 'inbound', 'Second', '2026-01-01T11:00:00Z'),
                ($1, 'msg3', 'inbound', 'Third', '2026-01-01T12:00:00Z')`,
        [threadId],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/threads/${threadId}/history?after=2026-01-01T10:00:00Z`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.messages.length).toBe(2);
      expect(body.messages[0].body).toBe('Second');
      expect(body.messages[1].body).toBe('Third');
    });

    it('returns pagination metadata', async () => {
      const { threadId } = await createTestThread();

      await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, received_at)
         VALUES ($1, 'msg1', 'inbound', 'Message', NOW())`,
        [threadId],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/threads/${threadId}/history`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.pagination).toBeDefined();
      expect(body.pagination.hasMore).toBe(false);
      expect(body.pagination.oldestTimestamp).toBeDefined();
      expect(body.pagination.newestTimestamp).toBeDefined();
    });

    it('includes email-specific fields when present', async () => {
      // Create contact with email endpoint
      const contactResult = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Email User')
         RETURNING id::text as id`,
      );
      const contactId = contactResult.rows[0].id as string;

      const endpointResult = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
         VALUES ($1, 'email', 'user@example.com', 'user@example.com')
         RETURNING id::text as id`,
        [contactId],
      );
      const endpointId = endpointResult.rows[0].id as string;

      const threadResult = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'email', 'email-thread-123')
         RETURNING id::text as id`,
        [endpointId],
      );
      const threadId = threadResult.rows[0].id as string;

      // Create email message with subject
      await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, subject, from_address)
         VALUES ($1, 'email1', 'inbound', 'Email body', 'Meeting Request', 'user@example.com')`,
        [threadId],
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/threads/${threadId}/history`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.messages.length).toBe(1);
      expect(body.messages[0].subject).toBe('Meeting Request');
      expect(body.messages[0].fromAddress).toBe('user@example.com');
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
