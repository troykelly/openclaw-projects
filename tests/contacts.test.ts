import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

describe('Contacts + endpoints + trust model', () => {
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

  it('normalizes email endpoints and enforces uniqueness on normalized value', async () => {
    const c = await pool.query(`INSERT INTO contact (display_name) VALUES ('Troy') RETURNING id`);
    const contactId = c.rows[0].id as string;

    const e1 = await pool.query(
      `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
       VALUES ($1, 'email', $2)
       RETURNING normalized_value`,
      [contactId, '  Troy@Example.COM  ']
    );
    expect(e1.rows[0].normalized_value).toBe('troy@example.com');

    // Global uniqueness: normalized email cannot belong to multiple contacts
    const c2 = await pool.query(`INSERT INTO contact (display_name) VALUES ('Other') RETURNING id`);
    const contactId2 = c2.rows[0].id as string;

    await expect(
      pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
         VALUES ($1, 'email', $2)`,
        [contactId2, 'troy@example.com']
      )
    ).rejects.toThrow(/contact_endpoint/);
  });

  it('normalizes telegram handles by stripping @ and lowercasing', async () => {
    const c = await pool.query(`INSERT INTO contact (display_name) VALUES ('Matty') RETURNING id`);
    const contactId = c.rows[0].id as string;

    const e1 = await pool.query(
      `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
       VALUES ($1, 'telegram', $2)
       RETURNING normalized_value`,
      [contactId, ' @SomeUser ']
    );

    expect(e1.rows[0].normalized_value).toBe('someuser');
  });

  it('disallows privileged actions via SMS/phone endpoints by policy', async () => {
    const c = await pool.query(`INSERT INTO contact (display_name) VALUES ('Ops') RETURNING id`);
    const contactId = c.rows[0].id as string;

    await expect(
      pool.query(
        `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value, allow_privileged_actions)
         VALUES ($1, 'phone', $2, true)`,
        [contactId, '+1 (555) 123-4567']
      )
    ).rejects.toThrow(/no_privileged_via_phone/);
  });
});
