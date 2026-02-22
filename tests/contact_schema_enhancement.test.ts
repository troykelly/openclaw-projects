import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

describe('Contact Schema Enhancement (Issue #208)', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('New contact metadata columns', () => {
    it('supports organization and job_title fields', async () => {
      const result = await pool.query(
        `INSERT INTO contact (display_name, organization, job_title)
         VALUES ('John Smith', 'Acme Corp', 'CTO')
         RETURNING id::text as id, display_name, organization, job_title`,
      );

      expect(result.rows[0].display_name).toBe('John Smith');
      expect(result.rows[0].organization).toBe('Acme Corp');
      expect(result.rows[0].job_title).toBe('CTO');
    });

    it('supports timezone field with IANA timezone names', async () => {
      const result = await pool.query(
        `INSERT INTO contact (display_name, timezone)
         VALUES ('Jane Doe', 'Australia/Sydney')
         RETURNING timezone`,
      );

      expect(result.rows[0].timezone).toBe('Australia/Sydney');
    });

    it('supports birthday via contact_date table', async () => {
      const contactResult = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Birthday Person')
         RETURNING id::text as id`,
      );
      const contact_id = contactResult.rows[0].id;

      const result = await pool.query(
        `INSERT INTO contact_date (contact_id, date_type, date_value, label)
         VALUES ($1, 'birthday', '1990-05-15', 'Birthday')
         RETURNING date_value`,
        [contact_id],
      );

      const birthday = new Date(result.rows[0].date_value);
      expect(birthday.getMonth()).toBe(4); // May (0-indexed)
      expect(birthday.getDate()).toBe(15);
    });

    it('supports pronouns and language fields', async () => {
      const result = await pool.query(
        `INSERT INTO contact (display_name, pronouns, language)
         VALUES ('Alex', 'they/them', 'es')
         RETURNING pronouns, language`,
      );

      expect(result.rows[0].pronouns).toBe('they/them');
      expect(result.rows[0].language).toBe('es');
    });

    it('defaults language to en', async () => {
      const result = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Default Lang')
         RETURNING language`,
      );

      expect(result.rows[0].language).toBe('en');
    });

    it('supports relationship_type and relationship_notes', async () => {
      const result = await pool.query(
        `INSERT INTO contact (display_name, relationship_type, relationship_notes)
         VALUES ('Client Contact', 'client', 'Met at TechCrunch 2025')
         RETURNING relationship_type, relationship_notes`,
      );

      expect(result.rows[0].relationship_type).toBe('client');
      expect(result.rows[0].relationship_notes).toBe('Met at TechCrunch 2025');
    });

    it('supports first_contact_date', async () => {
      const result = await pool.query(
        `INSERT INTO contact (display_name, first_contact_date)
         VALUES ('First Contact', '2025-01-15T10:00:00Z')
         RETURNING first_contact_date`,
      );

      expect(result.rows[0].first_contact_date).toBeDefined();
    });

    it('supports photo_url', async () => {
      const result = await pool.query(
        `INSERT INTO contact (display_name, photo_url)
         VALUES ('Photo Contact', 'https://example.com/photo.jpg')
         RETURNING photo_url`,
      );

      expect(result.rows[0].photo_url).toBe('https://example.com/photo.jpg');
    });
  });

  describe('Preferred endpoint reference', () => {
    it('can link to a preferred contact endpoint', async () => {
      // Create contact
      const contactResult = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Multi Endpoint')
         RETURNING id::text as id`,
      );
      const contact_id = contactResult.rows[0].id;

      // Create endpoints
      const emailResult = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
         VALUES ($1, 'email', 'test@example.com', 'test@example.com')
         RETURNING id::text as id`,
        [contact_id],
      );
      const emailId = emailResult.rows[0].id;

      // Set as preferred
      await pool.query(`UPDATE contact SET preferred_endpoint_id = $1 WHERE id = $2`, [emailId, contact_id]);

      const result = await pool.query(`SELECT preferred_endpoint_id::text FROM contact WHERE id = $1`, [contact_id]);

      expect(result.rows[0].preferred_endpoint_id).toBe(emailId);
    });

    it('nullifies preferred_endpoint_id when endpoint is deleted', async () => {
      const contactResult = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Endpoint Delete Test')
         RETURNING id::text as id`,
      );
      const contact_id = contactResult.rows[0].id;

      const endpointResult = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
         VALUES ($1, 'email', 'delete@example.com', 'delete@example.com')
         RETURNING id::text as id`,
        [contact_id],
      );
      const endpointId = endpointResult.rows[0].id;

      await pool.query(`UPDATE contact SET preferred_endpoint_id = $1 WHERE id = $2`, [endpointId, contact_id]);

      // Delete the endpoint
      await pool.query(`DELETE FROM contact_endpoint WHERE id = $1`, [endpointId]);

      // Check that preferred_endpoint_id is now null
      const result = await pool.query(`SELECT preferred_endpoint_id FROM contact WHERE id = $1`, [contact_id]);

      expect(result.rows[0].preferred_endpoint_id).toBeNull();
    });
  });

  describe('External identity linking', () => {
    it('creates external identity record', async () => {
      const contactResult = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Synced Contact')
         RETURNING id::text as id`,
      );
      const contact_id = contactResult.rows[0].id;

      const result = await pool.query(
        `INSERT INTO contact_external_identity
           (contact_id, provider, external_id, sync_status, synced_at)
         VALUES ($1, 'microsoft', 'ms-123', 'synced', NOW())
         RETURNING provider, external_id, sync_status`,
        [contact_id],
      );

      expect(result.rows[0].provider).toBe('microsoft');
      expect(result.rows[0].external_id).toBe('ms-123');
      expect(result.rows[0].sync_status).toBe('synced');
    });

    it('enforces unique contact per provider', async () => {
      const contactResult = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Unique Provider Test')
         RETURNING id::text as id`,
      );
      const contact_id = contactResult.rows[0].id;

      await pool.query(
        `INSERT INTO contact_external_identity (contact_id, provider, external_id)
         VALUES ($1, 'google', 'google-123')`,
        [contact_id],
      );

      // Should fail on duplicate
      await expect(
        pool.query(
          `INSERT INTO contact_external_identity (contact_id, provider, external_id)
           VALUES ($1, 'google', 'google-456')`,
          [contact_id],
        ),
      ).rejects.toThrow(/duplicate/i);
    });

    it('enforces unique external_id per provider', async () => {
      const contact1 = await pool.query(`INSERT INTO contact (display_name) VALUES ('Contact 1') RETURNING id::text as id`);
      const contact2 = await pool.query(`INSERT INTO contact (display_name) VALUES ('Contact 2') RETURNING id::text as id`);

      await pool.query(
        `INSERT INTO contact_external_identity (contact_id, provider, external_id)
         VALUES ($1, 'microsoft', 'same-id')`,
        [contact1.rows[0].id],
      );

      await expect(
        pool.query(
          `INSERT INTO contact_external_identity (contact_id, provider, external_id)
           VALUES ($1, 'microsoft', 'same-id')`,
          [contact2.rows[0].id],
        ),
      ).rejects.toThrow(/duplicate/i);
    });

    it('supports multiple providers per contact', async () => {
      const contactResult = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Multi Provider')
         RETURNING id::text as id`,
      );
      const contact_id = contactResult.rows[0].id;

      await pool.query(
        `INSERT INTO contact_external_identity (contact_id, provider, external_id)
         VALUES ($1, 'microsoft', 'ms-id'),
                ($1, 'google', 'google-id')`,
        [contact_id],
      );

      const result = await pool.query(`SELECT provider FROM contact_external_identity WHERE contact_id = $1 ORDER BY provider`, [contact_id]);

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].provider).toBe('google');
      expect(result.rows[1].provider).toBe('microsoft');
    });

    it('validates provider values', async () => {
      const contactResult = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Provider Check')
         RETURNING id::text as id`,
      );
      const contact_id = contactResult.rows[0].id;

      await expect(
        pool.query(
          `INSERT INTO contact_external_identity (contact_id, provider, external_id)
           VALUES ($1, 'invalid_provider', 'id-123')`,
          [contact_id],
        ),
      ).rejects.toThrow(/check/i);
    });

    it('validates sync_status values', async () => {
      const contactResult = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Status Check')
         RETURNING id::text as id`,
      );
      const contact_id = contactResult.rows[0].id;

      await expect(
        pool.query(
          `INSERT INTO contact_external_identity (contact_id, provider, external_id, sync_status)
           VALUES ($1, 'microsoft', 'id-123', 'invalid_status')`,
          [contact_id],
        ),
      ).rejects.toThrow(/check/i);
    });

    it('cascades delete when contact is deleted', async () => {
      const contactResult = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Cascade Delete')
         RETURNING id::text as id`,
      );
      const contact_id = contactResult.rows[0].id;

      await pool.query(
        `INSERT INTO contact_external_identity (contact_id, provider, external_id)
         VALUES ($1, 'microsoft', 'cascade-test')`,
        [contact_id],
      );

      // Delete contact
      await pool.query(`DELETE FROM contact WHERE id = $1`, [contact_id]);

      // External identity should be deleted
      const result = await pool.query(`SELECT COUNT(*) as count FROM contact_external_identity WHERE contact_id = $1`, [contact_id]);

      expect(parseInt(result.rows[0].count, 10)).toBe(0);
    });
  });

  describe('Auto-update last_contact_date', () => {
    it('updates last_contact_date when message is received', async () => {
      // Create contact with endpoint and thread
      const contactResult = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Message Test')
         RETURNING id::text as id`,
      );
      const contact_id = contactResult.rows[0].id;

      const endpointResult = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
         VALUES ($1, 'phone', '+15551234567', '+15551234567')
         RETURNING id::text as id`,
        [contact_id],
      );
      const endpointId = endpointResult.rows[0].id;

      const threadResult = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'phone', 'thread-auto-update')
         RETURNING id::text as id`,
        [endpointId],
      );
      const thread_id = threadResult.rows[0].id;

      // Initially null
      const beforeResult = await pool.query(`SELECT last_contact_date FROM contact WHERE id = $1`, [contact_id]);
      expect(beforeResult.rows[0].last_contact_date).toBeNull();

      // Insert message
      const messageTime = new Date('2026-02-01T15:00:00Z');
      await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, received_at)
         VALUES ($1, 'msg-trigger', 'inbound', 'Hello', $2)`,
        [thread_id, messageTime],
      );

      // Check last_contact_date was updated
      const afterResult = await pool.query(`SELECT last_contact_date FROM contact WHERE id = $1`, [contact_id]);

      expect(afterResult.rows[0].last_contact_date).not.toBeNull();
      const lastContact = new Date(afterResult.rows[0].last_contact_date);
      expect(lastContact.toISOString()).toBe(messageTime.toISOString());
    });

    it('keeps the most recent last_contact_date', async () => {
      const contactResult = await pool.query(
        `INSERT INTO contact (display_name, last_contact_date)
         VALUES ('Newer Date Test', '2026-02-10T10:00:00Z')
         RETURNING id::text as id`,
      );
      const contact_id = contactResult.rows[0].id;

      const endpointResult = await pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, normalized_value)
         VALUES ($1, 'phone', '+15559999999', '+15559999999')
         RETURNING id::text as id`,
        [contact_id],
      );
      const endpointId = endpointResult.rows[0].id;

      const threadResult = await pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'phone', 'thread-newer')
         RETURNING id::text as id`,
        [endpointId],
      );
      const thread_id = threadResult.rows[0].id;

      // Insert an older message - should NOT update last_contact_date
      await pool.query(
        `INSERT INTO external_message (thread_id, external_message_key, direction, body, received_at)
         VALUES ($1, 'older-msg', 'inbound', 'Older', '2026-02-05T10:00:00Z')`,
        [thread_id],
      );

      const result = await pool.query(`SELECT last_contact_date FROM contact WHERE id = $1`, [contact_id]);

      // Should still be the original date (Feb 10), not the older message date (Feb 5)
      const lastContact = new Date(result.rows[0].last_contact_date);
      expect(lastContact.getDate()).toBe(10);
    });
  });

  describe('Contact memories via memory table', () => {
    it('can link memories to contacts', async () => {
      const contactResult = await pool.query(
        `INSERT INTO contact (display_name)
         VALUES ('Memory Contact')
         RETURNING id::text as id`,
      );
      const contact_id = contactResult.rows[0].id;

      // Create memory linked to contact
      const memoryResult = await pool.query(
        `INSERT INTO memory (title, content, memory_type, contact_id, importance)
         VALUES ('Preference', 'Prefers email over phone', 'preference', $1, 8)
         RETURNING id::text as id, contact_id::text`,
        [contact_id],
      );

      expect(memoryResult.rows[0].contact_id).toBe(contact_id);

      // Query memories for contact
      const memories = await pool.query(
        `SELECT title, content, memory_type
         FROM memory
         WHERE contact_id = $1
         ORDER BY created_at`,
        [contact_id],
      );

      expect(memories.rows).toHaveLength(1);
      expect(memories.rows[0].title).toBe('Preference');
      expect(memories.rows[0].memory_type).toBe('preference');
    });
  });
});
