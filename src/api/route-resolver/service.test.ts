import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { createTestPool, truncateAllTables, ensureTestNamespace } from '../../../tests/helpers/db.ts';
import { resolveRoute } from './service.ts';
import { setChannelDefault } from '../channel-default/service.ts';
import { createPromptTemplate } from '../prompt-template/service.ts';

const TEST_EMAIL = 'test@example.com';
const TEST_NAMESPACE = 'default';

describe('route-resolver service', () => {
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

  describe('resolveRoute', () => {
    it('returns null when no destination or default exists', async () => {
      const result = await resolveRoute(pool, '+15551234567', 'sms', TEST_NAMESPACE);
      expect(result).toBeNull();
    });

    it('resolves via channel_default when no destination exists', async () => {
      await setChannelDefault(pool, {
        namespace: TEST_NAMESPACE,
        channel_type: 'sms',
        agent_id: 'agent-sms-default',
      });

      const result = await resolveRoute(pool, '+15551234567', 'sms', TEST_NAMESPACE);
      expect(result).not.toBeNull();
      expect(result!.agentId).toBe('agent-sms-default');
      expect(result!.source).toBe('channel_default');
      expect(result!.promptContent).toBeNull();
    });

    it('resolves via channel_default with prompt template', async () => {
      const pt = await createPromptTemplate(pool, {
        label: 'SMS Default',
        content: 'You are an SMS triage agent.',
        channel_type: 'sms',
        namespace: TEST_NAMESPACE,
      });

      await setChannelDefault(pool, {
        namespace: TEST_NAMESPACE,
        channel_type: 'sms',
        agent_id: 'agent-sms-default',
        prompt_template_id: pt.id,
      });

      const result = await resolveRoute(pool, '+15551234567', 'sms', TEST_NAMESPACE);
      expect(result).not.toBeNull();
      expect(result!.agentId).toBe('agent-sms-default');
      expect(result!.promptContent).toBe('You are an SMS triage agent.');
      expect(result!.source).toBe('channel_default');
    });

    it('resolves via destination_override when destination has agent_id', async () => {
      // Create destination with agent override
      await pool.query(
        `INSERT INTO inbound_destination (address, channel_type, agent_id, namespace)
         VALUES ($1, $2, $3, $4)`,
        ['+15551234567', 'sms', 'agent-override', TEST_NAMESPACE],
      );

      // Also set a channel default (should be ignored)
      await setChannelDefault(pool, {
        namespace: TEST_NAMESPACE,
        channel_type: 'sms',
        agent_id: 'agent-sms-default',
      });

      const result = await resolveRoute(pool, '+15551234567', 'sms', TEST_NAMESPACE);
      expect(result).not.toBeNull();
      expect(result!.agentId).toBe('agent-override');
      expect(result!.source).toBe('destination_override');
    });

    it('falls through to channel_default when destination has no agent_id', async () => {
      // Create destination without agent override
      await pool.query(
        `INSERT INTO inbound_destination (address, channel_type, namespace)
         VALUES ($1, $2, $3)`,
        ['+15551234567', 'sms', TEST_NAMESPACE],
      );

      // Set channel default
      await setChannelDefault(pool, {
        namespace: TEST_NAMESPACE,
        channel_type: 'sms',
        agent_id: 'agent-sms-default',
      });

      const result = await resolveRoute(pool, '+15551234567', 'sms', TEST_NAMESPACE);
      expect(result).not.toBeNull();
      expect(result!.agentId).toBe('agent-sms-default');
      expect(result!.source).toBe('channel_default');
    });

    it('returns null when destination has no agent and no channel default', async () => {
      // Create destination without agent override
      await pool.query(
        `INSERT INTO inbound_destination (address, channel_type, namespace)
         VALUES ($1, $2, $3)`,
        ['+15551234567', 'sms', TEST_NAMESPACE],
      );

      const result = await resolveRoute(pool, '+15551234567', 'sms', TEST_NAMESPACE);
      expect(result).toBeNull();
    });

    it('destination_override includes prompt content from linked template', async () => {
      const pt = await createPromptTemplate(pool, {
        label: 'Override Prompt',
        content: 'You are the override handler.',
        channel_type: 'sms',
        namespace: TEST_NAMESPACE,
      });

      await pool.query(
        `INSERT INTO inbound_destination (address, channel_type, agent_id, prompt_template_id, namespace)
         VALUES ($1, $2, $3, $4, $5)`,
        ['+15551234567', 'sms', 'agent-override', pt.id, TEST_NAMESPACE],
      );

      const result = await resolveRoute(pool, '+15551234567', 'sms', TEST_NAMESPACE);
      expect(result).not.toBeNull();
      expect(result!.promptContent).toBe('You are the override handler.');
      expect(result!.source).toBe('destination_override');
    });

    it('returns null prompt content when template is inactive', async () => {
      const pt = await createPromptTemplate(pool, {
        label: 'Inactive Prompt',
        content: 'Should not be returned.',
        channel_type: 'sms',
        namespace: TEST_NAMESPACE,
      });

      // Deactivate the template
      await pool.query(`UPDATE prompt_template SET is_active = false WHERE id = $1`, [pt.id]);

      await setChannelDefault(pool, {
        namespace: TEST_NAMESPACE,
        channel_type: 'sms',
        agent_id: 'agent-sms',
        prompt_template_id: pt.id,
      });

      const result = await resolveRoute(pool, '+15551234567', 'sms', TEST_NAMESPACE);
      expect(result).not.toBeNull();
      expect(result!.agentId).toBe('agent-sms');
      expect(result!.promptContent).toBeNull();
    });

    it('skips inactive destinations', async () => {
      await pool.query(
        `INSERT INTO inbound_destination (address, channel_type, agent_id, namespace, is_active)
         VALUES ($1, $2, $3, $4, false)`,
        ['+15551234567', 'sms', 'agent-inactive', TEST_NAMESPACE],
      );

      await setChannelDefault(pool, {
        namespace: TEST_NAMESPACE,
        channel_type: 'sms',
        agent_id: 'agent-sms-default',
      });

      const result = await resolveRoute(pool, '+15551234567', 'sms', TEST_NAMESPACE);
      expect(result).not.toBeNull();
      expect(result!.agentId).toBe('agent-sms-default');
      expect(result!.source).toBe('channel_default');
    });

    it('resolves email channel type', async () => {
      await setChannelDefault(pool, {
        namespace: TEST_NAMESPACE,
        channel_type: 'email',
        agent_id: 'agent-email-default',
      });

      const result = await resolveRoute(pool, 'inbox@example.com', 'email', TEST_NAMESPACE);
      expect(result).not.toBeNull();
      expect(result!.agentId).toBe('agent-email-default');
    });

    it('resolves ha_observation channel type', async () => {
      await setChannelDefault(pool, {
        namespace: TEST_NAMESPACE,
        channel_type: 'ha_observation',
        agent_id: 'agent-ha-default',
      });

      const result = await resolveRoute(pool, 'sensor.temperature_kitchen', 'ha_observation', TEST_NAMESPACE);
      expect(result).not.toBeNull();
      expect(result!.agentId).toBe('agent-ha-default');
    });

    it('includes context_id from destination override', async () => {
      // Create a real context row (FK constraint)
      const ctxResult = await pool.query(
        `INSERT INTO context (label, content) VALUES ('Test Context', 'Some context') RETURNING id::text as id`,
      );
      const contextId = (ctxResult.rows[0] as { id: string }).id;

      await pool.query(
        `INSERT INTO inbound_destination (address, channel_type, agent_id, context_id, namespace)
         VALUES ($1, $2, $3, $4::uuid, $5)`,
        ['+15551234567', 'sms', 'agent-override', contextId, TEST_NAMESPACE],
      );

      const result = await resolveRoute(pool, '+15551234567', 'sms', TEST_NAMESPACE);
      expect(result).not.toBeNull();
      expect(result!.contextId).toBe(contextId);
    });

    it('includes context_id from channel default', async () => {
      const ctxResult = await pool.query(
        `INSERT INTO context (label, content) VALUES ('Test Context 2', 'More context') RETURNING id::text as id`,
      );
      const contextId = (ctxResult.rows[0] as { id: string }).id;

      await setChannelDefault(pool, {
        namespace: TEST_NAMESPACE,
        channel_type: 'sms',
        agent_id: 'agent-sms',
        context_id: contextId,
      });

      const result = await resolveRoute(pool, '+15551234567', 'sms', TEST_NAMESPACE);
      expect(result).not.toBeNull();
      expect(result!.contextId).toBe(contextId);
    });
  });
});
