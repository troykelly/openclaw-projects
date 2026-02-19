import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

describe('Email and Calendar Linking API (issue #126)', () => {
  const app = buildServer();
  let pool: Pool;
  let work_item_id: string;
  let contact_id: string;
  let endpointId: string;
  let thread_id: string;
  let emailMessageId: string;
  let calendarEventId: string;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
    await app.ready();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);

    // Create a work item
    const wi = await app.inject({
      method: 'POST',
      url: '/api/work-items',
      payload: { title: 'Test Project', kind: 'project' },
    });
    work_item_id = (wi.json() as { id: string }).id;

    // Create a contact with an email endpoint
    const contact = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { display_name: 'John Doe' },
    });
    contact_id = (contact.json() as { id: string }).id;

    const endpoint = await app.inject({
      method: 'POST',
      url: `/api/contacts/${contact_id}/endpoints`,
      payload: { endpoint_type: 'email', endpoint_value: 'john@example.com' },
    });
    endpointId = (endpoint.json() as { id: string }).id;

    // Create a thread
    const threadResult = await pool.query(
      `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
       VALUES ($1, 'email', $2)
       RETURNING id::text as id`,
      [endpointId, `thread-${Date.now()}`],
    );
    thread_id = (threadResult.rows[0] as { id: string }).id;

    // Create an email message
    const emailResult = await pool.query(
      `INSERT INTO external_message (thread_id, external_message_key, direction, body, raw)
       VALUES ($1, $2, 'inbound', 'Email body', $3)
       RETURNING id::text as id`,
      [thread_id, `email-${Date.now()}`, JSON.stringify({ subject: 'Test Email', from: 'sender@example.com' })],
    );
    emailMessageId = (emailResult.rows[0] as { id: string }).id;

    // Create a calendar event message
    const calendarResult = await pool.query(
      `INSERT INTO external_message (thread_id, external_message_key, direction, body, raw)
       VALUES ($1, $2, 'inbound', 'Event description', $3)
       RETURNING id::text as id`,
      [
        thread_id,
        `event-${Date.now()}`,
        JSON.stringify({
          type: 'calendar_event',
          title: 'Meeting',
          start_time: new Date().toISOString(),
        }),
      ],
    );
    calendarEventId = (calendarResult.rows[0] as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('POST /api/work-items/:id/emails', () => {
    it('links an email to a work item', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${work_item_id}/emails`,
        payload: { email_id: emailMessageId },
      });
      expect(res.statusCode).toBe(201);

      const body = res.json() as {
        work_item_id: string;
        email_id: string;
      };
      expect(body.work_item_id).toBe(work_item_id);
      expect(body.email_id).toBe(emailMessageId);
    });

    it('returns 400 when email_id is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${work_item_id}/emails`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'email_id is required' });
    });

    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/emails',
        payload: { email_id: emailMessageId },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    });

    it('returns 400 for non-existent email', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${work_item_id}/emails`,
        payload: { email_id: '00000000-0000-0000-0000-000000000000' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'email not found' });
    });
  });

  describe('DELETE /api/work-items/:id/emails/:emailId', () => {
    beforeEach(async () => {
      // Link the email first
      await app.inject({
        method: 'POST',
        url: `/api/work-items/${work_item_id}/emails`,
        payload: { email_id: emailMessageId },
      });
    });

    it('unlinks an email from a work item', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${work_item_id}/emails/${emailMessageId}`,
      });
      expect(res.statusCode).toBe(204);

      // Verify the link is removed
      const check = await pool.query('SELECT 1 FROM work_item_communication WHERE work_item_id = $1 AND message_id = $2', [work_item_id, emailMessageId]);
      expect(check.rows.length).toBe(0);
    });

    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/00000000-0000-0000-0000-000000000000/emails/${emailMessageId}`,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    });

    it('returns 404 when email is not linked', async () => {
      // Create a new work item without any email links
      const wi2 = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Project 2', kind: 'project' },
      });
      const workItemId2 = (wi2.json() as { id: string }).id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${workItemId2}/emails/${emailMessageId}`,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    });
  });

  describe('POST /api/work-items/:id/calendar', () => {
    it('links a calendar event to a work item', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${work_item_id}/calendar`,
        payload: { event_id: calendarEventId },
      });
      expect(res.statusCode).toBe(201);

      const body = res.json() as {
        work_item_id: string;
        event_id: string;
      };
      expect(body.work_item_id).toBe(work_item_id);
      expect(body.event_id).toBe(calendarEventId);
    });

    it('returns 400 when event_id is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${work_item_id}/calendar`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'event_id is required' });
    });

    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/calendar',
        payload: { event_id: calendarEventId },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    });

    it('returns 400 for non-existent event', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${work_item_id}/calendar`,
        payload: { event_id: '00000000-0000-0000-0000-000000000000' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'event not found' });
    });
  });

  describe('DELETE /api/work-items/:id/calendar/:eventId', () => {
    beforeEach(async () => {
      // Link the calendar event first
      await app.inject({
        method: 'POST',
        url: `/api/work-items/${work_item_id}/calendar`,
        payload: { event_id: calendarEventId },
      });
    });

    it('unlinks a calendar event from a work item', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${work_item_id}/calendar/${calendarEventId}`,
      });
      expect(res.statusCode).toBe(204);

      // Verify the link is removed
      const check = await pool.query('SELECT 1 FROM work_item_communication WHERE work_item_id = $1 AND message_id = $2', [work_item_id, calendarEventId]);
      expect(check.rows.length).toBe(0);
    });

    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/00000000-0000-0000-0000-000000000000/calendar/${calendarEventId}`,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    });

    it('returns 404 when event is not linked', async () => {
      // Create a new work item without any event links
      const wi2 = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Project 2', kind: 'project' },
      });
      const workItemId2 = (wi2.json() as { id: string }).id;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${workItemId2}/calendar/${calendarEventId}`,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    });
  });
});
