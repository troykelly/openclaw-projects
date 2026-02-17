/**
 * Contact sync service.
 * Part of Issue #206, refactored in Issue #1045 for connection_id-based lookups.
 */

import type { Pool } from 'pg';
import type { ProviderContact, ContactSyncResult } from './types.ts';
import { NoConnectionError } from './types.ts';
import { getConnection, getValidAccessToken, fetchProviderContacts } from './service.ts';

// PostgreSQL error codes
const PG_UNIQUE_VIOLATION = '23505';

interface LocalContact {
  id: string;
  display_name: string;
  organization: string | null;
  job_title: string | null;
}

async function findContactByEmail(pool: Pool, email: string): Promise<LocalContact | null> {
  const result = await pool.query(
    `SELECT c.id::text, c.display_name, c.organization, c.job_title
     FROM contact c
     JOIN contact_endpoint ce ON ce.contact_id = c.id
     WHERE ce.endpoint_type = 'email' AND LOWER(ce.endpoint_value) = LOWER($1)
     LIMIT 1`,
    [email],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    display_name: row.display_name,
    organization: row.organization,
    job_title: row.job_title,
  };
}

async function findContactByPhone(pool: Pool, phone: string): Promise<LocalContact | null> {
  // Normalize phone number for comparison (remove non-digits except +)
  const normalizedPhone = phone.replace(/[^0-9+]/g, '');

  const result = await pool.query(
    `SELECT c.id::text, c.display_name, c.organization, c.job_title
     FROM contact c
     JOIN contact_endpoint ce ON ce.contact_id = c.id
     WHERE ce.endpoint_type = 'phone' AND ce.normalized_value = $1
     LIMIT 1`,
    [normalizedPhone],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    display_name: row.display_name,
    organization: row.organization,
    job_title: row.job_title,
  };
}

async function createContact(pool: Pool, contact: ProviderContact): Promise<string> {
  const display_name = contact.display_name || [contact.given_name, contact.family_name].filter(Boolean).join(' ') || contact.email_addresses[0] || 'Unknown';

  // Build notes with name details if available
  const notes: string[] = [];
  if (contact.given_name) notes.push(`First: ${contact.given_name}`);
  if (contact.family_name) notes.push(`Last: ${contact.family_name}`);

  const result = await pool.query(
    `INSERT INTO contact (display_name, organization, job_title, notes)
     VALUES ($1, $2, $3, $4)
     RETURNING id::text`,
    [display_name, contact.company || null, contact.job_title || null, notes.length > 0 ? notes.join(', ') : null],
  );

  return result.rows[0].id;
}

async function updateContact(pool: Pool, contact_id: string, contact: ProviderContact): Promise<void> {
  const display_name = contact.display_name || [contact.given_name, contact.family_name].filter(Boolean).join(' ');

  await pool.query(
    `UPDATE contact
     SET display_name = COALESCE($2, display_name),
         organization = COALESCE($3, organization),
         job_title = COALESCE($4, job_title),
         updated_at = now()
     WHERE id = $1`,
    [contact_id, display_name || null, contact.company || null, contact.job_title || null],
  );
}

async function addEndpoint(pool: Pool, contact_id: string, endpoint_type: string, endpoint_value: string): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
       VALUES ($1, $2::contact_endpoint_type, $3, normalize_contact_endpoint_value($2::contact_endpoint_type, $3))
       ON CONFLICT (endpoint_type, normalized_value) DO NOTHING`,
      [contact_id, endpoint_type, endpoint_value],
    );
  } catch (error) {
    const pgError = error as { code?: string };
    if (pgError.code === PG_UNIQUE_VIOLATION) {
      return; // Expected duplicate, ignore
    }
    console.error('[ContactSync] Endpoint insert failed:', {
      contact_id,
      endpoint_type,
      endpoint_value,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function syncSingleContact(pool: Pool, contact: ProviderContact): Promise<{ created: boolean; updated: boolean; contact_id: string }> {
  // Try to find existing contact by email
  for (const email of contact.email_addresses) {
    const existing = await findContactByEmail(pool, email);
    if (existing) {
      await updateContact(pool, existing.id, contact);

      for (const newEmail of contact.email_addresses) {
        await addEndpoint(pool, existing.id, 'email', newEmail);
      }

      for (const phone of contact.phone_numbers) {
        await addEndpoint(pool, existing.id, 'phone', phone);
      }

      return { created: false, updated: true, contact_id: existing.id };
    }
  }

  // Try to find by phone
  for (const phone of contact.phone_numbers) {
    const existing = await findContactByPhone(pool, phone);
    if (existing) {
      await updateContact(pool, existing.id, contact);

      for (const email of contact.email_addresses) {
        await addEndpoint(pool, existing.id, 'email', email);
      }

      for (const newPhone of contact.phone_numbers) {
        await addEndpoint(pool, existing.id, 'phone', newPhone);
      }

      return { created: false, updated: true, contact_id: existing.id };
    }
  }

  // Create new contact
  const contact_id = await createContact(pool, contact);

  for (const email of contact.email_addresses) {
    await addEndpoint(pool, contact_id, 'email', email);
  }

  for (const phone of contact.phone_numbers) {
    await addEndpoint(pool, contact_id, 'phone', phone);
  }

  return { created: true, updated: false, contact_id };
}

/**
 * Sync contacts for a specific OAuth connection, identified by connection_id.
 * Looks up the connection to get provider and access token.
 */
export async function syncContacts(pool: Pool, connection_id: string, options?: { sync_cursor?: string }): Promise<ContactSyncResult> {
  // Look up the connection
  const connection = await getConnection(pool, connection_id);
  if (!connection) {
    throw new NoConnectionError(connection_id);
  }

  // Get valid access token (will refresh if needed)
  const access_token = await getValidAccessToken(pool, connection_id);

  // Fetch contacts from provider
  const { contacts, sync_cursor } = await fetchProviderContacts(connection.provider, access_token, options?.sync_cursor);

  let created_count = 0;
  let updated_count = 0;

  // Sync each contact
  for (const contact of contacts) {
    if (contact.email_addresses.length === 0 && contact.phone_numbers.length === 0) {
      continue;
    }

    const result = await syncSingleContact(pool, contact);
    if (result.created) {
      created_count++;
    } else if (result.updated) {
      updated_count++;
    }
  }

  // Store sync cursor and update last_sync_at using connection_id
  if (sync_cursor) {
    await pool.query(
      `UPDATE oauth_connection
       SET token_metadata = token_metadata || $2::jsonb,
           last_sync_at = now(),
           sync_status = sync_status || $3::jsonb
       WHERE id = $1`,
      [connection_id, JSON.stringify({ contactSyncCursor: sync_cursor }), JSON.stringify({ contacts: { lastSync: new Date().toISOString(), cursor: sync_cursor } })],
    );
  } else {
    await pool.query(
      `UPDATE oauth_connection SET last_sync_at = now() WHERE id = $1`,
      [connection_id],
    );
  }

  return {
    provider: connection.provider,
    user_email: connection.user_email,
    synced_count: contacts.length,
    created_count,
    updated_count,
    sync_cursor,
  };
}

/**
 * Get the contact sync cursor for a specific connection.
 */
export async function getContactSyncCursor(pool: Pool, connection_id: string): Promise<string | undefined> {
  const result = await pool.query(
    `SELECT token_metadata->>'contactSyncCursor' as cursor
     FROM oauth_connection
     WHERE id = $1`,
    [connection_id],
  );

  if (result.rows.length === 0) {
    return undefined;
  }

  return result.rows[0].cursor || undefined;
}
