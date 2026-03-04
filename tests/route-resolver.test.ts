/**
 * Tests for route resolver service (Issues #2086, #2092).
 *
 * Verifies that resolveRoute() correctly falls back to channel_default
 * in the 'default' namespace when namespace is undefined (unauthenticated
 * webhooks like Cloudflare email), and that lookups are deterministic
 * when multiple namespaces contain channel defaults for the same type.
 */
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPool, truncateAllTables, ensureTestNamespace } from './helpers/db.ts';
import { runMigrate } from './helpers/migrate.ts';
import { resolveRoute } from '../src/api/route-resolver/service.ts';
import { getChannelDefault } from '../src/api/channel-default/service.ts';

describe('resolveRoute (Issue #2086)', () => {
  let pool: Pool;

  beforeAll(async () => {
    await runMigrate('up');
    pool = createTestPool();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    await ensureTestNamespace(pool, 'test@example.com');
  });

  afterAll(async () => {
    await pool.end();
  });

  // ── Existing behavior: namespace provided ──────────────

  it('returns destination_override when inbound_destination matches', async () => {
    await pool.query(
      `INSERT INTO inbound_destination (namespace, address, channel_type, agent_id, is_active)
       VALUES ('default', 'hello@example.com', 'email', 'agent-dest', true)`,
    );

    const result = await resolveRoute(pool, 'hello@example.com', 'email', 'default');

    expect(result).not.toBeNull();
    expect(result!.agentId).toBe('agent-dest');
    expect(result!.source).toBe('destination_override');
  });

  it('falls back to channel_default when no destination matches (namespace provided)', async () => {
    await pool.query(
      `INSERT INTO channel_default (namespace, channel_type, agent_id)
       VALUES ('default', 'email', 'agent-default')`,
    );

    const result = await resolveRoute(pool, 'unknown@example.com', 'email', 'default');

    expect(result).not.toBeNull();
    expect(result!.agentId).toBe('agent-default');
    expect(result!.source).toBe('channel_default');
  });

  it('returns null when nothing matches', async () => {
    const result = await resolveRoute(pool, 'unknown@example.com', 'email', 'default');
    expect(result).toBeNull();
  });

  // ── Bug #2086: namespace undefined (unauthenticated webhook) ──

  it('falls back to channel_default in default namespace when namespace is undefined', async () => {
    await pool.query(
      `INSERT INTO channel_default (namespace, channel_type, agent_id)
       VALUES ('default', 'email', 'agent-catchall')`,
    );

    // Cloudflare email webhook calls resolveRoute without a namespace
    const result = await resolveRoute(pool, 'anything@example.com', 'email');

    expect(result).not.toBeNull();
    expect(result!.agentId).toBe('agent-catchall');
    expect(result!.source).toBe('channel_default');
  });

  it('prefers inbound_destination over channel_default even without namespace', async () => {
    await pool.query(
      `INSERT INTO inbound_destination (namespace, address, channel_type, agent_id, is_active)
       VALUES ('default', 'specific@example.com', 'email', 'agent-specific', true)`,
    );
    await pool.query(
      `INSERT INTO channel_default (namespace, channel_type, agent_id)
       VALUES ('default', 'email', 'agent-catchall')`,
    );

    const result = await resolveRoute(pool, 'specific@example.com', 'email');

    expect(result).not.toBeNull();
    expect(result!.agentId).toBe('agent-specific');
    expect(result!.source).toBe('destination_override');
  });

  it('returns null when no namespace and no default-namespace channel_default', async () => {
    // channel_default exists but in a different namespace
    await pool.query(
      `INSERT INTO channel_default (namespace, channel_type, agent_id)
       VALUES ('other-ns', 'email', 'agent-other')`,
    );

    const result = await resolveRoute(pool, 'anything@example.com', 'email');
    expect(result).toBeNull();
  });

  it('resolves prompt_template_id from channel_default when namespace is undefined', async () => {
    await pool.query(
      `INSERT INTO prompt_template (namespace, label, content, channel_type, is_active)
       VALUES ('default', 'catch-all prompt', 'You are a helpful agent.', 'email', true)`,
    );
    const ptRow = await pool.query(`SELECT id FROM prompt_template WHERE label = 'catch-all prompt'`);
    const promptTemplateId = ptRow.rows[0].id;

    await pool.query(
      `INSERT INTO channel_default (namespace, channel_type, agent_id, prompt_template_id)
       VALUES ('default', 'email', 'agent-catchall', $1)`,
      [promptTemplateId],
    );

    const result = await resolveRoute(pool, 'anything@example.com', 'email');

    expect(result).not.toBeNull();
    expect(result!.agentId).toBe('agent-catchall');
    expect(result!.promptContent).toBe('You are a helpful agent.');
    expect(result!.source).toBe('channel_default');
  });

  // ── Bug #2092: deterministic ordering across namespaces ──

  it('getChannelDefault prefers default namespace when multiple exist (#2092)', async () => {
    // Insert channel defaults in two namespaces for the same channel type.
    // Create 'zzz-ns' first to verify ORDER BY wins over insertion order.
    await pool.query(
      `INSERT INTO channel_default (namespace, channel_type, agent_id)
       VALUES ('zzz-ns', 'email', 'agent-zzz')`,
    );
    await pool.query(
      `INSERT INTO channel_default (namespace, channel_type, agent_id)
       VALUES ('default', 'email', 'agent-default')`,
    );

    // Query without namespace scope — should deterministically return 'default'
    const result = await getChannelDefault(pool, 'email');

    expect(result).not.toBeNull();
    expect(result!.agent_id).toBe('agent-default');
    expect(result!.namespace).toBe('default');
  });

  it('getChannelDefault returns alphabetically first non-default namespace when no default exists (#2092)', async () => {
    // Insert beta before alpha to verify ORDER BY namespace wins over insertion order
    await pool.query(
      `INSERT INTO channel_default (namespace, channel_type, agent_id)
       VALUES ('beta-ns', 'sms', 'agent-beta')`,
    );
    await pool.query(
      `INSERT INTO channel_default (namespace, channel_type, agent_id)
       VALUES ('alpha-ns', 'sms', 'agent-alpha')`,
    );

    const result = await getChannelDefault(pool, 'sms');

    expect(result).not.toBeNull();
    expect(result!.agent_id).toBe('agent-alpha');
    expect(result!.namespace).toBe('alpha-ns');
  });
});
