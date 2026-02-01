import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.js';
import { createTestPool, truncateAllTables } from './helpers/db.js';
import { buildServer } from '../src/api/server.js';

describe('Email and Calendar Linking API (issue #126)', () => {
  const app = buildServer();
  let pool: Pool;
  let workItemId: string;
  let contactId: string;
  let endpointId: string;
  let threadId: string;
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
    workItemId = (wi.json() as { id: string }).id;

    // Create a contact with an email endpoint
    const contact = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { displayName: 'John Doe' },
    });
    contactId = (contact.json() as { id: string }).id;

    const endpoint = await app.inject({
      method: 'POST',
      url: `/api/contacts/${contactId}/endpoints`,
      payload: { endpointType: 'email', endpointValue: 'john@example.com' },
    });
    endpointId = (endpoint.json() as { id: string }).id;

    // Create a thread
    const threadResult = await pool.query(
      `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
       VALUES ($1, 'email', $2)
       RETURNING id::text as id`,
      [endpointId, `thread-${Date.now()}`]
    );
    threadId = (threadResult.rows[0] as { id: string }).id;

    // Create an email message
    const emailResult = await pool.query(
      `INSERT INTO external_message (thread_id, external_message_key, direction, body, raw)
       VALUES ($1, $2, 'inbound', 'Email body', $3)
       RETURNING id::text as id`,
      [threadId, `email-${Date.now()}`, JSON.stringify({ subject: 'Test Email', from: 'sender@example.com' })]
    );
    emailMessageId = (emailResult.rows[0] as { id: string }).id;

    // Create a calendar event message
    const calendarResult = await pool.query(
      `INSERT INTO external_message (thread_id, external_message_key, direction, body, raw)
       VALUES ($1, $2, 'inbound', 'Event description', $3)
       RETURNING id::text as id`,
      [
        threadId,
        `event-${Date.now()}`,
        JSON.stringify({
          type: 'calendar_event',
          title: 'Meeting',
          startTime: new Date().toISOString(),
        }),
      ]
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
        url: `/api/work-items/${workItemId}/emails`,
        payload: { emailId: emailMessageId },
      });
      expect(res.statusCode).toBe(201);

      const body = res.json() as {
        workItemId: string;
        emailId: string;
      };
      expect(body.workItemId).toBe(workItemId);
      expect(body.emailId).toBe(emailMessageId);
    });

    it('returns 400 when emailId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/emails`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'emailId is required' });
    });

    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/emails',
        payload: { emailId: emailMessageId },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'work item not found' });
    });

    it('returns 400 for non-existent email', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/emails`,
        payload: { emailId: '00000000-0000-0000-0000-000000000000' },
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
        url: `/api/work-items/${workItemId}/emails`,
        payload: { emailId: emailMessageId },
      });
    });

    it('unlinks an email from a work item', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${workItemId}/emails/${emailMessageId}`,
      });
      expect(res.statusCode).toBe(204);

      // Verify the link is removed
      const check = await pool.query(
        'SELECT 1 FROM work_item_communication WHERE work_item_id = $1 AND message_id = $2',
        [workItemId, emailMessageId]
      );
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
        url: `/api/work-items/${workItemId}/calendar`,
        payload: { eventId: calendarEventId },
      });
      expect(res.statusCode).toBe(201);

      const body = res.json() as {
        workItemId: string;
        eventId: string;
      };
      expect(body.workItemId).toBe(workItemId);
      expect(body.eventId).toBe(calendarEventId);
    });

    it('returns 400 when eventId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/calendar`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'eventId is required' });
    });

    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/calendar',
        payload: { eventId: calendarEventId },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'work item not found' });
    });

    it('returns 400 for non-existent event', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/work-items/${workItemId}/calendar`,
        payload: { eventId: '00000000-0000-0000-0000-000000000000' },
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
        url: `/api/work-items/${workItemId}/calendar`,
        payload: { eventId: calendarEventId },
      });
    });

    it('unlinks a calendar event from a work item', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/work-items/${workItemId}/calendar/${calendarEventId}`,
      });
      expect(res.statusCode).toBe(204);

      // Verify the link is removed
      const check = await pool.query(
        'SELECT 1 FROM work_item_communication WHERE work_item_id = $1 AND message_id = $2',
        [workItemId, calendarEventId]
      );
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
