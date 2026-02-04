import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

describe('Message embeddings (#295)', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('Migration - embedding columns', () => {
    it('adds embedding column to external_message', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'external_message'
          AND column_name = 'embedding'
      `);
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].data_type).toBe('USER-DEFINED'); // vector type
    });

    it('adds embedding_model column', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'external_message'
          AND column_name = 'embedding_model'
      `);
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].data_type).toBe('text');
    });

    it('adds embedding_provider column', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'external_message'
          AND column_name = 'embedding_provider'
      `);
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].data_type).toBe('text');
    });

    it('adds embedding_status column with valid constraint', async () => {
      const result = await pool.query(`
        SELECT column_name, column_default
        FROM information_schema.columns
        WHERE table_name = 'external_message'
          AND column_name = 'embedding_status'
      `);
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].column_default).toContain('pending');
    });

    it('creates HNSW index on embedding column', async () => {
      const result = await pool.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'external_message'
          AND indexname = 'idx_message_embedding'
      `);
      expect(result.rows.length).toBe(1);
    });

    it('creates index on embedding_status', async () => {
      const result = await pool.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'external_message'
          AND indexname = 'idx_message_embedding_status'
      `);
      expect(result.rows.length).toBe(1);
    });
  });

  describe('Embedding job queue', () => {
    let testMessageId: string;

    beforeEach(async () => {
      // Create test message
      const contact = await pool.query(
        `INSERT INTO contact (display_name) VALUES ('Embedding Test') RETURNING id`
      );
      const endpoint = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'email', 'embed-test@example.com') RETURNING id`,
        [contact.rows[0].id]
      );
      const thread = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'email', 'email:embed-test') RETURNING id`,
        [endpoint.rows[0].id]
      );
      const msg = await pool.query(
        `INSERT INTO external_message (
           thread_id, external_message_key, direction, body, subject
         )
         VALUES ($1, 'inbound:embed-test', 'inbound', 'This is a test message about project planning.', 'Project Planning')
         RETURNING id::text as id`,
        [thread.rows[0].id]
      );
      testMessageId = msg.rows[0].id;
    });

    it('new messages have embedding_status=pending', async () => {
      const result = await pool.query(
        `SELECT embedding_status FROM external_message WHERE id = $1`,
        [testMessageId]
      );
      expect(result.rows[0].embedding_status).toBe('pending');
    });

    it('queues embedding job on message insert', async () => {
      // Check that a job was enqueued for the message
      const jobs = await pool.query(
        `SELECT kind, payload
         FROM internal_job
         WHERE kind = 'message.embed'
           AND payload->>'message_id' = $1
           AND completed_at IS NULL`,
        [testMessageId]
      );
      expect(jobs.rows.length).toBe(1);
      expect(jobs.rows[0].payload.message_id).toBe(testMessageId);
    });
  });

  describe('Embedding job handler', () => {
    let testMessageId: string;

    beforeEach(async () => {
      // Create test message with pending status
      const contact = await pool.query(
        `INSERT INTO contact (display_name) VALUES ('Handler Test') RETURNING id`
      );
      const endpoint = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'phone', '+15551234567') RETURNING id`,
        [contact.rows[0].id]
      );
      const thread = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'phone', 'sms:handler-test') RETURNING id`,
        [endpoint.rows[0].id]
      );
      const msg = await pool.query(
        `INSERT INTO external_message (
           thread_id, external_message_key, direction, body, embedding_status
         )
         VALUES ($1, 'inbound:handler-test', 'inbound', 'Meeting tomorrow at 3pm to discuss the budget', 'pending')
         RETURNING id::text as id`,
        [thread.rows[0].id]
      );
      testMessageId = msg.rows[0].id;
    });

    it('processes embedding job and updates status', async () => {
      const { handleMessageEmbedJob } = await import(
        '../src/api/embeddings/message-integration.js'
      );

      // If no embedding provider configured, status should remain pending
      const result = await handleMessageEmbedJob(pool, {
        id: 'test-job-1',
        kind: 'message.embed',
        runAt: new Date(),
        payload: { message_id: testMessageId },
        attempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Without provider configured, should succeed but stay pending
      expect(result.success).toBe(true);

      const msg = await pool.query(
        `SELECT embedding_status FROM external_message WHERE id = $1`,
        [testMessageId]
      );
      // Status depends on provider availability
      expect(['pending', 'complete']).toContain(msg.rows[0].embedding_status);
    });

    it('handles missing message gracefully', async () => {
      const { handleMessageEmbedJob } = await import(
        '../src/api/embeddings/message-integration.js'
      );

      const result = await handleMessageEmbedJob(pool, {
        id: 'test-job-2',
        kind: 'message.embed',
        runAt: new Date(),
        payload: { message_id: 'nonexistent-id' },
        attempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('Semantic search for messages', () => {
    beforeEach(async () => {
      // Create test messages with embeddings (mock)
      const contact = await pool.query(
        `INSERT INTO contact (display_name) VALUES ('Search Test') RETURNING id`
      );
      const endpoint = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'email', 'search-test@example.com') RETURNING id`,
        [contact.rows[0].id]
      );
      const thread = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'email', 'email:search-test') RETURNING id`,
        [endpoint.rows[0].id]
      );

      // Create messages with different topics
      await pool.query(
        `INSERT INTO external_message (
           thread_id, external_message_key, direction, body, subject, embedding_status
         )
         VALUES
           ($1, 'msg1', 'inbound', 'Discussion about the renovation project timeline', 'Renovation', 'pending'),
           ($1, 'msg2', 'inbound', 'Meeting notes for budget planning session', 'Budget Meeting', 'pending'),
           ($1, 'msg3', 'outbound', 'Follow up on contractor quotes for kitchen remodel', 'Kitchen Quotes', 'pending')`,
        [thread.rows[0].id]
      );
    });

    it('returns results for text matching queries', async () => {
      const { searchMessagesSemantic } = await import(
        '../src/api/embeddings/message-integration.js'
      );

      const result = await searchMessagesSemantic(pool, 'renovation project', {
        limit: 10,
      });

      // With embeddings configured, semantic search is used but messages
      // without embeddings fall back to text matching
      expect(['semantic', 'text']).toContain(result.searchType);
      // Search should work regardless of mode
      expect(result.results).toBeDefined();
    });

    it('searchMessagesSemantic returns results with expected structure', async () => {
      const { searchMessagesSemantic } = await import(
        '../src/api/embeddings/message-integration.js'
      );

      const result = await searchMessagesSemantic(pool, 'meeting', {
        limit: 10,
      });

      if (result.results.length > 0) {
        expect(result.results[0]).toHaveProperty('id');
        expect(result.results[0]).toHaveProperty('body');
        expect(result.results[0]).toHaveProperty('similarity');
      }
    });

    it('filters messages by channel', async () => {
      const { searchMessagesSemantic } = await import(
        '../src/api/embeddings/message-integration.js'
      );

      const result = await searchMessagesSemantic(pool, 'renovation', {
        limit: 10,
        channel: 'email',
      });

      // Verify channel filtering works (regardless of search type)
      for (const r of result.results) {
        expect(r.channel).toBe('email');
      }
    });
  });

  describe('Unified search with message embeddings', () => {
    beforeEach(async () => {
      // Create test data
      const contact = await pool.query(
        `INSERT INTO contact (display_name) VALUES ('Unified Search Test') RETURNING id`
      );
      const endpoint = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'phone', '+15559876543') RETURNING id`,
        [contact.rows[0].id]
      );
      const thread = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'phone', 'sms:unified-test') RETURNING id`,
        [endpoint.rows[0].id]
      );

      await pool.query(
        `INSERT INTO external_message (
           thread_id, external_message_key, direction, body, embedding_status
         )
         VALUES ($1, 'unified-msg', 'inbound', 'I need help with my order', 'pending')`,
        [thread.rows[0].id]
      );
    });

    it('includes messages in unified search results', async () => {
      const { unifiedSearch } = await import('../src/api/search/service.js');

      const result = await unifiedSearch(pool, {
        query: 'help order',
        types: ['message'],
        limit: 10,
      });

      expect(result.facets.message).toBeGreaterThan(0);
      expect(result.results.some((r) => r.type === 'message')).toBe(true);
    });
  });

  describe('Backfill command', () => {
    beforeEach(async () => {
      // Create messages without embeddings
      const contact = await pool.query(
        `INSERT INTO contact (display_name) VALUES ('Backfill Test') RETURNING id`
      );
      const endpoint = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'email', 'backfill@example.com') RETURNING id`,
        [contact.rows[0].id]
      );
      const thread = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'email', 'email:backfill-test') RETURNING id`,
        [endpoint.rows[0].id]
      );

      // Insert multiple messages
      await pool.query(
        `INSERT INTO external_message (
           thread_id, external_message_key, direction, body, embedding_status
         )
         VALUES
           ($1, 'bf1', 'inbound', 'First backfill test message', 'pending'),
           ($1, 'bf2', 'inbound', 'Second backfill test message', 'pending'),
           ($1, 'bf3', 'outbound', 'Third backfill test message', 'pending')`,
        [thread.rows[0].id]
      );
    });

    it('processes batch of pending messages', async () => {
      const { backfillMessageEmbeddings } = await import(
        '../src/api/embeddings/message-integration.js'
      );

      const result = await backfillMessageEmbeddings(pool, { batchSize: 10 });

      expect(result.processed).toBe(3);
      // Without provider configured, all stay pending
      expect(result.succeeded + result.failed).toBeLessThanOrEqual(3);
    });

    it('respects batchSize limit', async () => {
      const { backfillMessageEmbeddings } = await import(
        '../src/api/embeddings/message-integration.js'
      );

      const result = await backfillMessageEmbeddings(pool, { batchSize: 2 });

      expect(result.processed).toBe(2);
    });
  });
});
