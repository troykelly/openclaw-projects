/**
 * Tests for contact sync service.
 * Part of Issue #206.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';
import { runMigrate } from '../helpers/migrate.ts';

// Mock the provider fetch functions
vi.mock('../../src/api/oauth/microsoft.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/oauth/microsoft.ts')>();
  return {
    ...actual,
    fetchAllContacts: vi.fn(),
  };
});

vi.mock('../../src/api/oauth/google.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/oauth/google.ts')>();
  return {
    ...actual,
    fetchAllContacts: vi.fn(),
  };
});

describe('Contact Sync Service', () => {
  let pool: Pool;
  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    pool = createTestPool();
    await runMigrate('up');
    await truncateAllTables(pool);

    // Configure providers for tests
    process.env.GOOGLE_CLIENT_ID = 'test-google-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
    process.env.MS365_CLIENT_ID = 'test-ms-id';
    process.env.MS365_CLIENT_SECRET = 'test-ms-secret';
  });

  afterEach(async () => {
    process.env = originalEnv;
    await pool.end();
    vi.clearAllMocks();
  });

  describe('syncContacts', () => {
    it('creates new contacts from provider data', async () => {
      // Set up OAuth connection
      const connResult = await pool.query(
        `INSERT INTO oauth_connection (user_email, provider, access_token, scopes, expires_at)
         VALUES ('test@example.com', 'google', 'valid-token', ARRAY['contacts'], NOW() + INTERVAL '1 hour')
         RETURNING id::text`,
      );
      const connectionId = connResult.rows[0].id;

      // Mock provider response
      const { fetchAllContacts } = await import('../../src/api/oauth/google.ts');
      (fetchAllContacts as ReturnType<typeof vi.fn>).mockResolvedValue({
        contacts: [
          {
            id: 'contact-1',
            displayName: 'John Doe',
            givenName: 'John',
            familyName: 'Doe',
            emailAddresses: ['john@example.com'],
            phoneNumbers: ['+1234567890'],
            company: 'Acme Inc',
            jobTitle: 'Engineer',
            metadata: { provider: 'google' },
          },
        ],
        syncCursor: 'next-sync-token',
      });

      const { syncContacts } = await import('../../src/api/oauth/contacts.ts');
      const result = await syncContacts(pool, connectionId);

      expect(result.syncedCount).toBe(1);
      expect(result.createdCount).toBe(1);
      expect(result.updatedCount).toBe(0);

      // Verify contact was created
      const contacts = await pool.query('SELECT * FROM contact');
      expect(contacts.rows).toHaveLength(1);
      expect(contacts.rows[0].display_name).toBe('John Doe');
      expect(contacts.rows[0].organization).toBe('Acme Inc');
      expect(contacts.rows[0].job_title).toBe('Engineer');
      // Name details are stored in notes
      expect(contacts.rows[0].notes).toContain('First: John');
      expect(contacts.rows[0].notes).toContain('Last: Doe');

      // Verify endpoints were created
      const endpoints = await pool.query('SELECT * FROM contact_endpoint');
      expect(endpoints.rows).toHaveLength(2); // email + phone
    });

    it('updates existing contacts with matching email', async () => {
      // Create existing contact
      const contactResult = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Old Name')
         RETURNING id`,
      );
      const contactId = contactResult.rows[0].id;

      await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'email', 'john@example.com')`,
        [contactId],
      );

      // Set up OAuth connection
      const connResult = await pool.query(
        `INSERT INTO oauth_connection (user_email, provider, access_token, scopes, expires_at)
         VALUES ('test@example.com', 'google', 'valid-token', ARRAY['contacts'], NOW() + INTERVAL '1 hour')
         RETURNING id::text`,
      );
      const connectionId = connResult.rows[0].id;

      // Mock provider response with same email
      const { fetchAllContacts } = await import('../../src/api/oauth/google.ts');
      (fetchAllContacts as ReturnType<typeof vi.fn>).mockResolvedValue({
        contacts: [
          {
            id: 'contact-1',
            displayName: 'John Doe',
            givenName: 'John',
            familyName: 'Doe',
            emailAddresses: ['john@example.com'],
            phoneNumbers: [],
            metadata: { provider: 'google' },
          },
        ],
      });

      const { syncContacts } = await import('../../src/api/oauth/contacts.ts');
      const result = await syncContacts(pool, connectionId);

      expect(result.createdCount).toBe(0);
      expect(result.updatedCount).toBe(1);

      // Verify contact was updated (display_name changes, but notes preserved)
      const contacts = await pool.query('SELECT * FROM contact WHERE id = $1', [contactId]);
      expect(contacts.rows[0].display_name).toBe('John Doe');
    });

    it('adds new endpoints to existing contact', async () => {
      // Create existing contact with email only
      const contactResult = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('John Doe')
         RETURNING id`,
      );
      const contactId = contactResult.rows[0].id;

      await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'email', 'john@example.com')`,
        [contactId],
      );

      // Set up OAuth connection
      const connResult = await pool.query(
        `INSERT INTO oauth_connection (user_email, provider, access_token, scopes, expires_at)
         VALUES ('test@example.com', 'google', 'valid-token', ARRAY['contacts'], NOW() + INTERVAL '1 hour')
         RETURNING id::text`,
      );
      const connectionId = connResult.rows[0].id;

      // Mock provider with additional phone number
      const { fetchAllContacts } = await import('../../src/api/oauth/google.ts');
      (fetchAllContacts as ReturnType<typeof vi.fn>).mockResolvedValue({
        contacts: [
          {
            id: 'contact-1',
            displayName: 'John Doe',
            emailAddresses: ['john@example.com'],
            phoneNumbers: ['+1234567890'],
            metadata: { provider: 'google' },
          },
        ],
      });

      const { syncContacts } = await import('../../src/api/oauth/contacts.ts');
      await syncContacts(pool, connectionId);

      // Verify new endpoint was added
      const endpoints = await pool.query('SELECT * FROM contact_endpoint WHERE contact_id = $1 ORDER BY endpoint_type', [contactId]);
      expect(endpoints.rows).toHaveLength(2);
      expect(endpoints.rows.some((e) => e.endpoint_type === 'phone')).toBe(true);
    });

    it('skips contacts without email or phone', async () => {
      const connResult = await pool.query(
        `INSERT INTO oauth_connection (user_email, provider, access_token, scopes, expires_at)
         VALUES ('test@example.com', 'google', 'valid-token', ARRAY['contacts'], NOW() + INTERVAL '1 hour')
         RETURNING id::text`,
      );
      const connectionId = connResult.rows[0].id;

      const { fetchAllContacts } = await import('../../src/api/oauth/google.ts');
      (fetchAllContacts as ReturnType<typeof vi.fn>).mockResolvedValue({
        contacts: [
          {
            id: 'contact-no-info',
            displayName: 'No Contact Info',
            emailAddresses: [],
            phoneNumbers: [],
            metadata: { provider: 'google' },
          },
        ],
      });

      const { syncContacts } = await import('../../src/api/oauth/contacts.ts');
      const result = await syncContacts(pool, connectionId);

      expect(result.syncedCount).toBe(1);
      expect(result.createdCount).toBe(0);

      const contacts = await pool.query('SELECT * FROM contact');
      expect(contacts.rows).toHaveLength(0);
    });

    it('stores sync cursor for incremental sync', async () => {
      const connResult = await pool.query(
        `INSERT INTO oauth_connection (user_email, provider, access_token, scopes, expires_at)
         VALUES ('test@example.com', 'google', 'valid-token', ARRAY['contacts'], NOW() + INTERVAL '1 hour')
         RETURNING id::text`,
      );
      const connectionId = connResult.rows[0].id;

      const { fetchAllContacts } = await import('../../src/api/oauth/google.ts');
      (fetchAllContacts as ReturnType<typeof vi.fn>).mockResolvedValue({
        contacts: [],
        syncCursor: 'new-sync-cursor-123',
      });

      const { syncContacts, getContactSyncCursor } = await import('../../src/api/oauth/contacts.ts');
      await syncContacts(pool, connectionId);

      const cursor = await getContactSyncCursor(pool, connectionId);
      expect(cursor).toBe('new-sync-cursor-123');
    });
  });
});
