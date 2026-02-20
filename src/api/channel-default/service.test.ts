import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { createTestPool, truncateAllTables, ensureTestNamespace } from '../../../tests/helpers/db.ts';
import {
  listChannelDefaults,
  getChannelDefault,
  setChannelDefault,
  deleteChannelDefault,
  bootstrapChannelDefaults,
  isValidChannelType,
} from './service.ts';

const TEST_EMAIL = 'test@example.com';
const TEST_NAMESPACE = 'default';

describe('channel-default service', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    await ensureTestNamespace(pool, TEST_EMAIL, TEST_NAMESPACE);
  });

  describe('isValidChannelType', () => {
    it('accepts valid channel types', () => {
      expect(isValidChannelType('sms')).toBe(true);
      expect(isValidChannelType('email')).toBe(true);
      expect(isValidChannelType('ha_observation')).toBe(true);
    });

    it('rejects invalid channel types', () => {
      expect(isValidChannelType('general')).toBe(false);
      expect(isValidChannelType('whatsapp')).toBe(false);
      expect(isValidChannelType('')).toBe(false);
    });
  });

  describe('setChannelDefault', () => {
    it('creates a channel default', async () => {
      const result = await setChannelDefault(pool, {
        namespace: TEST_NAMESPACE,
        channel_type: 'sms',
        agent_id: 'agent-sms-1',
      });

      expect(result.id).toBeDefined();
      expect(result.channel_type).toBe('sms');
      expect(result.agent_id).toBe('agent-sms-1');
      expect(result.prompt_template_id).toBeNull();
      expect(result.context_id).toBeNull();
    });

    it('upserts on conflict (updates existing)', async () => {
      await setChannelDefault(pool, {
        namespace: TEST_NAMESPACE,
        channel_type: 'sms',
        agent_id: 'agent-1',
      });

      const updated = await setChannelDefault(pool, {
        namespace: TEST_NAMESPACE,
        channel_type: 'sms',
        agent_id: 'agent-2',
      });

      expect(updated.agent_id).toBe('agent-2');

      // Verify only one row
      const list = await listChannelDefaults(pool);
      expect(list).toHaveLength(1);
    });

    it('allows different channel types', async () => {
      await setChannelDefault(pool, { namespace: TEST_NAMESPACE, channel_type: 'sms', agent_id: 'a1' });
      await setChannelDefault(pool, { namespace: TEST_NAMESPACE, channel_type: 'email', agent_id: 'a2' });

      const list = await listChannelDefaults(pool);
      expect(list).toHaveLength(2);
    });
  });

  describe('listChannelDefaults', () => {
    it('returns empty list when no defaults exist', async () => {
      const result = await listChannelDefaults(pool);
      expect(result).toHaveLength(0);
    });

    it('returns all defaults', async () => {
      await setChannelDefault(pool, { namespace: TEST_NAMESPACE, channel_type: 'sms', agent_id: 'a1' });
      await setChannelDefault(pool, { namespace: TEST_NAMESPACE, channel_type: 'email', agent_id: 'a2' });

      const result = await listChannelDefaults(pool);
      expect(result).toHaveLength(2);
    });

    it('filters by namespace', async () => {
      await setChannelDefault(pool, { namespace: 'ns1', channel_type: 'sms', agent_id: 'a1' });
      await setChannelDefault(pool, { namespace: 'ns2', channel_type: 'sms', agent_id: 'a2' });

      const result = await listChannelDefaults(pool, ['ns1']);
      expect(result).toHaveLength(1);
      expect(result[0].agent_id).toBe('a1');
    });
  });

  describe('getChannelDefault', () => {
    it('returns default for channel type', async () => {
      await setChannelDefault(pool, { namespace: TEST_NAMESPACE, channel_type: 'sms', agent_id: 'a1' });

      const result = await getChannelDefault(pool, 'sms');
      expect(result).toBeDefined();
      expect(result?.agent_id).toBe('a1');
    });

    it('returns null when no default exists', async () => {
      const result = await getChannelDefault(pool, 'sms');
      expect(result).toBeNull();
    });

    it('returns null when queried with wrong namespace', async () => {
      await setChannelDefault(pool, { namespace: 'ns-a', channel_type: 'sms', agent_id: 'a1' });

      const result = await getChannelDefault(pool, 'sms', ['ns-b']);
      expect(result).toBeNull();
    });
  });

  describe('deleteChannelDefault', () => {
    it('deletes an existing default', async () => {
      await setChannelDefault(pool, { namespace: TEST_NAMESPACE, channel_type: 'sms', agent_id: 'a1' });

      const deleted = await deleteChannelDefault(pool, 'sms', TEST_NAMESPACE);
      expect(deleted).toBe(true);

      const result = await getChannelDefault(pool, 'sms');
      expect(result).toBeNull();
    });

    it('returns false when no default exists', async () => {
      const deleted = await deleteChannelDefault(pool, 'sms', TEST_NAMESPACE);
      expect(deleted).toBe(false);
    });
  });

  describe('bootstrapChannelDefaults', () => {
    beforeEach(() => {
      // Clear env vars
      delete process.env.INBOUND_DEFAULT_AGENT_SMS;
      delete process.env.INBOUND_DEFAULT_AGENT_EMAIL;
      delete process.env.INBOUND_DEFAULT_AGENT_HA;
      delete process.env.INBOUND_DEFAULT_PROMPT_SMS;
      delete process.env.INBOUND_DEFAULT_PROMPT_EMAIL;
      delete process.env.INBOUND_DEFAULT_PROMPT_HA;
    });

    it('bootstraps from env vars when no rows exist', async () => {
      process.env.INBOUND_DEFAULT_AGENT_SMS = 'agent-sms';

      const result = await bootstrapChannelDefaults(pool, TEST_NAMESPACE);
      expect(result.bootstrapped).toContain('sms');

      const smsDefault = await getChannelDefault(pool, 'sms');
      expect(smsDefault?.agent_id).toBe('agent-sms');
    });

    it('does not overwrite existing rows', async () => {
      await setChannelDefault(pool, {
        namespace: TEST_NAMESPACE,
        channel_type: 'sms',
        agent_id: 'existing-agent',
      });

      process.env.INBOUND_DEFAULT_AGENT_SMS = 'new-agent';

      const result = await bootstrapChannelDefaults(pool, TEST_NAMESPACE);
      expect(result.bootstrapped).not.toContain('sms');

      const smsDefault = await getChannelDefault(pool, 'sms');
      expect(smsDefault?.agent_id).toBe('existing-agent');
    });

    it('creates prompt template when env var provided', async () => {
      process.env.INBOUND_DEFAULT_AGENT_EMAIL = 'agent-email';
      process.env.INBOUND_DEFAULT_PROMPT_EMAIL = 'You are an email triage agent.';

      const result = await bootstrapChannelDefaults(pool, TEST_NAMESPACE);
      expect(result.bootstrapped).toContain('email');

      const emailDefault = await getChannelDefault(pool, 'email');
      expect(emailDefault?.prompt_template_id).toBeDefined();
      expect(emailDefault?.prompt_template_id).not.toBeNull();
    });

    it('skips channel types without env vars', async () => {
      const result = await bootstrapChannelDefaults(pool, TEST_NAMESPACE);
      expect(result.bootstrapped).toHaveLength(0);
    });

    it('bootstraps multiple channel types', async () => {
      process.env.INBOUND_DEFAULT_AGENT_SMS = 'agent-sms';
      process.env.INBOUND_DEFAULT_AGENT_EMAIL = 'agent-email';
      process.env.INBOUND_DEFAULT_AGENT_HA = 'agent-ha';

      const result = await bootstrapChannelDefaults(pool, TEST_NAMESPACE);
      expect(result.bootstrapped).toHaveLength(3);
      expect(result.bootstrapped).toContain('sms');
      expect(result.bootstrapped).toContain('email');
      expect(result.bootstrapped).toContain('ha_observation');
    });
  });
});
