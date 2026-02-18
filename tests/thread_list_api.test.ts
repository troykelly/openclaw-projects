import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../src/api/server.ts';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

describe('Thread List API (Issue #1139)', () => {
  const app = buildServer();
  let pool: Pool;
  let testCounter = 0;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    testCounter = 0;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function createTestThreadWithMessage(channelType: string = 'phone') {
    testCounter++;
    const phoneNumber = `+1555123${String(testCounter).padStart(4, '0')}`;
    const email = `user${testCounter}@example.com`;
    const threadKey = `thread-${testCounter}`;

    // Create contact
    const contactResult = await pool.query(
      `INSERT INTO contact (display_name, notes)
       VALUES ($1, 'Test contact')
       RETURNING id::text as id`,
      [`Contact ${testCounter}`],
    );
    const contact_id = contactResult.rows[0].id as string;

    // Create endpoint
    const endpoint_value = channelType === 'email' ? email : phoneNumber;
    const endpoint_type = channelType === 'email' ? 'email' : 'phone';

    const endpointResult = await pool.query(
      `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
       VALUES ($1, $2, $3, $3)
       RETURNING id::text as id`,
      [contact_id, endpoint_type, endpoint_value],
    );
    const endpointId = endpointResult.rows[0].id as string;

    // Create thread
    const threadResult = await pool.query(
      `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
       VALUES ($1, $2, $3)
       RETURNING id::text as id`,
      [endpointId, channelType, threadKey],
    );
    const thread_id = threadResult.rows[0].id as string;

    // Add a message
    await pool.query(
      `INSERT INTO external_message (thread_id, external_message_key, direction, body, received_at)
       VALUES ($1, $2, 'inbound', $3, NOW())`,
      [thread_id, `msg-${testCounter}`, `Hello from thread ${testCounter}`],
    );

    return { contact_id, endpointId, thread_id };
  }

  describe('GET /api/threads', () => {
    it('returns empty list when no threads exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/threads',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.threads).toEqual([]);
      expect(body.total).toBe(0);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.limit).toBe(20);
      expect(body.pagination.offset).toBe(0);
      expect(body.pagination.has_more).toBe(false);
    });

    it('returns list of threads with last message preview', async () => {
      const { thread_id: thread1Id } = await createTestThreadWithMessage('phone');
      const { thread_id: thread2Id } = await createTestThreadWithMessage('email');

      const res = await app.inject({
        method: 'GET',
        url: '/api/threads',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.threads.length).toBe(2);
      expect(body.total).toBe(2);

      // Check structure of first thread
      const thread = body.threads[0];
      expect(thread.id).toBeDefined();
      expect(thread.channel).toBeDefined();
      expect(thread.contact).toBeDefined();
      expect(thread.contact.display_name).toBeDefined();
      expect(thread.last_message).toBeDefined();
      expect(thread.last_message.body).toContain('Hello from thread');
      expect(thread.message_count).toBeGreaterThan(0);
    });

    it('respects limit parameter', async () => {
      await createTestThreadWithMessage();
      await createTestThreadWithMessage();
      await createTestThreadWithMessage();

      const res = await app.inject({
        method: 'GET',
        url: '/api/threads?limit=2',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.threads.length).toBe(2);
      expect(body.total).toBe(3);
      expect(body.pagination.has_more).toBe(true);
    });

    it('supports offset pagination', async () => {
      await createTestThreadWithMessage();
      await createTestThreadWithMessage();
      await createTestThreadWithMessage();

      const res = await app.inject({
        method: 'GET',
        url: '/api/threads?limit=2&offset=1',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.threads.length).toBe(2);
      expect(body.pagination.offset).toBe(1);
      expect(body.pagination.has_more).toBe(false);
    });

    it('filters by channel', async () => {
      const { thread_id: smsThreadId } = await createTestThreadWithMessage('phone');
      const { thread_id: emailThreadId } = await createTestThreadWithMessage('email');

      const res = await app.inject({
        method: 'GET',
        url: '/api/threads?channel=email',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.threads.length).toBe(1);
      expect(body.threads[0].channel).toBe('email');
    });

    it('filters by contact_id', async () => {
      const { contact_id, thread_id } = await createTestThreadWithMessage();
      await createTestThreadWithMessage(); // Create another thread with different contact

      const res = await app.inject({
        method: 'GET',
        url: `/api/threads?contact_id=${contact_id}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.threads.length).toBe(1);
      expect(body.threads[0].id).toBe(thread_id);
      expect(body.threads[0].contact.id).toBe(contact_id);
    });
  });
});
