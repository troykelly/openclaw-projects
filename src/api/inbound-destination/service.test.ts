import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { createTestPool, truncateAllTables, ensureTestNamespace } from '../../../tests/helpers/db.ts';
import {
  upsertInboundDestination,
  listInboundDestinations,
  getInboundDestination,
  updateInboundDestination,
  deleteInboundDestination,
} from './service.ts';

const TEST_EMAIL = 'test@example.com';
const TEST_NAMESPACE = 'default';

describe('inbound-destination service', () => {
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

  describe('upsertInboundDestination', () => {
    it('creates a destination on first upsert', async () => {
      const result = await upsertInboundDestination(pool, {
        address: '+61400000001',
        channelType: 'sms',
        displayName: '+61 400 000 001',
        namespace: TEST_NAMESPACE,
      });

      expect(result).toBeDefined();
      expect(result!.id).toBeDefined();
      expect(result!.address).toBe('+61400000001');
      expect(result!.channel_type).toBe('sms');
      expect(result!.display_name).toBe('+61 400 000 001');
      expect(result!.is_active).toBe(true);
      expect(result!.agent_id).toBeNull();
      expect(result!.prompt_template_id).toBeNull();
      expect(result!.context_id).toBeNull();
    });

    it('returns null on duplicate upsert (ON CONFLICT DO NOTHING)', async () => {
      await upsertInboundDestination(pool, {
        address: '+61400000001',
        channelType: 'sms',
        namespace: TEST_NAMESPACE,
      });

      const second = await upsertInboundDestination(pool, {
        address: '+61400000001',
        channelType: 'sms',
        displayName: 'Updated Name',
        namespace: TEST_NAMESPACE,
      });

      expect(second).toBeNull();
    });

    it('allows same address with different channel type', async () => {
      const sms = await upsertInboundDestination(pool, {
        address: 'test@example.com',
        channelType: 'sms',
        namespace: TEST_NAMESPACE,
      });
      const email = await upsertInboundDestination(pool, {
        address: 'test@example.com',
        channelType: 'email',
        namespace: TEST_NAMESPACE,
      });

      expect(sms).toBeDefined();
      expect(email).toBeDefined();
      expect(sms!.id).not.toBe(email!.id);
    });

    it('lowercases email addresses', async () => {
      const result = await upsertInboundDestination(pool, {
        address: 'User@Example.COM',
        channelType: 'email',
        namespace: TEST_NAMESPACE,
      });

      expect(result!.address).toBe('user@example.com');
    });

    it('trims whitespace from addresses', async () => {
      const result = await upsertInboundDestination(pool, {
        address: '  +61400000001  ',
        channelType: 'sms',
        namespace: TEST_NAMESPACE,
      });

      expect(result!.address).toBe('+61400000001');
    });

    it('defaults namespace to "default"', async () => {
      const result = await upsertInboundDestination(pool, {
        address: '+61400000002',
        channelType: 'sms',
      });

      expect(result!.namespace).toBe('default');
    });
  });

  describe('listInboundDestinations', () => {
    it('returns empty list when no destinations exist', async () => {
      const result = await listInboundDestinations(pool, {
        limit: 50,
        offset: 0,
      });
      expect(result.total).toBe(0);
      expect(result.items).toHaveLength(0);
    });

    it('returns destinations with pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await upsertInboundDestination(pool, {
          address: `+6140000000${i}`,
          channelType: 'sms',
          namespace: TEST_NAMESPACE,
        });
      }

      const page1 = await listInboundDestinations(pool, { limit: 2, offset: 0 });
      expect(page1.total).toBe(5);
      expect(page1.items).toHaveLength(2);

      const page2 = await listInboundDestinations(pool, { limit: 2, offset: 4 });
      expect(page2.items).toHaveLength(1);
    });

    it('filters by channel_type', async () => {
      await upsertInboundDestination(pool, { address: '+61400000001', channelType: 'sms', namespace: TEST_NAMESPACE });
      await upsertInboundDestination(pool, { address: 'test@example.com', channelType: 'email', namespace: TEST_NAMESPACE });

      const result = await listInboundDestinations(pool, {
        limit: 50,
        offset: 0,
        channel_type: 'sms',
      });
      expect(result.total).toBe(1);
      expect(result.items[0].channel_type).toBe('sms');
    });

    it('filters by namespace', async () => {
      await upsertInboundDestination(pool, { address: '+61400000001', channelType: 'sms', namespace: 'ns1' });
      await upsertInboundDestination(pool, { address: '+61400000002', channelType: 'sms', namespace: 'ns2' });

      const result = await listInboundDestinations(pool, {
        limit: 50,
        offset: 0,
        queryNamespaces: ['ns1'],
      });
      expect(result.total).toBe(1);
      expect(result.items[0].address).toBe('+61400000001');
    });

    it('excludes inactive by default', async () => {
      const d = await upsertInboundDestination(pool, { address: '+61400000001', channelType: 'sms', namespace: TEST_NAMESPACE });
      await deleteInboundDestination(pool, d!.id);

      const result = await listInboundDestinations(pool, { limit: 50, offset: 0 });
      expect(result.total).toBe(0);
    });

    it('includes inactive when requested', async () => {
      const d = await upsertInboundDestination(pool, { address: '+61400000001', channelType: 'sms', namespace: TEST_NAMESPACE });
      await deleteInboundDestination(pool, d!.id);

      const result = await listInboundDestinations(pool, { limit: 50, offset: 0, include_inactive: true });
      expect(result.total).toBe(1);
    });

    it('searches by address and display_name', async () => {
      await upsertInboundDestination(pool, { address: 'hello@example.com', channelType: 'email', displayName: 'Hello World', namespace: TEST_NAMESPACE });
      await upsertInboundDestination(pool, { address: 'other@test.com', channelType: 'email', displayName: 'Other', namespace: TEST_NAMESPACE });

      const result = await listInboundDestinations(pool, {
        limit: 50,
        offset: 0,
        search: 'hello',
      });
      expect(result.total).toBe(1);
    });
  });

  describe('getInboundDestination', () => {
    it('returns destination by ID', async () => {
      const created = await upsertInboundDestination(pool, {
        address: '+61400000001',
        channelType: 'sms',
        namespace: TEST_NAMESPACE,
      });

      const found = await getInboundDestination(pool, created!.id);
      expect(found).toBeDefined();
      expect(found?.id).toBe(created!.id);
    });

    it('returns null for non-existent ID', async () => {
      const result = await getInboundDestination(pool, '00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });

    it('returns null when queried with wrong namespace', async () => {
      const created = await upsertInboundDestination(pool, {
        address: '+61400000001',
        channelType: 'sms',
        namespace: 'ns-a',
      });

      const result = await getInboundDestination(pool, created!.id, ['ns-b']);
      expect(result).toBeNull();
    });

    it('returns destination when queried with matching namespace', async () => {
      const created = await upsertInboundDestination(pool, {
        address: '+61400000001',
        channelType: 'sms',
        namespace: 'ns-a',
      });

      const result = await getInboundDestination(pool, created!.id, ['ns-a']);
      expect(result).toBeDefined();
      expect(result?.id).toBe(created!.id);
    });
  });

  describe('updateInboundDestination', () => {
    it('updates display_name', async () => {
      const created = await upsertInboundDestination(pool, {
        address: '+61400000001',
        channelType: 'sms',
        namespace: TEST_NAMESPACE,
      });

      const updated = await updateInboundDestination(pool, created!.id, {
        display_name: 'My Phone',
      });
      expect(updated?.display_name).toBe('My Phone');
    });

    it('sets agent_id', async () => {
      const created = await upsertInboundDestination(pool, {
        address: '+61400000001',
        channelType: 'sms',
        namespace: TEST_NAMESPACE,
      });

      const updated = await updateInboundDestination(pool, created!.id, {
        agent_id: 'agent-123',
      });
      expect(updated?.agent_id).toBe('agent-123');
    });

    it('clears agent_id with null', async () => {
      const created = await upsertInboundDestination(pool, {
        address: '+61400000001',
        channelType: 'sms',
        namespace: TEST_NAMESPACE,
      });

      await updateInboundDestination(pool, created!.id, { agent_id: 'agent-123' });
      const cleared = await updateInboundDestination(pool, created!.id, { agent_id: null });
      expect(cleared?.agent_id).toBeNull();
    });

    it('returns null for non-existent ID', async () => {
      const result = await updateInboundDestination(pool, '00000000-0000-0000-0000-000000000000', { display_name: 'x' });
      expect(result).toBeNull();
    });

    it('returns null when no fields provided', async () => {
      const created = await upsertInboundDestination(pool, {
        address: '+61400000001',
        channelType: 'sms',
        namespace: TEST_NAMESPACE,
      });

      const result = await updateInboundDestination(pool, created!.id, {});
      expect(result).toBeNull();
    });

    it('returns null when queried with wrong namespace', async () => {
      const created = await upsertInboundDestination(pool, {
        address: '+61400000001',
        channelType: 'sms',
        namespace: 'ns-a',
      });

      const result = await updateInboundDestination(pool, created!.id, { display_name: 'Hacked' }, ['ns-b']);
      expect(result).toBeNull();
    });
  });

  describe('deleteInboundDestination', () => {
    it('soft-deletes by setting is_active to false', async () => {
      const created = await upsertInboundDestination(pool, {
        address: '+61400000001',
        channelType: 'sms',
        namespace: TEST_NAMESPACE,
      });

      const deleted = await deleteInboundDestination(pool, created!.id);
      expect(deleted).toBe(true);

      const found = await getInboundDestination(pool, created!.id);
      expect(found?.is_active).toBe(false);
    });

    it('returns false for non-existent ID', async () => {
      const result = await deleteInboundDestination(pool, '00000000-0000-0000-0000-000000000000');
      expect(result).toBe(false);
    });

    it('returns false for already-deleted destination', async () => {
      const created = await upsertInboundDestination(pool, {
        address: '+61400000001',
        channelType: 'sms',
        namespace: TEST_NAMESPACE,
      });

      await deleteInboundDestination(pool, created!.id);
      const secondDelete = await deleteInboundDestination(pool, created!.id);
      expect(secondDelete).toBe(false);
    });

    it('returns false when queried with wrong namespace', async () => {
      const created = await upsertInboundDestination(pool, {
        address: '+61400000001',
        channelType: 'sms',
        namespace: 'ns-a',
      });

      const result = await deleteInboundDestination(pool, created!.id, ['ns-b']);
      expect(result).toBe(false);
    });
  });
});
