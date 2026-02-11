/**
 * Contact sync service.
 * Part of Issue #206, refactored in Issue #1045 for connectionId-based lookups.
 */

import type { Pool } from 'pg';
import type { ProviderContact, ContactSyncResult } from './types.ts';
import { NoConnectionError } from './types.ts';
import { getConnection, getValidAccessToken, fetchProviderContacts } from './service.ts';

// PostgreSQL error codes
const PG_UNIQUE_VIOLATION = '23505';

interface LocalContact {
  id: string;
  displayName: string;
  organization: string | null;
  jobTitle: string | null;
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
    displayName: row.display_name,
    organization: row.organization,
    jobTitle: row.job_title,
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
    displayName: row.display_name,
    organization: row.organization,
    jobTitle: row.job_title,
  };
}

async function createContact(pool: Pool, contact: ProviderContact): Promise<string> {
  const displayName = contact.displayName || [contact.givenName, contact.familyName].filter(Boolean).join(' ') || contact.emailAddresses[0] || 'Unknown';

  // Build notes with name details if available
  const notes: string[] = [];
  if (contact.givenName) notes.push(`First: ${contact.givenName}`);
  if (contact.familyName) notes.push(`Last: ${contact.familyName}`);

  const result = await pool.query(
    `INSERT INTO contact (display_name, organization, job_title, notes)
     VALUES ($1, $2, $3, $4)
     RETURNING id::text`,
    [displayName, contact.company || null, contact.jobTitle || null, notes.length > 0 ? notes.join(', ') : null],
  );

  return result.rows[0].id;
}

async function updateContact(pool: Pool, contactId: string, contact: ProviderContact): Promise<void> {
  const displayName = contact.displayName || [contact.givenName, contact.familyName].filter(Boolean).join(' ');

  await pool.query(
    `UPDATE contact
     SET display_name = COALESCE($2, display_name),
         organization = COALESCE($3, organization),
         job_title = COALESCE($4, job_title),
         updated_at = now()
     WHERE id = $1`,
    [contactId, displayName || null, contact.company || null, contact.jobTitle || null],
  );
}

async function addEndpoint(pool: Pool, contactId: string, endpointType: string, endpointValue: string): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
       VALUES ($1, $2::contact_endpoint_type, $3, normalize_contact_endpoint_value($2::contact_endpoint_type, $3))
       ON CONFLICT (endpoint_type, normalized_value) DO NOTHING`,
      [contactId, endpointType, endpointValue],
    );
  } catch (error) {
    const pgError = error as { code?: string };
    if (pgError.code === PG_UNIQUE_VIOLATION) {
      return; // Expected duplicate, ignore
    }
    console.error('[ContactSync] Endpoint insert failed:', {
      contactId,
      endpointType,
      endpointValue,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function syncSingleContact(pool: Pool, contact: ProviderContact): Promise<{ created: boolean; updated: boolean; contactId: string }> {
  // Try to find existing contact by email
  for (const email of contact.emailAddresses) {
    const existing = await findContactByEmail(pool, email);
    if (existing) {
      await updateContact(pool, existing.id, contact);

      for (const newEmail of contact.emailAddresses) {
        await addEndpoint(pool, existing.id, 'email', newEmail);
      }

      for (const phone of contact.phoneNumbers) {
        await addEndpoint(pool, existing.id, 'phone', phone);
      }

      return { created: false, updated: true, contactId: existing.id };
    }
  }

  // Try to find by phone
  for (const phone of contact.phoneNumbers) {
    const existing = await findContactByPhone(pool, phone);
    if (existing) {
      await updateContact(pool, existing.id, contact);

      for (const email of contact.emailAddresses) {
        await addEndpoint(pool, existing.id, 'email', email);
      }

      for (const newPhone of contact.phoneNumbers) {
        await addEndpoint(pool, existing.id, 'phone', newPhone);
      }

      return { created: false, updated: true, contactId: existing.id };
    }
  }

  // Create new contact
  const contactId = await createContact(pool, contact);

  for (const email of contact.emailAddresses) {
    await addEndpoint(pool, contactId, 'email', email);
  }

  for (const phone of contact.phoneNumbers) {
    await addEndpoint(pool, contactId, 'phone', phone);
  }

  return { created: true, updated: false, contactId };
}

/**
 * Sync contacts for a specific OAuth connection, identified by connectionId.
 * Looks up the connection to get provider and access token.
 */
export async function syncContacts(pool: Pool, connectionId: string, options?: { syncCursor?: string }): Promise<ContactSyncResult> {
  // Look up the connection
  const connection = await getConnection(pool, connectionId);
  if (!connection) {
    throw new NoConnectionError(connectionId);
  }

  // Get valid access token (will refresh if needed)
  const accessToken = await getValidAccessToken(pool, connectionId);

  // Fetch contacts from provider
  const { contacts, syncCursor } = await fetchProviderContacts(connection.provider, accessToken, options?.syncCursor);

  let createdCount = 0;
  let updatedCount = 0;

  // Sync each contact
  for (const contact of contacts) {
    if (contact.emailAddresses.length === 0 && contact.phoneNumbers.length === 0) {
      continue;
    }

    const result = await syncSingleContact(pool, contact);
    if (result.created) {
      createdCount++;
    } else if (result.updated) {
      updatedCount++;
    }
  }

  // Store sync cursor and update last_sync_at using connectionId
  if (syncCursor) {
    await pool.query(
      `UPDATE oauth_connection
       SET token_metadata = token_metadata || $2::jsonb,
           last_sync_at = now(),
           sync_status = sync_status || $3::jsonb
       WHERE id = $1`,
      [connectionId, JSON.stringify({ contactSyncCursor: syncCursor }), JSON.stringify({ contacts: { lastSync: new Date().toISOString(), cursor: syncCursor } })],
    );
  } else {
    await pool.query(
      `UPDATE oauth_connection SET last_sync_at = now() WHERE id = $1`,
      [connectionId],
    );
  }

  return {
    provider: connection.provider,
    userEmail: connection.userEmail,
    syncedCount: contacts.length,
    createdCount,
    updatedCount,
    syncCursor,
  };
}

/**
 * Get the contact sync cursor for a specific connection.
 */
export async function getContactSyncCursor(pool: Pool, connectionId: string): Promise<string | undefined> {
  const result = await pool.query(
    `SELECT token_metadata->>'contactSyncCursor' as cursor
     FROM oauth_connection
     WHERE id = $1`,
    [connectionId],
  );

  if (result.rows.length === 0) {
    return undefined;
  }

  return result.rows[0].cursor || undefined;
}
