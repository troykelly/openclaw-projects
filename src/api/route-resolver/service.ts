import type { Pool } from 'pg';

export interface ResolvedRoute {
  agentId: string;
  promptContent: string | null;
  contextId: string | null;
  source: 'destination_override' | 'channel_default';
}

type ChannelType = 'sms' | 'email' | 'ha_observation';

/**
 * Look up an inbound_destination by (address, channel_type).
 * Returns the row if active; null otherwise.
 */
async function getDestinationByAddress(
  pool: Pool,
  address: string,
  channelType: string,
  queryNamespaces?: string[],
) {
  const base = `SELECT id::text as id, namespace, address, channel_type, agent_id,
    prompt_template_id::text as prompt_template_id,
    context_id::text as context_id, is_active
    FROM inbound_destination
    WHERE address = $1 AND channel_type = $2 AND is_active = true`;

  if (queryNamespaces) {
    const result = await pool.query(
      `${base} AND namespace = ANY($3::text[])`,
      [address, channelType, queryNamespaces],
    );
    return result.rows[0] ?? null;
  }
  const result = await pool.query(base, [address, channelType]);
  return result.rows[0] ?? null;
}

/**
 * Load prompt template content by ID, scoped to namespace.
 * Returns null if not found, inactive, or outside the given namespace.
 */
async function loadPromptContent(
  pool: Pool,
  promptTemplateId: string,
  namespace: string,
): Promise<string | null> {
  const result = await pool.query(
    `SELECT content FROM prompt_template WHERE id = $1 AND is_active = true AND namespace = $2`,
    [promptTemplateId, namespace],
  );
  return (result.rows[0] as { content: string } | undefined)?.content ?? null;
}

/**
 * Resolve routing for an inbound message.
 *
 * Resolution order:
 * 1. inbound_destination by (address, channel_type) — if agent_id is set, use overrides
 * 2. channel_default by (namespace, channel_type) — fallback
 * 3. null — no routing configured (message stored but not dispatched)
 */
export async function resolveRoute(
  pool: Pool,
  recipient: string,
  channelType: ChannelType,
  namespace: string,
): Promise<ResolvedRoute | null> {
  // Step 1: Check inbound_destination (scoped to namespace)
  const dest = await getDestinationByAddress(pool, recipient, channelType, [namespace]);

  if (dest?.agent_id) {
    const promptContent = dest.prompt_template_id
      ? await loadPromptContent(pool, dest.prompt_template_id, namespace)
      : null;

    return {
      agentId: dest.agent_id,
      promptContent,
      contextId: dest.context_id ?? null,
      source: 'destination_override',
    };
  }

  // Step 2: Check channel_default
  const { getChannelDefault } = await import('../channel-default/service.ts');
  const channelDefault = await getChannelDefault(pool, channelType, [namespace]);

  if (channelDefault) {
    const promptContent = channelDefault.prompt_template_id
      ? await loadPromptContent(pool, channelDefault.prompt_template_id, namespace)
      : null;

    return {
      agentId: channelDefault.agent_id,
      promptContent,
      contextId: channelDefault.context_id ?? null,
      source: 'channel_default',
    };
  }

  // Step 3: No routing configured
  return null;
}
