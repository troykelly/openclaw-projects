/**
 * Calendar sync service.
 * Provides pull-sync (provider → local DB) and push operations (local → provider)
 * for Google Calendar and Microsoft Graph calendar events.
 *
 * Part of Issue #1362.
 */

import type { Pool } from 'pg';
import type { CalendarEventInput, ProviderCalendarEvent } from './google.ts';
import * as google from './google.ts';
import * as microsoft from './microsoft.ts';
import { getConnection, getValidAccessToken } from './service.ts';
import type { OAuthProvider } from './types.ts';
import { NoConnectionError, OAuthError } from './types.ts';

export type { ProviderCalendarEvent, CalendarEventInput };

/** Result of a calendar sync operation (pull from provider). */
export interface CalendarSyncResult {
  connection_id: string;
  provider: OAuthProvider;
  synced: number;
  created: number;
  updated: number;
}

/**
 * List calendar events directly from the provider (live API access).
 * Does not persist to the local DB — used for real-time queries.
 */
export async function listProviderCalendarEvents(
  pool: Pool,
  connection_id: string,
  options?: { timeMin?: string; timeMax?: string; maxResults?: number; pageToken?: string },
): Promise<{ events: ProviderCalendarEvent[]; nextPageToken?: string; provider: OAuthProvider }> {
  const connection = await getConnection(pool, connection_id);
  if (!connection) {
    throw new NoConnectionError(connection_id);
  }

  if (!connection.enabled_features.includes('calendar')) {
    throw new OAuthError('Calendar feature is not enabled on this connection', 'CALENDAR_NOT_ENABLED', connection.provider, 400);
  }

  if (!connection.is_active) {
    throw new OAuthError('Connection is disabled', 'CONNECTION_DISABLED', connection.provider, 400);
  }

  const access_token = await getValidAccessToken(pool, connection_id);

  switch (connection.provider) {
    case 'google': {
      const result = await google.listCalendarEvents(access_token, options);
      return { events: result.events, nextPageToken: result.nextPageToken, provider: 'google' };
    }
    case 'microsoft': {
      const result = await microsoft.listCalendarEvents(access_token, options);
      return { events: result.events, nextPageToken: result.nextPageToken, provider: 'microsoft' };
    }
    default:
      throw new OAuthError(`Unknown provider: ${connection.provider}`, 'UNKNOWN_PROVIDER', connection.provider);
  }
}

/**
 * Sync calendar events from the provider into the local `calendar_event` table.
 * Uses upsert on (provider, external_event_id) to avoid duplicates.
 */
export async function syncCalendarEvents(
  pool: Pool,
  connection_id: string,
  options?: { timeMin?: string; timeMax?: string; maxResults?: number },
): Promise<CalendarSyncResult> {
  const connection = await getConnection(pool, connection_id);
  if (!connection) {
    throw new NoConnectionError(connection_id);
  }

  if (!connection.enabled_features.includes('calendar')) {
    throw new OAuthError('Calendar feature is not enabled on this connection', 'CALENDAR_NOT_ENABLED', connection.provider, 400);
  }

  if (!connection.is_active) {
    throw new OAuthError('Connection is disabled', 'CONNECTION_DISABLED', connection.provider, 400);
  }

  const access_token = await getValidAccessToken(pool, connection_id);

  // Fetch events from provider (paginated)
  const allEvents: ProviderCalendarEvent[] = [];
  let pageToken: string | undefined;

  do {
    let result: { events: ProviderCalendarEvent[]; nextPageToken?: string };

    switch (connection.provider) {
      case 'google':
        result = await google.listCalendarEvents(access_token, { ...options, pageToken });
        break;
      case 'microsoft':
        result = await microsoft.listCalendarEvents(access_token, { ...options, pageToken });
        break;
      default:
        throw new OAuthError(`Unknown provider: ${connection.provider}`, 'UNKNOWN_PROVIDER', connection.provider);
    }

    allEvents.push(...result.events);
    pageToken = result.nextPageToken;
  } while (pageToken);

  // Upsert events into calendar_event table
  let created = 0;
  let updated = 0;

  for (const event of allEvents) {
    const result = await pool.query(
      `INSERT INTO calendar_event
         (user_email, provider, external_event_id, title, description,
          start_time, end_time, location, attendees, event_metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (provider, external_event_id) DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         location = EXCLUDED.location,
         attendees = EXCLUDED.attendees,
         event_metadata = EXCLUDED.event_metadata,
         updated_at = now()
       RETURNING (xmax = 0) AS is_insert`,
      [
        connection.user_email,
        connection.provider,
        event.id,
        event.title,
        event.description || null,
        event.start_time,
        event.end_time,
        event.location || null,
        JSON.stringify(event.attendees),
        JSON.stringify({
          all_day: event.all_day,
          organizer: event.organizer,
          html_link: event.html_link,
          status: event.status,
        }),
      ],
    );

    if (result.rows[0].is_insert) {
      created++;
    } else {
      updated++;
    }
  }

  // Update sync status on the connection
  await pool.query(
    `UPDATE oauth_connection
     SET sync_status = jsonb_set(
       COALESCE(sync_status, '{}'::jsonb),
       '{calendar}',
       $2::jsonb
     ),
     last_sync_at = now(),
     updated_at = now()
     WHERE id = $1`,
    [
      connection_id,
      JSON.stringify({
        last_sync: new Date().toISOString(),
        events_synced: allEvents.length,
        created,
        updated,
      }),
    ],
  );

  return {
    connection_id,
    provider: connection.provider,
    synced: allEvents.length,
    created,
    updated,
  };
}

