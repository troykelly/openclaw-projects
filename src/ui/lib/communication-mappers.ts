/**
 * Mapping functions for converting API communication shapes to
 * component-expected shapes.
 *
 * The API returns `ApiCommunication` records (flat, serialisable).
 * The communication components expect `LinkedEmail` and
 * `LinkedCalendarEvent` (rich, with Date objects and nested structure).
 *
 * @see Issue #1731
 */
import type { ApiCommunication } from '@/ui/lib/api-types';
import type { LinkedEmail, LinkedCalendarEvent } from '@/ui/components/communications/types';

/** Extract a display name from an email-style address string. */
function parseEmailAddress(raw: string): { name: string; email: string } {
  // Handle "Name <email>" format
  const match = raw.match(/^(.+?)\s*<(.+?)>$/);
  if (match) {
    return { name: match[1].trim(), email: match[2].trim() };
  }
  // Plain email address — use the local part as the name
  const localPart = raw.split('@')[0] ?? raw;
  return { name: localPart, email: raw };
}

/**
 * Safely extract a field from the raw payload, which may be any shape.
 * Returns undefined when the field does not exist or raw is not an object.
 */
function rawField(raw: unknown, key: string): unknown {
  if (raw !== null && typeof raw === 'object' && key in (raw as Record<string, unknown>)) {
    return (raw as Record<string, unknown>)[key];
  }
  return undefined;
}

/**
 * Map an API email communication to the `LinkedEmail` shape expected
 * by `EmailCard` and `EmailDetailSheet`.
 */
export function mapApiEmailToLinkedEmail(api: ApiCommunication): LinkedEmail {
  const raw = api.raw;

  const subject = (rawField(raw, 'subject') as string) ?? api.body?.split('\n')[0] ?? '(no subject)';
  const fromRaw = (rawField(raw, 'from') as string) ?? '';
  const toRaw = rawField(raw, 'to');
  const snippet = (rawField(raw, 'snippet') as string) ?? api.body ?? '';
  const hasAttachments = (rawField(raw, 'has_attachments') as boolean) ?? false;
  const isRead = (rawField(raw, 'is_read') as boolean) ?? api.direction === 'outbound';

  const toArray: string[] = Array.isArray(toRaw) ? toRaw : typeof toRaw === 'string' ? [toRaw] : [];

  return {
    id: api.id,
    subject,
    from: parseEmailAddress(fromRaw),
    to: toArray.map(parseEmailAddress),
    date: new Date(api.received_at ?? ((rawField(raw, 'date') as string) ?? new Date().toISOString())),
    snippet,
    body: api.body ?? undefined,
    hasAttachments,
    is_read: isRead,
  };
}

/**
 * Map an API calendar event communication to the `LinkedCalendarEvent`
 * shape expected by `CalendarEventCard` and `CalendarEventDetailSheet`.
 */
export function mapApiEventToLinkedCalendarEvent(api: ApiCommunication): LinkedCalendarEvent {
  const raw = api.raw;

  const title = (rawField(raw, 'title') as string) ?? (rawField(raw, 'subject') as string) ?? api.body?.split('\n')[0] ?? '(untitled event)';
  const description = (rawField(raw, 'description') as string) ?? api.body ?? undefined;
  const location = (rawField(raw, 'location') as string) ?? undefined;
  const isAllDay = (rawField(raw, 'is_all_day') as boolean) ?? false;
  const meetingLink = (rawField(raw, 'meeting_link') as string) ?? undefined;

  const startTimeRaw = (rawField(raw, 'start_time') as string) ?? (rawField(raw, 'start') as string) ?? api.received_at ?? new Date().toISOString();
  const endTimeRaw = (rawField(raw, 'end_time') as string) ?? (rawField(raw, 'end') as string) ?? startTimeRaw;

  const attendeesRaw = rawField(raw, 'attendees');
  const attendees = Array.isArray(attendeesRaw)
    ? attendeesRaw.map((a: Record<string, unknown>) => ({
        name: (a.name as string) ?? (a.email as string) ?? '',
        email: (a.email as string) ?? '',
        status: ((a.status as string) ?? 'pending') as 'accepted' | 'declined' | 'tentative' | 'pending',
      }))
    : [];

  const organizerRaw = rawField(raw, 'organizer');
  const organizer =
    organizerRaw && typeof organizerRaw === 'object'
      ? {
          name: ((organizerRaw as Record<string, unknown>).name as string) ?? '',
          email: ((organizerRaw as Record<string, unknown>).email as string) ?? '',
        }
      : undefined;

  return {
    id: api.id,
    title,
    description,
    startTime: new Date(startTimeRaw),
    endTime: new Date(endTimeRaw),
    isAllDay,
    location,
    attendees,
    organizer,
    meetingLink,
  };
}
