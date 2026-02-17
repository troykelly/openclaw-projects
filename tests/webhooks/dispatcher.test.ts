import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Pool } from 'pg';
import { runMigrate } from '../helpers/migrate.ts';
import { createTestPool, truncateAllTables } from '../helpers/db.ts';
import { enqueueWebhook, getPendingWebhooks, getWebhookOutbox, retryWebhook, dispatchWebhook } from '../../src/api/webhooks/dispatcher.ts';
import { clearConfigCache } from '../../src/api/webhooks/config.ts';
import type { WebhookOutboxEntry } from '../../src/api/webhooks/types.ts';

describe('Webhook Dispatcher', () => {
  let pool: Pool;
  const originalEnv = process.env;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    clearConfigCache();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    clearConfigCache();
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('enqueueWebhook', () => {
    it('creates a webhook entry', async () => {
      const id = await enqueueWebhook(pool, 'sms_received', '/hooks/agent', {
        message: 'Test message',
        context: { foo: 'bar' },
      });

      expect(id).toBeDefined();
      expect(id).toMatch(/^[0-9a-f-]{36}$/i);

      // Verify it was created
      const result = await pool.query('SELECT * FROM webhook_outbox WHERE id = $1', [id]);
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].kind).toBe('sms_received');
      expect(result.rows[0].destination).toBe('/hooks/agent');
    });

    it('handles idempotency key', async () => {
      const id1 = await enqueueWebhook(pool, 'reminder_due', '/hooks/agent', { message: 'First' }, { idempotency_key: 'unique-key-123' });

      const id2 = await enqueueWebhook(pool, 'reminder_due', '/hooks/agent', { message: 'Second' }, { idempotency_key: 'unique-key-123' });

      expect(id1).toBe(id2);

      // Only one entry should exist
      const count = await pool.query("SELECT COUNT(*) FROM webhook_outbox WHERE idempotency_key = 'unique-key-123'");
      expect(parseInt((count.rows[0] as { count: string }).count, 10)).toBe(1);
    });

    it('allows custom headers', async () => {
      const id = await enqueueWebhook(pool, 'test', '/hooks/test', { data: 'test' }, { headers: { 'X-Custom-Header': 'value' } });

      const result = await pool.query('SELECT headers FROM webhook_outbox WHERE id = $1', [id]);
      expect(result.rows[0].headers).toEqual({ 'X-Custom-Header': 'value' });
    });

    it('allows scheduled run_at', async () => {
      const futureDate = new Date(Date.now() + 3600000); // 1 hour from now
      const id = await enqueueWebhook(pool, 'test', '/hooks/test', { data: 'test' }, { runAt: futureDate });

      const result = await pool.query('SELECT run_at FROM webhook_outbox WHERE id = $1', [id]);
      const runAt = new Date(result.rows[0].run_at);
      expect(Math.abs(runAt.getTime() - futureDate.getTime())).toBeLessThan(1000);
    });
  });

  describe('getPendingWebhooks', () => {
    it('returns pending webhooks', async () => {
      await enqueueWebhook(pool, 'test1', '/hooks/test', { n: 1 });
      await enqueueWebhook(pool, 'test2', '/hooks/test', { n: 2 });

      const pending = await getPendingWebhooks(pool);

      expect(pending.length).toBe(2);
      expect(pending[0].kind).toBe('test1');
      expect(pending[1].kind).toBe('test2');
    });

    it('excludes dispatched webhooks', async () => {
      const id = await enqueueWebhook(pool, 'test', '/hooks/test', { n: 1 });

      // Mark as dispatched
      await pool.query('UPDATE webhook_outbox SET dispatched_at = NOW() WHERE id = $1', [id]);

      const pending = await getPendingWebhooks(pool);

      expect(pending.length).toBe(0);
    });

    it('excludes webhooks scheduled for the future', async () => {
      const futureDate = new Date(Date.now() + 3600000);
      await enqueueWebhook(pool, 'test', '/hooks/test', { n: 1 }, { runAt: futureDate });

      const pending = await getPendingWebhooks(pool);

      expect(pending.length).toBe(0);
    });

    it('excludes webhooks that exceeded max retries', async () => {
      const id = await enqueueWebhook(pool, 'test', '/hooks/test', { n: 1 });

      // Set attempts to max
      await pool.query('UPDATE webhook_outbox SET attempts = 5 WHERE id = $1', [id]);

      const pending = await getPendingWebhooks(pool);

      expect(pending.length).toBe(0);
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await enqueueWebhook(pool, `test${i}`, '/hooks/test', { n: i });
      }

      const pending = await getPendingWebhooks(pool, 3);

      expect(pending.length).toBe(3);
    });
  });

  describe('getWebhookOutbox', () => {
    it('returns all webhooks by default', async () => {
      await enqueueWebhook(pool, 'test1', '/hooks/test', {});
      await enqueueWebhook(pool, 'test2', '/hooks/test', {});

      const result = await getWebhookOutbox(pool);

      expect(result.entries.length).toBe(2);
      expect(result.total).toBe(2);
    });

    it('filters by status=pending', async () => {
      const id1 = await enqueueWebhook(pool, 'pending', '/hooks/test', {});
      const id2 = await enqueueWebhook(pool, 'dispatched', '/hooks/test', {});

      await pool.query('UPDATE webhook_outbox SET dispatched_at = NOW() WHERE id = $1', [id2]);

      const result = await getWebhookOutbox(pool, { status: 'pending' });

      expect(result.entries.length).toBe(1);
      expect(result.entries[0].kind).toBe('pending');
    });

    it('filters by status=dispatched', async () => {
      await enqueueWebhook(pool, 'pending', '/hooks/test', {});
      const id2 = await enqueueWebhook(pool, 'dispatched', '/hooks/test', {});

      await pool.query('UPDATE webhook_outbox SET dispatched_at = NOW() WHERE id = $1', [id2]);

      const result = await getWebhookOutbox(pool, { status: 'dispatched' });

      expect(result.entries.length).toBe(1);
      expect(result.entries[0].kind).toBe('dispatched');
    });

    it('filters by kind', async () => {
      await enqueueWebhook(pool, 'sms_received', '/hooks/agent', {});
      await enqueueWebhook(pool, 'email_received', '/hooks/agent', {});

      const result = await getWebhookOutbox(pool, { kind: 'sms_received' });

      expect(result.entries.length).toBe(1);
      expect(result.entries[0].kind).toBe('sms_received');
    });
  });

  describe('retryWebhook', () => {
    it('resets a failed webhook for retry', async () => {
      const id = await enqueueWebhook(pool, 'test', '/hooks/test', {});

      // Mark as failed
      await pool.query(
        `UPDATE webhook_outbox
         SET attempts = 5, last_error = 'Previous error', run_at = NOW() + INTERVAL '1 hour'
         WHERE id = $1`,
        [id],
      );

      const success = await retryWebhook(pool, id);

      expect(success).toBe(true);

      // Verify it was reset
      const result = await pool.query('SELECT attempts, last_error, run_at FROM webhook_outbox WHERE id = $1', [id]);
      expect(result.rows[0].attempts).toBe(0);
      expect(result.rows[0].last_error).toBeNull();
      expect(new Date(result.rows[0].run_at).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('returns false for already dispatched webhook', async () => {
      const id = await enqueueWebhook(pool, 'test', '/hooks/test', {});

      await pool.query('UPDATE webhook_outbox SET dispatched_at = NOW() WHERE id = $1', [id]);

      const success = await retryWebhook(pool, id);

      expect(success).toBe(false);
    });

    it('returns false for non-existent webhook', async () => {
      const success = await retryWebhook(pool, '00000000-0000-0000-0000-000000000000');

      expect(success).toBe(false);
    });
  });

  describe('dispatchWebhook', () => {
    it('returns error when OpenClaw not configured', async () => {
      delete process.env.OPENCLAW_GATEWAY_URL;
      delete process.env.OPENCLAW_API_TOKEN;

      const entry: WebhookOutboxEntry = {
        id: 'test-id',
        kind: 'test',
        destination: '/hooks/test',
        runAt: new Date(),
        headers: {},
        body: { test: true },
        attempts: 0,
        lastError: null,
        lockedAt: null,
        lockedBy: null,
        dispatchedAt: null,
        idempotency_key: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const result = await dispatchWebhook(entry);

      expect(result.success).toBe(false);
      expect(result.error).toBe('OpenClaw not configured');
    });

    // Note: Testing actual HTTP dispatch would require mocking fetch
    // or running a mock server. These tests focus on the non-HTTP logic.
  });
});