/**
 * Create a calendar event on the provider and store it locally.
 * Returns both the provider event and the local DB ID.
 */
export async function createProviderCalendarEvent(
  pool: Pool,
  connection_id: string,
  event: CalendarEventInput,
): Promise<{ providerEvent: ProviderCalendarEvent; localId: string }> {
  const connection = await getConnection(pool, connection_id);
  if (!connection) {
    throw new NoConnectionError(connection_id);
  }

  if (!connection.enabled_features.includes('calendar')) {
    throw new OAuthError('Calendar feature is not enabled on this connection', 'CALENDAR_NOT_ENABLED', connection.provider, 400);
  }

  if (connection.permission_level !== 'read_write') {
    throw new OAuthError('Write permission required to create events', 'INSUFFICIENT_PERMISSIONS', connection.provider, 403);
  }

  const access_token = await getValidAccessToken(pool, connection_id);

  let providerEvent: ProviderCalendarEvent;
  switch (connection.provider) {
    case 'google':
      providerEvent = await google.createCalendarEvent(access_token, event);
      break;
    case 'microsoft':
      providerEvent = await microsoft.createCalendarEvent(access_token, event);
      break;
    default:
      throw new OAuthError(`Unknown provider: ${connection.provider}`, 'UNKNOWN_PROVIDER', connection.provider);
  }

  // Store in local DB
  const result = await pool.query(
    `INSERT INTO calendar_event
       (user_email, provider, external_event_id, title, description,
        start_time, end_time, location, attendees, event_metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (provider, external_event_id) DO UPDATE SET
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       start_time = EXCLUDED.start_time,
       end_time = EXCLUDED.end_time,
       location = EXCLUDED.location,
       attendees = EXCLUDED.attendees,
       event_metadata = EXCLUDED.event_metadata,
       updated_at = now()
     RETURNING id::text as id`,
    [
      connection.user_email,
      connection.provider,
      providerEvent.id,
      providerEvent.title,
      providerEvent.description || null,
      providerEvent.start_time,
      providerEvent.end_time,
      providerEvent.location || null,
      JSON.stringify(providerEvent.attendees),
      JSON.stringify({
        all_day: providerEvent.all_day,
        organizer: providerEvent.organizer,
        html_link: providerEvent.html_link,
        status: providerEvent.status,
      }),
    ],
  );

  return {
    providerEvent,
    localId: result.rows[0].id,
  };
}

/**
 * Delete a calendar event from the provider and from the local DB.
 * If the event has a local-only external_event_id, only deletes locally.
 */
export async function deleteProviderCalendarEvent(pool: Pool, connection_id: string | null, localEventId: string): Promise<void> {
  // Look up the local event
  const eventResult = await pool.query(
    `SELECT id, provider, external_event_id
     FROM calendar_event WHERE id = $1`,
    [localEventId],
  );

  if (eventResult.rows.length === 0) {
    throw new OAuthError('Calendar event not found', 'EVENT_NOT_FOUND', undefined, 404);
  }

  const row = eventResult.rows[0] as { id: string; provider: string; external_event_id: string };
  const isLocalOnly = row.external_event_id.startsWith('local-') || row.external_event_id.startsWith('workitem-');

  // If not local-only and connection_id provided, delete from provider
  if (!isLocalOnly && connection_id) {
    const access_token = await getValidAccessToken(pool, connection_id);
    const provider = row.provider as OAuthProvider;

    switch (provider) {
      case 'google':
        await google.deleteCalendarEvent(access_token, row.external_event_id);
        break;
      case 'microsoft':
        await microsoft.deleteCalendarEvent(access_token, row.external_event_id);
        break;
    }
  }

  // Delete from local DB
  await pool.query('DELETE FROM calendar_event WHERE id = $1', [localEventId]);
}
