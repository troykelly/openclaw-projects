/**
 * Tests for communication mapping layer (#1731).
 *
 * Verifies conversion from ApiCommunication to LinkedEmail and
 * LinkedCalendarEvent shapes.
 */
import { describe, it, expect } from 'vitest';
import { mapApiEmailToLinkedEmail, mapApiEventToLinkedCalendarEvent } from '@/ui/lib/communication-mappers';
import type { ApiCommunication } from '@/ui/lib/api-types';

describe('mapApiEmailToLinkedEmail', () => {
  it('maps a fully populated email', () => {
    const api: ApiCommunication = {
      id: 'email-1',
      thread_id: 'thread-1',
      body: 'Hello, this is the email body.',
      direction: 'inbound',
      received_at: '2026-02-20T10:00:00Z',
      raw: {
        subject: 'Test Subject',
        from: 'Alice <alice@example.com>',
        to: ['Bob <bob@example.com>', 'carol@example.com'],
        snippet: 'Hello, this is a snippet.',
        has_attachments: true,
        is_read: false,
      },
    };

    const result = mapApiEmailToLinkedEmail(api);

    expect(result.id).toBe('email-1');
    expect(result.subject).toBe('Test Subject');
    expect(result.from.name).toBe('Alice');
    expect(result.from.email).toBe('alice@example.com');
    expect(result.to).toHaveLength(2);
    expect(result.to[0].name).toBe('Bob');
    expect(result.to[0].email).toBe('bob@example.com');
    expect(result.to[1].email).toBe('carol@example.com');
    expect(result.snippet).toBe('Hello, this is a snippet.');
    expect(result.hasAttachments).toBe(true);
    expect(result.is_read).toBe(false);
    expect(result.date).toBeInstanceOf(Date);
  });

  it('handles minimal email with no raw data', () => {
    const api: ApiCommunication = {
      id: 'email-2',
      thread_id: 'thread-2',
      body: 'Simple body text',
      direction: 'outbound',
      received_at: '2026-02-20T12:00:00Z',
      raw: null,
    };

    const result = mapApiEmailToLinkedEmail(api);

    expect(result.id).toBe('email-2');
    expect(result.subject).toBe('Simple body text');
    expect(result.from.name).toBe('');
    expect(result.to).toHaveLength(0);
    expect(result.snippet).toBe('Simple body text');
    expect(result.is_read).toBe(true); // outbound defaults to read
  });

  it('handles null body', () => {
    const api: ApiCommunication = {
      id: 'email-3',
      thread_id: 'thread-3',
      body: null,
      direction: 'inbound',
      received_at: '2026-02-20T14:00:00Z',
      raw: {},
    };

    const result = mapApiEmailToLinkedEmail(api);
    expect(result.subject).toBe('(no subject)');
    expect(result.snippet).toBe('');
  });
});

describe('mapApiEventToLinkedCalendarEvent', () => {
  it('maps a fully populated calendar event', () => {
    const api: ApiCommunication = {
      id: 'event-1',
      thread_id: 'thread-1',
      body: null,
      direction: 'inbound',
      received_at: '2026-02-20T10:00:00Z',
      raw: {
        title: 'Team Standup',
        description: 'Daily standup meeting',
        start_time: '2026-02-20T09:00:00Z',
        end_time: '2026-02-20T09:30:00Z',
        location: 'Conference Room A',
        is_all_day: false,
        meeting_link: 'https://meet.example.com/standup',
        attendees: [
          { name: 'Alice', email: 'alice@example.com', status: 'accepted' },
          { name: 'Bob', email: 'bob@example.com', status: 'tentative' },
        ],
        organizer: { name: 'Alice', email: 'alice@example.com' },
      },
    };

    const result = mapApiEventToLinkedCalendarEvent(api);

    expect(result.id).toBe('event-1');
    expect(result.title).toBe('Team Standup');
    expect(result.description).toBe('Daily standup meeting');
    expect(result.startTime).toBeInstanceOf(Date);
    expect(result.endTime).toBeInstanceOf(Date);
    expect(result.location).toBe('Conference Room A');
    expect(result.isAllDay).toBe(false);
    expect(result.meetingLink).toBe('https://meet.example.com/standup');
    expect(result.attendees).toHaveLength(2);
    expect(result.attendees[0].name).toBe('Alice');
    expect(result.attendees[0].status).toBe('accepted');
    expect(result.organizer?.name).toBe('Alice');
  });

  it('handles minimal event with no raw data', () => {
    const api: ApiCommunication = {
      id: 'event-2',
      thread_id: 'thread-2',
      body: 'Quick meeting',
      direction: 'inbound',
      received_at: '2026-02-20T15:00:00Z',
      raw: null,
    };

    const result = mapApiEventToLinkedCalendarEvent(api);

    expect(result.id).toBe('event-2');
    expect(result.title).toBe('Quick meeting');
    expect(result.attendees).toHaveLength(0);
    expect(result.organizer).toBeUndefined();
    expect(result.startTime).toBeInstanceOf(Date);
  });

  it('handles event with alternate field names', () => {
    const api: ApiCommunication = {
      id: 'event-3',
      thread_id: 'thread-3',
      body: null,
      direction: 'inbound',
      received_at: null,
      raw: {
        subject: 'All-Day Event',
        start: '2026-02-21T00:00:00Z',
        end: '2026-02-22T00:00:00Z',
        is_all_day: true,
      },
    };

    const result = mapApiEventToLinkedCalendarEvent(api);

    expect(result.title).toBe('All-Day Event');
    expect(result.isAllDay).toBe(true);
  });
});
