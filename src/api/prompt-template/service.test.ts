import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { createTestPool, truncateAllTables, ensureTestNamespace } from '../../../tests/helpers/db.ts';
import {
  createPromptTemplate,
  listPromptTemplates,
  getPromptTemplate,
  updatePromptTemplate,
  deletePromptTemplate,
  isValidChannelType,
} from './service.ts';

const TEST_EMAIL = 'test@example.com';
const TEST_NAMESPACE = 'default';

describe('prompt-template service', () => {
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
      expect(isValidChannelType('general')).toBe(true);
    });

    it('rejects invalid channel types', () => {
      expect(isValidChannelType('whatsapp')).toBe(false);
      expect(isValidChannelType('')).toBe(false);
      expect(isValidChannelType('SMS')).toBe(false);
    });
  });

  describe('createPromptTemplate', () => {
    it('creates a template with required fields', async () => {
      const result = await createPromptTemplate(pool, {
        label: 'SMS Triage',
        content: 'You are an SMS triage agent.',
        channel_type: 'sms',
        namespace: TEST_NAMESPACE,
      });

      expect(result.id).toBeDefined();
      expect(result.label).toBe('SMS Triage');
      expect(result.content).toBe('You are an SMS triage agent.');
      expect(result.channel_type).toBe('sms');
      expect(result.is_default).toBe(false);
      expect(result.is_active).toBe(true);
      expect(result.namespace).toBe(TEST_NAMESPACE);
    });

    it('trims label whitespace', async () => {
      const result = await createPromptTemplate(pool, {
        label: '  Padded Label  ',
        content: 'content',
        channel_type: 'email',
        namespace: TEST_NAMESPACE,
      });
      expect(result.label).toBe('Padded Label');
    });

    it('creates a default template', async () => {
      const result = await createPromptTemplate(pool, {
        label: 'Default SMS',
        content: 'default sms prompt',
        channel_type: 'sms',
        is_default: true,
        namespace: TEST_NAMESPACE,
      });
      expect(result.is_default).toBe(true);
    });

    it('unsets existing default when creating new default', async () => {
      const first = await createPromptTemplate(pool, {
        label: 'First Default',
        content: 'first',
        channel_type: 'sms',
        is_default: true,
        namespace: TEST_NAMESPACE,
      });
      expect(first.is_default).toBe(true);

      const second = await createPromptTemplate(pool, {
        label: 'Second Default',
        content: 'second',
        channel_type: 'sms',
        is_default: true,
        namespace: TEST_NAMESPACE,
      });
      expect(second.is_default).toBe(true);

      // First should no longer be default
      const firstRefresh = await getPromptTemplate(pool, first.id);
      expect(firstRefresh?.is_default).toBe(false);
    });

    it('does not unset default across different channel types', async () => {
      const smsDefault = await createPromptTemplate(pool, {
        label: 'SMS Default',
        content: 'sms',
        channel_type: 'sms',
        is_default: true,
        namespace: TEST_NAMESPACE,
      });

      await createPromptTemplate(pool, {
        label: 'Email Default',
        content: 'email',
        channel_type: 'email',
        is_default: true,
        namespace: TEST_NAMESPACE,
      });

      const smsRefresh = await getPromptTemplate(pool, smsDefault.id);
      expect(smsRefresh?.is_default).toBe(true);
    });
  });

  describe('listPromptTemplates', () => {
    it('returns empty list when no templates exist', async () => {
      const result = await listPromptTemplates(pool, {
        limit: 50,
        offset: 0,
      });
      expect(result.total).toBe(0);
      expect(result.items).toHaveLength(0);
    });

    it('returns templates with pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await createPromptTemplate(pool, {
          label: `Template ${i}`,
          content: `content ${i}`,
          channel_type: 'sms',
          namespace: TEST_NAMESPACE,
        });
      }

      const page1 = await listPromptTemplates(pool, { limit: 2, offset: 0 });
      expect(page1.total).toBe(5);
      expect(page1.items).toHaveLength(2);

      const page2 = await listPromptTemplates(pool, { limit: 2, offset: 2 });
      expect(page2.items).toHaveLength(2);

      const page3 = await listPromptTemplates(pool, { limit: 2, offset: 4 });
      expect(page3.items).toHaveLength(1);
    });

    it('filters by channel_type', async () => {
      await createPromptTemplate(pool, { label: 'SMS', content: 'sms', channel_type: 'sms', namespace: TEST_NAMESPACE });
      await createPromptTemplate(pool, { label: 'Email', content: 'email', channel_type: 'email', namespace: TEST_NAMESPACE });

      const result = await listPromptTemplates(pool, {
        limit: 50,
        offset: 0,
        channel_type: 'sms',
      });
      expect(result.total).toBe(1);
      expect(result.items[0].channel_type).toBe('sms');
    });

    it('filters by namespace', async () => {
      await createPromptTemplate(pool, { label: 'NS1', content: 'c', channel_type: 'sms', namespace: 'ns1' });
      await createPromptTemplate(pool, { label: 'NS2', content: 'c', channel_type: 'sms', namespace: 'ns2' });

      const result = await listPromptTemplates(pool, {
        limit: 50,
        offset: 0,
        queryNamespaces: ['ns1'],
      });
      expect(result.total).toBe(1);
      expect(result.items[0].label).toBe('NS1');
    });

    it('excludes inactive by default', async () => {
      const t = await createPromptTemplate(pool, { label: 'Active', content: 'c', channel_type: 'sms', namespace: TEST_NAMESPACE });
      await deletePromptTemplate(pool, t.id); // soft-delete

      const result = await listPromptTemplates(pool, { limit: 50, offset: 0 });
      expect(result.total).toBe(0);
    });

    it('includes inactive when requested', async () => {
      const t = await createPromptTemplate(pool, { label: 'Active', content: 'c', channel_type: 'sms', namespace: TEST_NAMESPACE });
      await deletePromptTemplate(pool, t.id);

      const result = await listPromptTemplates(pool, { limit: 50, offset: 0, include_inactive: true });
      expect(result.total).toBe(1);
    });

    it('searches by label and content', async () => {
      await createPromptTemplate(pool, { label: 'Triage SMS', content: 'generic', channel_type: 'sms', namespace: TEST_NAMESPACE });
      await createPromptTemplate(pool, { label: 'Other', content: 'triage logic here', channel_type: 'sms', namespace: TEST_NAMESPACE });
      await createPromptTemplate(pool, { label: 'Unrelated', content: 'nothing', channel_type: 'sms', namespace: TEST_NAMESPACE });

      const result = await listPromptTemplates(pool, {
        limit: 50,
        offset: 0,
        search: 'triage',
      });
      expect(result.total).toBe(2);
    });
  });

  describe('getPromptTemplate', () => {
    it('returns template by ID', async () => {
      const created = await createPromptTemplate(pool, {
        label: 'Test',
        content: 'content',
        channel_type: 'sms',
        namespace: TEST_NAMESPACE,
      });

      const found = await getPromptTemplate(pool, created.id);
      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.label).toBe('Test');
    });

    it('returns null for non-existent ID', async () => {
      const result = await getPromptTemplate(pool, '00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });

    it('returns null when queried with wrong namespace', async () => {
      const created = await createPromptTemplate(pool, {
        label: 'NS Scoped',
        content: 'content',
        channel_type: 'sms',
        namespace: 'ns-a',
      });

      const result = await getPromptTemplate(pool, created.id, ['ns-b']);
      expect(result).toBeNull();
    });

    it('returns template when queried with matching namespace', async () => {
      const created = await createPromptTemplate(pool, {
        label: 'NS Scoped',
        content: 'content',
        channel_type: 'sms',
        namespace: 'ns-a',
      });

      const result = await getPromptTemplate(pool, created.id, ['ns-a']);
      expect(result).toBeDefined();
      expect(result?.id).toBe(created.id);
    });
  });

  describe('updatePromptTemplate', () => {
    it('updates label', async () => {
      const created = await createPromptTemplate(pool, {
        label: 'Original',
        content: 'content',
        channel_type: 'sms',
        namespace: TEST_NAMESPACE,
      });

      const updated = await updatePromptTemplate(pool, created.id, { label: 'Updated' });
      expect(updated?.label).toBe('Updated');
      expect(updated?.content).toBe('content'); // unchanged
    });

    it('updates content', async () => {
      const created = await createPromptTemplate(pool, {
        label: 'Test',
        content: 'old content',
        channel_type: 'sms',
        namespace: TEST_NAMESPACE,
      });

      const updated = await updatePromptTemplate(pool, created.id, { content: 'new content' });
      expect(updated?.content).toBe('new content');
    });

    it('sets is_default and unsets existing default', async () => {
      const first = await createPromptTemplate(pool, {
        label: 'First',
        content: 'first',
        channel_type: 'sms',
        is_default: true,
        namespace: TEST_NAMESPACE,
      });

      const second = await createPromptTemplate(pool, {
        label: 'Second',
        content: 'second',
        channel_type: 'sms',
        namespace: TEST_NAMESPACE,
      });

      await updatePromptTemplate(pool, second.id, { is_default: true });

      const firstRefresh = await getPromptTemplate(pool, first.id);
      expect(firstRefresh?.is_default).toBe(false);

      const secondRefresh = await getPromptTemplate(pool, second.id);
      expect(secondRefresh?.is_default).toBe(true);
    });

    it('returns null for non-existent ID', async () => {
      const result = await updatePromptTemplate(pool, '00000000-0000-0000-0000-000000000000', { label: 'x' });
      expect(result).toBeNull();
    });

    it('returns null when no fields provided', async () => {
      const created = await createPromptTemplate(pool, {
        label: 'Test',
        content: 'content',
        channel_type: 'sms',
        namespace: TEST_NAMESPACE,
      });

      const result = await updatePromptTemplate(pool, created.id, {});
      expect(result).toBeNull();
    });

    it('returns null when queried with wrong namespace', async () => {
      const created = await createPromptTemplate(pool, {
        label: 'Original',
        content: 'content',
        channel_type: 'sms',
        namespace: 'ns-a',
      });

      const result = await updatePromptTemplate(pool, created.id, { label: 'Hacked' }, ['ns-b']);
      expect(result).toBeNull();

      // Verify original unchanged
      const original = await getPromptTemplate(pool, created.id);
      expect(original?.label).toBe('Original');
    });
  });

  describe('deletePromptTemplate', () => {
    it('soft-deletes by setting is_active to false', async () => {
      const created = await createPromptTemplate(pool, {
        label: 'To Delete',
        content: 'content',
        channel_type: 'sms',
        namespace: TEST_NAMESPACE,
      });

      const deleted = await deletePromptTemplate(pool, created.id);
      expect(deleted).toBe(true);

      const found = await getPromptTemplate(pool, created.id);
      expect(found?.is_active).toBe(false);
    });

    it('returns false for non-existent ID', async () => {
      const result = await deletePromptTemplate(pool, '00000000-0000-0000-0000-000000000000');
      expect(result).toBe(false);
    });

    it('returns false for already-deleted template', async () => {
      const created = await createPromptTemplate(pool, {
        label: 'To Delete',
        content: 'content',
        channel_type: 'sms',
        namespace: TEST_NAMESPACE,
      });

      await deletePromptTemplate(pool, created.id);
      const secondDelete = await deletePromptTemplate(pool, created.id);
      expect(secondDelete).toBe(false);
    });

    it('returns false when queried with wrong namespace', async () => {
      const created = await createPromptTemplate(pool, {
        label: 'To Delete',
        content: 'content',
        channel_type: 'sms',
        namespace: 'ns-a',
      });

      const result = await deletePromptTemplate(pool, created.id, ['ns-b']);
      expect(result).toBe(false);

      // Verify still active
      const original = await getPromptTemplate(pool, created.id);
      expect(original?.is_active).toBe(true);
    });
  });
});
