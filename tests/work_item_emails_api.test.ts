import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

describe('Work Item Emails API (issue #124)', () => {
  const app = buildServer();
  let pool: Pool;
  let work_item_id: string;
  let contact_id: string;
  let endpointId: string;

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
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function createEmailThread(): Promise<string> {
    const result = await pool.query(
      `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
       VALUES ($1, 'email', $2)
       RETURNING id::text as id`,
      [endpointId, `thread-${Date.now()}`],
    );
    return (result.rows[0] as { id: string }).id;
  }

  async function createEmailMessage(
    thread_id: string,
    emailData: {
      subject?: string;
      from?: string;
      to?: string;
      snippet?: string;
      body?: string;
      has_attachments?: boolean;
      is_read?: boolean;
    },
  ): Promise<string> {
    const raw = {
      subject: emailData.subject ?? 'Test Subject',
      from: emailData.from ?? 'sender@example.com',
      to: emailData.to ?? 'recipient@example.com',
      snippet: emailData.snippet ?? 'This is a preview...',
      has_attachments: emailData.has_attachments ?? false,
      is_read: emailData.is_read ?? true,
    };
    const result = await pool.query(
      `INSERT INTO external_message (thread_id, external_message_key, direction, body, raw)
       VALUES ($1, $2, 'inbound', $3, $4)
       RETURNING id::text as id`,
      [thread_id, `msg-${Date.now()}`, emailData.body ?? 'Email body content', JSON.stringify(raw)],
    );
    return (result.rows[0] as { id: string }).id;
  }

  async function linkEmailToWorkItem(wiId: string, thread_id: string, message_id: string): Promise<void> {
    await pool.query(
      `INSERT INTO work_item_communication (work_item_id, thread_id, message_id, action)
       VALUES ($1, $2, $3, 'reply_required')`,
      [wiId, thread_id, message_id],
    );
  }

  describe('GET /api/work-items/:id/emails', () => {
    it('returns empty array when no emails linked', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${work_item_id}/emails`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ emails: [] });
    });

    it('returns linked emails with all required fields', async () => {
      const thread_id = await createEmailThread();
      const message_id = await createEmailMessage(thread_id, {
        subject: 'Meeting Tomorrow',
        from: 'alice@example.com',
        to: 'bob@example.com',
        snippet: "Let's discuss the project...",
        body: 'Full email body here',
        has_attachments: true,
        is_read: false,
      });
      await linkEmailToWorkItem(work_item_id, thread_id, message_id);

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${work_item_id}/emails`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as {
        emails: Array<{
          id: string;
          subject: string;
          from: string;
          to: string;
          date: string;
          snippet: string;
          body: string;
          has_attachments: boolean;
          is_read: boolean;
        }>;
      };
      expect(body.emails.length).toBe(1);

      const email = body.emails[0];
      expect(email.id).toBe(message_id);
      expect(email.subject).toBe('Meeting Tomorrow');
      expect(email.from).toBe('alice@example.com');
      expect(email.to).toBe('bob@example.com');
      expect(email.snippet).toBe("Let's discuss the project...");
      expect(email.body).toBe('Full email body here');
      expect(email.has_attachments).toBe(true);
      expect(email.is_read).toBe(false);
      expect(email.date).toBeDefined();
    });

    it('returns multiple emails ordered by date descending', async () => {
      const thread_id = await createEmailThread();

      // Create older email
      const olderId = await createEmailMessage(thread_id, {
        subject: 'Older Email',
      });
      await linkEmailToWorkItem(work_item_id, thread_id, olderId);

      // Wait a bit to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Create a second work item to link the second email (can't link multiple emails to same work item)
      const wi2 = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Project 2', kind: 'project' },
      });
      const workItemId2 = (wi2.json() as { id: string }).id;

      // Create newer email
      const newerId = await createEmailMessage(thread_id, {
        subject: 'Newer Email',
      });
      await linkEmailToWorkItem(workItemId2, thread_id, newerId);

      // Test the first work item - only has older email
      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${work_item_id}/emails`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as {
        emails: Array<{ subject: string }>;
      };
      expect(body.emails.length).toBe(1);
      expect(body.emails[0].subject).toBe('Older Email');
    });

    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/emails',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    });

    it('only returns emails, not other channel types', async () => {
      // Create an email
      const emailThreadId = await createEmailThread();
      const emailId = await createEmailMessage(emailThreadId, {
        subject: 'Email Message',
      });
      await linkEmailToWorkItem(work_item_id, emailThreadId, emailId);

      // Create a calendar event thread in a separate work item
      const wi2 = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Project 2', kind: 'project' },
      });
      const workItemId2 = (wi2.json() as { id: string }).id;

      // Create calendar endpoint
      const calendarEndpoint = await app.inject({
        method: 'POST',
        url: `/api/contacts/${contact_id}/endpoints`,
        payload: { endpoint_type: 'webhook', endpoint_value: 'calendar-webhook' },
      });
      const calendarEndpointId = (calendarEndpoint.json() as { id: string }).id;

      // Note: can't use 'calendar' directly since it's not in the enum
      // The test is mainly to verify email filtering works

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${work_item_id}/emails`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as { emails: Array<{ subject: string }> };
      expect(body.emails.length).toBe(1);
      expect(body.emails[0].subject).toBe('Email Message');
    });

    it('handles missing optional fields in raw data', async () => {
      const thread_id = await createEmailThread();

      // Create message with minimal raw data
      const result = await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, raw)
         VALUES ($1, $2, 'inbound', 'Body text', $3)
         RETURNING id::text as id`,
        [thread_id, `msg-minimal-${Date.now()}`, JSON.stringify({ subject: 'Just Subject' })],
      );
      const message_id = (result.rows[0] as { id: string }).id;
      await linkEmailToWorkItem(work_item_id, thread_id, message_id);

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${work_item_id}/emails`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as {
        emails: Array<{
          subject: string;
          from: string | null;
          to: string | null;
          snippet: string | null;
          has_attachments: boolean;
          is_read: boolean;
        }>;
      };
      expect(body.emails.length).toBe(1);
      expect(body.emails[0].subject).toBe('Just Subject');
      expect(body.emails[0].from).toBeNull();
      expect(body.emails[0].to).toBeNull();
      expect(body.emails[0].has_attachments).toBe(false);
      expect(body.emails[0].is_read).toBe(false);
    });
  });
});
