import type { Pool } from 'pg';

export interface ChannelDefault {
  id: string;
  namespace: string;
  channel_type: string;
  agent_id: string;
  prompt_template_id: string | null;
  context_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChannelDefaultSetInput {
  channel_type: string;
  agent_id: string;
  prompt_template_id?: string | null;
  context_id?: string | null;
  namespace: string;
}

const VALID_CHANNEL_TYPES = ['sms', 'email', 'ha_observation'];

const COLUMNS = `id::text as id, namespace, channel_type, agent_id, prompt_template_id::text as prompt_template_id, context_id::text as context_id, created_at, updated_at`;

export function isValidChannelType(type: string): boolean {
  return VALID_CHANNEL_TYPES.includes(type);
}

/**
 * List all channel defaults, optionally scoped to namespaces.
 */
export async function listChannelDefaults(
  pool: Pool,
  queryNamespaces?: string[],
): Promise<ChannelDefault[]> {
  if (queryNamespaces) {
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM channel_default WHERE namespace = ANY($1::text[]) ORDER BY channel_type`,
      [queryNamespaces],
    );
    return result.rows as ChannelDefault[];
  }
  const result = await pool.query(
    `SELECT ${COLUMNS} FROM channel_default ORDER BY channel_type`,
  );
  return result.rows as ChannelDefault[];
}

/**
 * Get channel default for a specific channel type, optionally scoped to namespaces.
 */
export async function getChannelDefault(
  pool: Pool,
  channelType: string,
  queryNamespaces?: string[],
): Promise<ChannelDefault | null> {
  if (queryNamespaces) {
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM channel_default WHERE channel_type = $1 AND namespace = ANY($2::text[])`,
      [channelType, queryNamespaces],
    );
    return (result.rows[0] as ChannelDefault) ?? null;
  }
  const result = await pool.query(
    `SELECT ${COLUMNS} FROM channel_default WHERE channel_type = $1`,
    [channelType],
  );
  return (result.rows[0] as ChannelDefault) ?? null;
}

/**
 * Set (upsert) a channel default. Uses INSERT ... ON CONFLICT to create or update.
 */
export async function setChannelDefault(
  pool: Pool,
  input: ChannelDefaultSetInput,
): Promise<ChannelDefault> {
  const result = await pool.query(
    `INSERT INTO channel_default (namespace, channel_type, agent_id, prompt_template_id, context_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (namespace, channel_type) DO UPDATE SET
       agent_id = EXCLUDED.agent_id,
       prompt_template_id = EXCLUDED.prompt_template_id,
       context_id = EXCLUDED.context_id
     RETURNING ${COLUMNS}`,
    [input.namespace, input.channel_type, input.agent_id, input.prompt_template_id ?? null, input.context_id ?? null],
  );

  return result.rows[0] as ChannelDefault;
}

/**
 * Delete a channel default by channel type within a namespace.
 */
export async function deleteChannelDefault(
  pool: Pool,
  channelType: string,
  namespace: string,
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM channel_default WHERE channel_type = $1 AND namespace = $2 RETURNING id`,
    [channelType, namespace],
  );
  return result.rows.length > 0;
}

/**
 * Bootstrap channel defaults from environment variables.
 * Only creates rows for channel types that have no existing row in the given namespace.
 */
export async function bootstrapChannelDefaults(
  pool: Pool,
  namespace: string = 'default',
): Promise<{ bootstrapped: string[] }> {
  const bootstrapped: string[] = [];

  const envMap: Array<{ channelType: string; agentEnv: string; promptEnv: string }> = [
    { channelType: 'sms', agentEnv: 'INBOUND_DEFAULT_AGENT_SMS', promptEnv: 'INBOUND_DEFAULT_PROMPT_SMS' },
    { channelType: 'email', agentEnv: 'INBOUND_DEFAULT_AGENT_EMAIL', promptEnv: 'INBOUND_DEFAULT_PROMPT_EMAIL' },
    { channelType: 'ha_observation', agentEnv: 'INBOUND_DEFAULT_AGENT_HA', promptEnv: 'INBOUND_DEFAULT_PROMPT_HA' },
  ];

  for (const { channelType, agentEnv, promptEnv } of envMap) {
    const agentId = process.env[agentEnv];
    if (!agentId) continue;

    // Check if row already exists
    const existing = await pool.query(
      'SELECT id FROM channel_default WHERE namespace = $1 AND channel_type = $2',
      [namespace, channelType],
    );
    if (existing.rows.length > 0) continue;

    // Create prompt template from env if provided
    let promptTemplateId: string | null = null;
    const promptContent = process.env[promptEnv];
    if (promptContent) {
      const { createPromptTemplate } = await import('../prompt-template/service.ts');
      const pt = await createPromptTemplate(pool, {
        label: `Default ${channelType} prompt (bootstrapped)`,
        content: promptContent,
        channel_type: channelType,
        is_default: true,
        namespace,
      });
      promptTemplateId = pt.id;
    }

    await setChannelDefault(pool, {
      namespace,
      channel_type: channelType,
      agent_id: agentId,
      prompt_template_id: promptTemplateId,
    });

    bootstrapped.push(channelType);
  }

  return { bootstrapped };
}
