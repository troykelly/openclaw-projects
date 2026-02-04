import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';
import { buildServer } from '../src/api/server.ts';

describe('Work Item Calendar API (issue #125)', () => {
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

    // Create a contact with a webhook endpoint (used for calendar sync)
    const contact = await app.inject({
      method: 'POST',
      url: '/api/contacts',
      payload: { displayName: 'John Doe' },
    });
    contactId = (contact.json() as { id: string }).id;

    // Use webhook endpoint type for calendar (since 'calendar' is not in the enum)
    const endpoint = await app.inject({
      method: 'POST',
      url: `/api/contacts/${contactId}/endpoints`,
      payload: { endpointType: 'webhook', endpointValue: 'calendar-sync' },
    });
    endpointId = (endpoint.json() as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function createCalendarThread(): Promise<string> {
    // Use 'webhook' channel to represent calendar for now
    // The endpoint will filter based on raw data containing calendar event structure
    const result = await pool.query(
      `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
       VALUES ($1, 'webhook', $2)
       RETURNING id::text as id`,
      [endpointId, `calendar-${Date.now()}`]
    );
    return (result.rows[0] as { id: string }).id;
  }

  async function createCalendarEvent(
    threadId: string,
    eventData: {
      title?: string;
      description?: string;
      startTime?: string;
      endTime?: string;
      isAllDay?: boolean;
      location?: string;
      attendees?: Array<{ email: string; name?: string; status?: string }>;
      organizer?: { email: string; name?: string };
      meetingLink?: string;
    }
  ): Promise<string> {
    const raw = {
      type: 'calendar_event',
      title: eventData.title ?? 'Test Meeting',
      description: eventData.description ?? 'Meeting description',
      startTime: eventData.startTime ?? new Date().toISOString(),
      endTime: eventData.endTime ?? new Date(Date.now() + 3600000).toISOString(),
      isAllDay: eventData.isAllDay ?? false,
      location: eventData.location ?? null,
      attendees: eventData.attendees ?? [],
      organizer: eventData.organizer ?? { email: 'organizer@example.com' },
      meetingLink: eventData.meetingLink ?? null,
    };
    const result = await pool.query(
      `INSERT INTO external_message (thread_id, external_message_key, direction, body, raw)
       VALUES ($1, $2, 'inbound', $3, $4)
       RETURNING id::text as id`,
      [threadId, `event-${Date.now()}`, eventData.description ?? 'Event', JSON.stringify(raw)]
    );
    return (result.rows[0] as { id: string }).id;
  }

  async function linkCalendarToWorkItem(
    wiId: string,
    threadId: string,
    messageId: string
  ): Promise<void> {
    await pool.query(
      `INSERT INTO work_item_communication (work_item_id, thread_id, message_id, action)
       VALUES ($1, $2, $3, 'follow_up')`,
      [wiId, threadId, messageId]
    );
  }

  describe('GET /api/work-items/:id/calendar', () => {
    it('returns empty array when no calendar events linked', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${workItemId}/calendar`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ events: [] });
    });

    it('returns linked calendar events with all required fields', async () => {
      const threadId = await createCalendarThread();
      const startTime = new Date().toISOString();
      const endTime = new Date(Date.now() + 3600000).toISOString();

      const eventId = await createCalendarEvent(threadId, {
        title: 'Project Kickoff',
        description: 'Initial project meeting',
        startTime,
        endTime,
        isAllDay: false,
        location: 'Conference Room A',
        attendees: [
          { email: 'alice@example.com', name: 'Alice', status: 'accepted' },
          { email: 'bob@example.com', name: 'Bob', status: 'tentative' },
        ],
        organizer: { email: 'manager@example.com', name: 'Manager' },
        meetingLink: 'https://meet.example.com/abc123',
      });
      await linkCalendarToWorkItem(workItemId, threadId, eventId);

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${workItemId}/calendar`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as {
        events: Array<{
          id: string;
          title: string;
          description: string;
          startTime: string;
          endTime: string;
          isAllDay: boolean;
          location: string | null;
          attendees: Array<{ email: string; name?: string; status?: string }>;
          organizer: { email: string; name?: string } | null;
          meetingLink: string | null;
        }>;
      };
      expect(body.events.length).toBe(1);

      const event = body.events[0];
      expect(event.id).toBe(eventId);
      expect(event.title).toBe('Project Kickoff');
      expect(event.description).toBe('Initial project meeting');
      expect(event.startTime).toBe(startTime);
      expect(event.endTime).toBe(endTime);
      expect(event.isAllDay).toBe(false);
      expect(event.location).toBe('Conference Room A');
      expect(event.attendees).toHaveLength(2);
      expect(event.organizer?.email).toBe('manager@example.com');
      expect(event.meetingLink).toBe('https://meet.example.com/abc123');
    });

    it('returns 404 for non-existent work item', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/work-items/00000000-0000-0000-0000-000000000000/calendar',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not found' });
    });

    it('handles all-day events', async () => {
      const threadId = await createCalendarThread();
      const eventId = await createCalendarEvent(threadId, {
        title: 'Company Holiday',
        isAllDay: true,
        startTime: '2024-12-25T00:00:00.000Z',
        endTime: '2024-12-25T23:59:59.999Z',
      });
      await linkCalendarToWorkItem(workItemId, threadId, eventId);

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${workItemId}/calendar`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as { events: Array<{ isAllDay: boolean }> };
      expect(body.events[0].isAllDay).toBe(true);
    });

    it('handles missing optional fields', async () => {
      const threadId = await createCalendarThread();

      // Create event with minimal data
      const result = await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, raw)
         VALUES ($1, $2, 'inbound', 'Minimal event', $3)
         RETURNING id::text as id`,
        [
          threadId,
          `minimal-event-${Date.now()}`,
          JSON.stringify({
            type: 'calendar_event',
            title: 'Quick Meeting',
            startTime: new Date().toISOString(),
          }),
        ]
      );
      const eventId = (result.rows[0] as { id: string }).id;
      await linkCalendarToWorkItem(workItemId, threadId, eventId);

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${workItemId}/calendar`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as {
        events: Array<{
          title: string;
          description: string | null;
          location: string | null;
          attendees: unknown[];
          organizer: unknown;
          meetingLink: string | null;
        }>;
      };
      expect(body.events.length).toBe(1);
      expect(body.events[0].title).toBe('Quick Meeting');
      expect(body.events[0].location).toBeNull();
      expect(body.events[0].meetingLink).toBeNull();
      expect(body.events[0].attendees).toEqual([]);
    });

    it('only returns calendar events (type: calendar_event)', async () => {
      const threadId = await createCalendarThread();

      // Create a calendar event
      const calendarEventId = await createCalendarEvent(threadId, {
        title: 'Real Calendar Event',
      });
      await linkCalendarToWorkItem(workItemId, threadId, calendarEventId);

      // Create a regular message on the same thread (no calendar type)
      const wi2 = await app.inject({
        method: 'POST',
        url: '/api/work-items',
        payload: { title: 'Test Project 2', kind: 'project' },
      });
      const workItemId2 = (wi2.json() as { id: string }).id;

      const regularResult = await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, raw)
         VALUES ($1, $2, 'inbound', 'Regular message', $3)
         RETURNING id::text as id`,
        [threadId, `regular-${Date.now()}`, JSON.stringify({ type: 'message' })]
      );
      const regularMsgId = (regularResult.rows[0] as { id: string }).id;
      await linkCalendarToWorkItem(workItemId2, threadId, regularMsgId);

      const res = await app.inject({
        method: 'GET',
        url: `/api/work-items/${workItemId}/calendar`,
      });
      expect(res.statusCode).toBe(200);

      const body = res.json() as { events: Array<{ title: string }> };
      expect(body.events.length).toBe(1);
      expect(body.events[0].title).toBe('Real Calendar Event');
    });
  });
});
