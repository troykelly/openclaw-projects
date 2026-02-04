import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from './helpers/migrate.ts';
import { createTestPool, truncateAllTables } from './helpers/db.ts';

describe('External inbound messages -> threads -> work items', () => {
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

  it('links an inbound external message thread to a communication work item', async () => {
    const c = await pool.query(`INSERT INTO contact (display_name) VALUES ('Sender') RETURNING id`);
    const contactId = c.rows[0].id as string;

    const endpoint = await pool.query(
      `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
       VALUES ($1, 'phone', $2)
       RETURNING id`,
      [contactId, '+15551234567']
    );
    const endpointId = endpoint.rows[0].id as string;

    const thread = await pool.query(
      `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
       VALUES ($1, 'phone', $2)
       RETURNING id`,
      [endpointId, 'twilio:SMXXXXXXXXXXXXXXXX']
    );
    const threadId = thread.rows[0].id as string;

    const msg = await pool.query(
      `INSERT INTO external_message (thread_id, external_message_key, direction, body)
       VALUES ($1, $2, 'inbound', 'hello')
       RETURNING id`,
      [threadId, 'twilio:MMYYYYYYYYYYYYYYYY']
    );
    const msgId = msg.rows[0].id as string;

    const wi = await pool.query(`INSERT INTO work_item (title) VALUES ('Reply required') RETURNING id`);
    const workItemId = wi.rows[0].id as string;

    await pool.query(
      `INSERT INTO work_item_communication (work_item_id, thread_id, message_id, action)
       VALUES ($1, $2, $3, 'reply_required')`,
      [workItemId, threadId, msgId]
    );

    const joined = await pool.query(
      `SELECT w.task_type::text as task_type, t.external_thread_key, m.direction::text as direction
       FROM work_item w
       JOIN work_item_communication wc ON wc.work_item_id = w.id
       JOIN external_thread t ON t.id = wc.thread_id
       JOIN external_message m ON m.id = wc.message_id
       WHERE w.id = $1`,
      [workItemId]
    );

    expect(joined.rows[0].task_type).toBe('communication');
    expect(joined.rows[0].external_thread_key).toBe('twilio:SMXXXXXXXXXXXXXXXX');
    expect(joined.rows[0].direction).toBe('inbound');
  });

  it('enforces uniqueness of (channel, external_thread_key)', async () => {
    const c = await pool.query(`INSERT INTO contact (display_name) VALUES ('Sender2') RETURNING id`);
    const contactId = c.rows[0].id as string;

    const endpoint = await pool.query(
      `INSERT INTO contact_endpoint (contact_id, endpoint_type, endpoint_value)
       VALUES ($1, 'phone', $2)
       RETURNING id`,
      [contactId, '+15550001111']
    );
    const endpointId = endpoint.rows[0].id as string;

    await pool.query(
      `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
       VALUES ($1, 'phone', 'twilio:thread-1')`,
      [endpointId]
    );

    await expect(
      pool.query(
        `INSERT INTO external_thread (endpoint_id, channel, external_thread_key)
         VALUES ($1, 'phone', 'twilio:thread-1')`,
        [endpointId]
      )
    ).rejects.toThrow(/external_thread/);
  });
});
