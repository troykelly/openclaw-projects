/**
 * Contact sync service.
 * Part of Issue #206.
 */

import type { Pool } from 'pg';
import type { OAuthProvider, ProviderContact, ContactSyncResult } from './types.ts';
import { getValidAccessToken, fetchProviderContacts } from './service.ts';

// PostgreSQL error codes
const PG_UNIQUE_VIOLATION = '23505';

interface LocalContact {
  id: string;
  displayName: string;
  organization: string | null;
  jobTitle: string | null;
}

interface ContactEndpoint {
  contactId: string;
  endpointType: string;
  endpointValue: string;
}

async function findContactByEmail(
  pool: Pool,
  email: string
): Promise<LocalContact | null> {
  const result = await pool.query(
    `SELECT c.id::text, c.display_name, c.organization, c.job_title
     FROM contact c
     JOIN contact_endpoint ce ON ce.contact_id = c.id
     WHERE ce.endpoint_type = 'email' AND LOWER(ce.endpoint_value) = LOWER($1)
     LIMIT 1`,
    [email]
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

async function findContactByPhone(
  pool: Pool,
  phone: string
): Promise<LocalContact | null> {
  // Normalize phone number for comparison (remove non-digits except +)
  const normalizedPhone = phone.replace(/[^0-9+]/g, '');

  const result = await pool.query(
    `SELECT c.id::text, c.display_name, c.organization, c.job_title
     FROM contact c
     JOIN contact_endpoint ce ON ce.contact_id = c.id
     WHERE ce.endpoint_type = 'phone' AND ce.normalized_value = $1
     LIMIT 1`,
    [normalizedPhone]
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

async function createContact(
  pool: Pool,
  contact: ProviderContact
): Promise<string> {
  const displayName = contact.displayName ||
    [contact.givenName, contact.familyName].filter(Boolean).join(' ') ||
    contact.emailAddresses[0] ||
    'Unknown';

  // Build notes with name details if available
  const notes: string[] = [];
  if (contact.givenName) notes.push(`First: ${contact.givenName}`);
  if (contact.familyName) notes.push(`Last: ${contact.familyName}`);

  const result = await pool.query(
    `INSERT INTO contact (display_name, organization, job_title, notes)
     VALUES ($1, $2, $3, $4)
     RETURNING id::text`,
    [
      displayName,
      contact.company || null,
      contact.jobTitle || null,
      notes.length > 0 ? notes.join(', ') : null,
    ]
  );

  return result.rows[0].id;
}

async function updateContact(
  pool: Pool,
  contactId: string,
  contact: ProviderContact
): Promise<void> {
  const displayName = contact.displayName ||
    [contact.givenName, contact.familyName].filter(Boolean).join(' ');

  await pool.query(
    `UPDATE contact
     SET display_name = COALESCE($2, display_name),
         organization = COALESCE($3, organization),
         job_title = COALESCE($4, job_title),
         updated_at = now()
     WHERE id = $1`,
    [
      contactId,
      displayName || null,
      contact.company || null,
      contact.jobTitle || null,
    ]
  );
}

async function getContactEndpoints(
  pool: Pool,
  contactId: string
): Promise<ContactEndpoint[]> {
  const result = await pool.query(
    `SELECT contact_id::text, endpoint_type::text, endpoint_value, normalized_value
     FROM contact_endpoint
     WHERE contact_id = $1`,
    [contactId]
  );

  return result.rows.map((row) => ({
    contactId: row.contact_id,
    endpointType: row.endpoint_type,
    endpointValue: row.endpoint_value,
  }));
}

async function addEndpoint(
  pool: Pool,
  contactId: string,
  endpointType: string,
  endpointValue: string
): Promise<void> {
  // The normalized_value is set by a trigger, so we just need to provide the raw value
  // The ON CONFLICT handles the unique constraint on (endpoint_type, normalized_value)
  try {
    await pool.query(
      `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
       VALUES ($1, $2::contact_endpoint_type, $3, normalize_contact_endpoint_value($2::contact_endpoint_type, $3))
       ON CONFLICT (endpoint_type, normalized_value) DO NOTHING`,
      [contactId, endpointType, endpointValue]
    );
  } catch (error) {
    // Only ignore unique constraint violations (expected duplicates)
    const pgError = error as { code?: string };
    if (pgError.code === PG_UNIQUE_VIOLATION) {
      return; // Expected duplicate, ignore
    }
    // Log and rethrow unexpected errors
    console.error('[ContactSync] Endpoint insert failed:', {
      contactId,
      endpointType,
      endpointValue,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function syncSingleContact(
  pool: Pool,
  contact: ProviderContact
): Promise<{ created: boolean; updated: boolean; contactId: string }> {
  // Try to find existing contact by email
  for (const email of contact.emailAddresses) {
    const existing = await findContactByEmail(pool, email);
    if (existing) {
      // Update existing contact
      await updateContact(pool, existing.id, contact);

      // Add any new endpoints (the addEndpoint function handles duplicates)
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

      // Add any new endpoints
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

  // Add all endpoints
  for (const email of contact.emailAddresses) {
    await addEndpoint(pool, contactId, 'email', email);
  }

  for (const phone of contact.phoneNumbers) {
    await addEndpoint(pool, contactId, 'phone', phone);
  }

  return { created: true, updated: false, contactId };
}

export async function syncContacts(
  pool: Pool,
  userEmail: string,
  provider: OAuthProvider,
  options?: { syncCursor?: string }
): Promise<ContactSyncResult> {
  // Get valid access token (will refresh if needed)
  const accessToken = await getValidAccessToken(pool, userEmail, provider);

  // Fetch contacts from provider
  const { contacts, syncCursor } = await fetchProviderContacts(
    provider,
    accessToken,
    options?.syncCursor
  );

  let createdCount = 0;
  let updatedCount = 0;

  // Sync each contact
  for (const contact of contacts) {
    // Skip contacts without email or phone
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

  // Store sync cursor in oauth_connection metadata
  if (syncCursor) {
    await pool.query(
      `UPDATE oauth_connection
       SET token_metadata = token_metadata || $3::jsonb
       WHERE user_email = $1 AND provider = $2`,
      [userEmail, provider, JSON.stringify({ contactSyncCursor: syncCursor })]
    );
  }

  return {
    provider,
    userEmail,
    syncedCount: contacts.length,
    createdCount,
    updatedCount,
    syncCursor,
  };
}

export async function getContactSyncCursor(
  pool: Pool,
  userEmail: string,
  provider: OAuthProvider
): Promise<string | undefined> {
  const result = await pool.query(
    `SELECT token_metadata->>'contactSyncCursor' as cursor
     FROM oauth_connection
     WHERE user_email = $1 AND provider = $2`,
    [userEmail, provider]
  );

  if (result.rows.length === 0) {
    return undefined;
  }

  return result.rows[0].cursor || undefined;
}
