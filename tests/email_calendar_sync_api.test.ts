import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

/**
 * Tests for Email & Calendar Sync API endpoints (issue #184).
 */
describe('Email & Calendar Sync API', () => {
  let app: ReturnType<typeof buildServer>;
  let pool: Pool;
  const originalEnv = process.env;

  beforeAll(async () => {
    // Configure OAuth providers for tests
    process.env = { ...originalEnv };
    process.env.GOOGLE_CLIENT_ID = 'test-google-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
    process.env.MS365_CLIENT_ID = 'test-ms-id';
    process.env.MS365_CLIENT_SECRET = 'test-ms-secret';
    process.env.OPENCLAW_PROJECTS_AUTH_DISABLED = 'true';

    await runMigrate('up');
    pool = createTestPool();
    app = buildServer({ logger: false });
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    process.env = originalEnv;
  });

  describe('OAuth Connections', () => {
    describe('GET /api/oauth/connections', () => {
      it('returns empty list when no connections exist', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/api/oauth/connections',
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.connections).toBeDefined();
        expect(body.connections).toHaveLength(0);
      });

      it('returns existing OAuth connections', async () => {
        await pool.query(
          `INSERT INTO oauth_connection (user_email, provider, access_token, refresh_token, scopes, expires_at)
           VALUES ('user@example.com', 'google', 'test-access-token', 'test-refresh-token', ARRAY['email', 'calendar'], now() + interval '1 hour')`,
        );

        const response = await app.inject({
          method: 'GET',
          url: '/api/oauth/connections?userEmail=user@example.com',
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.connections).toHaveLength(1);
        expect(body.connections[0].provider).toBe('google');
        expect(body.connections[0].scopes).toContain('email');
      });
    });

    describe('GET /api/oauth/authorize/:provider', () => {
      it('returns authorization URL for google', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/api/oauth/authorize/google?userEmail=user@example.com&scopes=email,calendar',
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.authUrl).toBeDefined();
        expect(body.state).toBeDefined();
      });

      it('returns authorization URL for microsoft', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/api/oauth/authorize/microsoft?userEmail=user@example.com&scopes=email,calendar',
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.authUrl).toBeDefined();
      });

      it('returns 400 for unknown provider', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/api/oauth/authorize/unknown?userEmail=user@example.com',
        });

        expect(response.statusCode).toBe(400);
      });
    });

    describe('DELETE /api/oauth/connections/:id', () => {
      it('deletes an OAuth connection', async () => {
        const insertRes = await pool.query(
          `INSERT INTO oauth_connection (user_email, provider, access_token, refresh_token, scopes, expires_at)
           VALUES ('user@example.com', 'google', 'test-token', 'refresh', ARRAY['email'], now() + interval '1 hour')
           RETURNING id`,
        );
        const connectionId = insertRes.rows[0].id;

        const response = await app.inject({
          method: 'DELETE',
          url: `/api/oauth/connections/${connectionId}`,
        });

        expect(response.statusCode).toBe(204);

        const checkRes = await pool.query(`SELECT id FROM oauth_connection WHERE id = $1`, [connectionId]);
        expect(checkRes.rows).toHaveLength(0);
      });

      it('returns 404 for non-existent connection', async () => {
        const response = await app.inject({
          method: 'DELETE',
          url: '/api/oauth/connections/00000000-0000-0000-0000-000000000000',
        });

        expect(response.statusCode).toBe(404);
      });
    });
  });

  describe('Email Sync', () => {
    describe('POST /api/sync/emails', () => {
      it('returns live_api status for valid connection (no sync needed)', async () => {
        // Create OAuth connection first
        const connResult = await pool.query(
          `INSERT INTO oauth_connection (user_email, provider, access_token, refresh_token, scopes, expires_at)
           VALUES ('user@example.com', 'google', 'test-token', 'refresh', ARRAY['email'], now() + interval '1 hour')
           RETURNING id::text`,
        );
        const connectionId = connResult.rows[0].id;

        const response = await app.inject({
          method: 'POST',
          url: '/api/sync/emails',
          payload: {
            connectionId,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.status).toBe('live_api');
        expect(body.connectionId).toBe(connectionId);
        expect(body.provider).toBe('google');
      });

      it('returns 400 when no OAuth connection exists', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/sync/emails',
          payload: {
            connectionId: '00000000-0000-0000-0000-000000000000',
          },
        });

        expect(response.statusCode).toBe(400);
      });
    });

    describe('GET /api/emails', () => {
      it('returns synced emails for a user', async () => {
        // Create contact and endpoint
        const contactRes = await pool.query(`INSERT INTO contact (display_name) VALUES ('Test User') RETURNING id`);
        const contactId = contactRes.rows[0].id;

        const endpointRes = await pool.query(
          `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
           VALUES ($1, 'email', 'test@example.com', 'test@example.com')
           RETURNING id`,
          [contactId],
        );
        const endpointId = endpointRes.rows[0].id;

        // Create thread and message
        const threadRes = await pool.query(
          `INSERT INTO external_thread (endpoint_id, channel, external_thread_key, sync_provider)
           VALUES ($1, 'email', 'thread-123', 'google')
           RETURNING id`,
          [endpointId],
        );
        const threadId = threadRes.rows[0].id;

        await pool.query(
          `INSERT INTO external_message (thread_id, external_message_key, direction, body, subject)
           VALUES ($1, 'msg-123', 'inbound', 'Hello!', 'Test Subject')`,
          [threadId],
        );

        const response = await app.inject({
          method: 'GET',
          url: '/api/emails?provider=google',
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.emails).toBeDefined();
        expect(body.emails.length).toBeGreaterThan(0);
        expect(body.emails[0].subject).toBe('Test Subject');
      });
    });

    describe('POST /api/emails/send', () => {
      it('sends an email reply', async () => {
        // Create OAuth connection
        await pool.query(
          `INSERT INTO oauth_connection (user_email, provider, access_token, refresh_token, scopes, expires_at)
           VALUES ('user@example.com', 'google', 'test-token', 'refresh', ARRAY['email'], now() + interval '1 hour')`,
        );

        // Create contact and thread
        const contactRes = await pool.query(`INSERT INTO contact (display_name) VALUES ('Test User') RETURNING id`);
        const contactId = contactRes.rows[0].id;

        const endpointRes = await pool.query(
          `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
           VALUES ($1, 'email', 'recipient@example.com', 'recipient@example.com')
           RETURNING id`,
          [contactId],
        );
        const endpointId = endpointRes.rows[0].id;

        const threadRes = await pool.query(
          `INSERT INTO external_thread (endpoint_id, channel, external_thread_key, sync_provider)
           VALUES ($1, 'email', 'thread-456', 'google')
           RETURNING id`,
          [endpointId],
        );
        const threadId = threadRes.rows[0].id;

        const response = await app.inject({
          method: 'POST',
          url: '/api/emails/send',
          payload: {
            userEmail: 'user@example.com',
            threadId: threadId,
            body: 'This is my reply',
          },
        });

        expect(response.statusCode).toBe(202);
        const body = response.json();
        expect(body.status).toBe('queued');
      });
    });

    describe('POST /api/emails/create-work-item', () => {
      it('creates a work item from an email', async () => {
        // Create contact and endpoint
        const contactRes = await pool.query(`INSERT INTO contact (display_name) VALUES ('Test User') RETURNING id`);
        const contactId = contactRes.rows[0].id;

        const endpointRes = await pool.query(
          `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
           VALUES ($1, 'email', 'test@example.com', 'test@example.com')
           RETURNING id`,
          [contactId],
        );
        const endpointId = endpointRes.rows[0].id;

        // Create thread and message
        const threadRes = await pool.query(
          `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
           VALUES ($1, 'email', 'thread-789')
           RETURNING id`,
          [endpointId],
        );
        const threadId = threadRes.rows[0].id;

        const messageRes = await pool.query(
          `INSERT INTO external_message (thread_id, external_message_key, direction, body, subject)
           VALUES ($1, 'msg-789', 'inbound', 'Please review the document.', 'Action Required: Review')
           RETURNING id`,
          [threadId],
        );
        const messageId = messageRes.rows[0].id;

        const response = await app.inject({
          method: 'POST',
          url: '/api/emails/create-work-item',
          payload: {
            messageId: messageId,
            title: 'Review document from email',
          },
        });

        expect(response.statusCode).toBe(201);
        const body = response.json();
        expect(body.workItem).toBeDefined();
        expect(body.workItem.id).toBeDefined();
        expect(body.workItem.title).toBe('Review document from email');
      });
    });
  });

  describe('Calendar Sync', () => {
    describe('POST /api/sync/calendar', () => {
      it('returns 501 not implemented', async () => {
        const connResult = await pool.query(
          `INSERT INTO oauth_connection (user_email, provider, access_token, refresh_token, scopes, expires_at)
           VALUES ('user@example.com', 'google', 'test-token', 'refresh', ARRAY['calendar'], now() + interval '1 hour')
           RETURNING id::text`,
        );
        const connectionId = connResult.rows[0].id;

        const response = await app.inject({
          method: 'POST',
          url: '/api/sync/calendar',
          payload: {
            connectionId,
          },
        });

        expect(response.statusCode).toBe(501);
        const body = response.json();
        expect(body.error).toBe('Calendar sync is not yet implemented');
        expect(body.status).toBe('not_implemented');
      });
    });

    describe('GET /api/calendar/events', () => {
      it('returns calendar events', async () => {
        await pool.query(
          `INSERT INTO calendar_event (user_email, provider, external_event_id, title, start_time, end_time)
           VALUES ('user@example.com', 'google', 'evt-123', 'Team Meeting', now(), now() + interval '1 hour')`,
        );

        const response = await app.inject({
          method: 'GET',
          url: '/api/calendar/events?userEmail=user@example.com',
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.events).toBeDefined();
        expect(body.events.length).toBeGreaterThan(0);
        expect(body.events[0].title).toBe('Team Meeting');
      });

      it('filters events by date range', async () => {
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        await pool.query(
          `INSERT INTO calendar_event (user_email, provider, external_event_id, title, start_time, end_time)
           VALUES ('user@example.com', 'google', 'evt-456', 'Future Meeting', $1, $2)`,
          [tomorrow.toISOString(), new Date(tomorrow.getTime() + 60 * 60 * 1000).toISOString()],
        );

        const response = await app.inject({
          method: 'GET',
          url: `/api/calendar/events?userEmail=user@example.com&startAfter=${now.toISOString()}`,
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.events).toBeDefined();
      });
    });

    describe('POST /api/calendar/events', () => {
      it('creates a calendar event', async () => {
        await pool.query(
          `INSERT INTO oauth_connection (user_email, provider, access_token, refresh_token, scopes, expires_at)
           VALUES ('user@example.com', 'google', 'test-token', 'refresh', ARRAY['calendar'], now() + interval '1 hour')`,
        );

        const startTime = new Date();
        const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);

        const response = await app.inject({
          method: 'POST',
          url: '/api/calendar/events',
          payload: {
            userEmail: 'user@example.com',
            provider: 'google',
            title: 'New Meeting',
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
          },
        });

        expect(response.statusCode).toBe(201);
        const body = response.json();
        expect(body.event).toBeDefined();
        expect(body.event.title).toBe('New Meeting');
      });
    });

    describe('POST /api/calendar/events/from-work-item', () => {
      it('creates a calendar event from a work item deadline', async () => {
        await pool.query(
          `INSERT INTO oauth_connection (user_email, provider, access_token, refresh_token, scopes, expires_at)
           VALUES ('user@example.com', 'google', 'test-token', 'refresh', ARRAY['calendar'], now() + interval '1 hour')`,
        );

        const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const workItemRes = await pool.query(
          `INSERT INTO work_item (title, status, work_item_kind, not_after)
           VALUES ('Important Task', 'open', 'issue', $1)
           RETURNING id`,
          [deadline.toISOString()],
        );
        const workItemId = workItemRes.rows[0].id;

        const response = await app.inject({
          method: 'POST',
          url: '/api/calendar/events/from-work-item',
          payload: {
            userEmail: 'user@example.com',
            provider: 'google',
            workItemId: workItemId,
          },
        });

        expect(response.statusCode).toBe(201);
        const body = response.json();
        expect(body.event).toBeDefined();
        expect(body.event.workItemId).toBe(workItemId);
      });

      it('returns 404 for non-existent work item', async () => {
        await pool.query(
          `INSERT INTO oauth_connection (user_email, provider, access_token, refresh_token, scopes, expires_at)
           VALUES ('user@example.com', 'google', 'test-token', 'refresh', ARRAY['calendar'], now() + interval '1 hour')`,
        );

        const response = await app.inject({
          method: 'POST',
          url: '/api/calendar/events/from-work-item',
          payload: {
            userEmail: 'user@example.com',
            provider: 'google',
            workItemId: '00000000-0000-0000-0000-000000000000',
          },
        });

        expect(response.statusCode).toBe(404);
      });

      it('returns 400 for work item without deadline', async () => {
        await pool.query(
          `INSERT INTO oauth_connection (user_email, provider, access_token, refresh_token, scopes, expires_at)
           VALUES ('user@example.com', 'google', 'test-token', 'refresh', ARRAY['calendar'], now() + interval '1 hour')`,
        );

        const workItemRes = await pool.query(
          `INSERT INTO work_item (title, status, work_item_kind)
           VALUES ('Task without deadline', 'open', 'issue')
           RETURNING id`,
        );
        const workItemId = workItemRes.rows[0].id;

        const response = await app.inject({
          method: 'POST',
          url: '/api/calendar/events/from-work-item',
          payload: {
            userEmail: 'user@example.com',
            provider: 'google',
            workItemId: workItemId,
          },
        });

        expect(response.statusCode).toBe(400);
      });
    });

    describe('DELETE /api/calendar/events/:id', () => {
      it('deletes a calendar event', async () => {
        const insertRes = await pool.query(
          `INSERT INTO calendar_event (user_email, provider, external_event_id, title, start_time, end_time)
           VALUES ('user@example.com', 'google', 'evt-del', 'Delete Me', now(), now() + interval '1 hour')
           RETURNING id`,
        );
        const eventId = insertRes.rows[0].id;

        const response = await app.inject({
          method: 'DELETE',
          url: `/api/calendar/events/${eventId}`,
        });

        expect(response.statusCode).toBe(204);
      });
    });
  });

  describe('Work Item Calendar View', () => {
    describe('GET /api/work-items/calendar', () => {
      it('returns work items with deadlines as calendar entries', async () => {
        const deadline = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        await pool.query(
          `INSERT INTO work_item (title, status, work_item_kind, not_after)
           VALUES ('Task with deadline', 'open', 'issue', $1)`,
          [deadline.toISOString()],
        );

        const response = await app.inject({
          method: 'GET',
          url: '/api/work-items/calendar',
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.entries).toBeDefined();
        expect(body.entries.length).toBeGreaterThan(0);
      });

      it('filters by date range', async () => {
        const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await pool.query(
          `INSERT INTO work_item (title, status, work_item_kind, not_after)
           VALUES ('Next week task', 'open', 'issue', $1)`,
          [nextWeek.toISOString()],
        );

        const startDate = new Date();
        const endDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

        const response = await app.inject({
          method: 'GET',
          url: `/api/work-items/calendar?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`,
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.entries).toBeDefined();
      });
    });
  });
});
