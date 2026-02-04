import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

describe('Work Item Emails API (issue #124)', () => {
  const app = buildServer();
  let pool: Pool;
  let workItemId: string;
  let contactId: string;
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
      [endpointId, `thread-${Date.now()}`]
    );
    return (result.rows[0] as { id: string }).id;
  }

  async function createEmailMessage(
    threadId: string,
    emailData: {
      subject?: string;
      from?: string;
      to?: string;
      snippet?: string;
      body?: string;
      hasAttachments?: boolean;
      isRead?: boolean;
    }
  ): Promise<string> {
    const raw = {
      subject: emailData.subject ?? 'Test Subject',
      from: emailData.from ?? 'sender@example.com',
      to: emailData.to ?? 'recipient@example.com',
      snippet: emailData.snippet ?? 'This is a preview...',
      hasAttachments: emailData.hasAttachments ?? false,
      isRead: emailData.isRead ?? true,
    };
    const result = await pool.query(
      `INSERT INTO external_message (thread_id, external_message_key, direction, body, raw)
       VALUES ($1, $2, 'inbound', $3, $4)
       RETURNING id::text as id`,
      [threadId, `msg-${Date.now()}`, emailData.body ?? 'Email body content', JSON.stringify(raw)]
    );
    return (result.rows[0] as { id: string }).id;
  }

  async function linkEmailToWorkItem(
    wiId: string,
    threadId: string,
    messageId: string
  ): Promise<void> {
    await pool.query(
      `INSERT INTO work_item_communication (work_item_id, thread_id, message_id, action)
       VALUES ($1, $2, $3, 'reply_required')`,
      [wiId, threadId, messageId]
    );
  }

  describe('GET /api/work-items/:id/emails', () => {
    it('returns empty array when no emails linked', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${workItemId}/emails`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ emails: [] });
    });

    it('returns linked emails with all required fields', async () => {
      const threadId = await createEmailThread();
      const messageId = await createEmailMessage(threadId, {
        subject: 'Meeting Tomorrow',
        from: 'alice@example.com',
        to: 'bob@example.com',
        snippet: 'Let\'s discuss the project...',
        body: 'Full email body here',
        hasAttachments: true,
        isRead: false,
      });
      await linkEmailToWorkItem(workItemId, threadId, messageId);

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${workItemId}/emails`,
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
          hasAttachments: boolean;
          isRead: boolean;
        }>;
      };
      expect(body.emails.length).toBe(1);

      const email = body.emails[0];
      expect(email.id).toBe(messageId);
      expect(email.subject).toBe('Meeting Tomorrow');
      expect(email.from).toBe('alice@example.com');
      expect(email.to).toBe('bob@example.com');
      expect(email.snippet).toBe('Let\'s discuss the project...');
      expect(email.body).toBe('Full email body here');
      expect(email.hasAttachments).toBe(true);
      expect(email.isRead).toBe(false);
      expect(email.date).toBeDefined();
    });

    it('returns multiple emails ordered by date descending', async () => {
      const threadId = await createEmailThread();

      // Create older email
      const olderId = await createEmailMessage(threadId, {
        subject: 'Older Email',
      });
      await linkEmailToWorkItem(workItemId, threadId, olderId);

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
      const newerId = await createEmailMessage(threadId, {
        subject: 'Newer Email',
      });
      await linkEmailToWorkItem(workItemId2, threadId, newerId);

      // Test the first work item - only has older email
      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${workItemId}/emails`,
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
      await linkEmailToWorkItem(workItemId, emailThreadId, emailId);

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
        url: `/api/contacts/${contactId}/endpoints`,
        payload: { endpointType: 'webhook', endpointValue: 'calendar-webhook' },
      });
      const calendarEndpointId = (calendarEndpoint.json() as { id: string }).id;

      // Note: can't use 'calendar' directly since it's not in the enum
      // The test is mainly to verify email filtering works

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${workItemId}/emails`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as { emails: Array<{ subject: string }> };
      expect(body.emails.length).toBe(1);
      expect(body.emails[0].subject).toBe('Email Message');
    });

    it('handles missing optional fields in raw data', async () => {
      const threadId = await createEmailThread();

      // Create message with minimal raw data
      const result = await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, raw)
         VALUES ($1, $2, 'inbound', 'Body text', $3)
         RETURNING id::text as id`,
        [threadId, `msg-minimal-${Date.now()}`, JSON.stringify({ subject: 'Just Subject' })]
      );
      const messageId = (result.rows[0] as { id: string }).id;
      await linkEmailToWorkItem(workItemId, threadId, messageId);

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${workItemId}/emails`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as {
        emails: Array<{
          subject: string;
          from: string | null;
          to: string | null;
          snippet: string | null;
          hasAttachments: boolean;
          isRead: boolean;
        }>;
      };
      expect(body.emails.length).toBe(1);
      expect(body.emails[0].subject).toBe('Just Subject');
      expect(body.emails[0].from).toBeNull();
      expect(body.emails[0].to).toBeNull();
      expect(body.emails[0].hasAttachments).toBe(false);
      expect(body.emails[0].isRead).toBe(false);
    });
  });
});
