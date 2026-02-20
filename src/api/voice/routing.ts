/**
 * Voice agent routing and configuration.
 * Resolves which OpenClaw agent handles a voice conversation.
 *
 * Issue #1433 — Agent routing and configuration.
 * Epic #1431.
 */

import type { Pool } from 'pg';
import type {
  AgentRouting,
  VoiceAgentConfigRow,
  EntityInfo,
  AreaInfo,
  ServiceCall,
} from './types.ts';

/** Default agent timeout in ms. */
const DEFAULT_TIMEOUT_MS = 15000;

/** Default agent ID if none configured. */
const DEFAULT_AGENT_ID = 'default';

/**
 * Resolve which agent should handle a conversation.
 *
 * Resolution order (first match wins):
 * 1. Runtime override via message `agent_id`
 * 2. Per-user mapping (user_email → agent_id)
 * 3. Per-device mapping (device_id → agent_id)
 * 4. Namespace default agent
 * 5. Fallback to 'default'
 */
export async function resolveAgent(
  pool: Pool,
  namespace: string,
  overrideAgentId?: string,
  deviceId?: string,
  userEmail?: string | null,
): Promise<AgentRouting> {
  // 1. Runtime override
  if (overrideAgentId) {
    const config = await getConfig(pool, namespace);
    return {
      agent_id: overrideAgentId,
      timeout_ms: config?.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    };
  }

  const config = await getConfig(pool, namespace);
  if (!config) {
    return { agent_id: DEFAULT_AGENT_ID, timeout_ms: DEFAULT_TIMEOUT_MS };
  }

  // 2. Per-user mapping
  if (userEmail && config.user_mapping[userEmail]) {
    return {
      agent_id: config.user_mapping[userEmail],
      timeout_ms: config.timeout_ms,
    };
  }

  // 3. Per-device mapping
  if (deviceId && config.device_mapping[deviceId]) {
    return {
      agent_id: config.device_mapping[deviceId],
      timeout_ms: config.timeout_ms,
    };
  }

  // 4. Namespace default
  if (config.default_agent_id) {
    return {
      agent_id: config.default_agent_id,
      timeout_ms: config.timeout_ms,
    };
  }

  // 5. Fallback
  return { agent_id: DEFAULT_AGENT_ID, timeout_ms: config.timeout_ms };
}

/**
 * Get the voice agent config for a namespace.
 * Returns null if no config exists.
 */
export async function getConfig(
  pool: Pool,
  namespace: string,
): Promise<VoiceAgentConfigRow | null> {
  const result = await pool.query<VoiceAgentConfigRow>(
    'SELECT * FROM voice_agent_config WHERE namespace = $1',
    [namespace],
  );
  return result.rows[0] ?? null;
}

/**
 * Upsert voice agent config for a namespace.
 * Uses EXCLUDED to apply all supplied values cleanly on conflict.
 */
export async function upsertConfig(
  pool: Pool,
  namespace: string,
  updates: Partial<Pick<VoiceAgentConfigRow,
    'default_agent_id' | 'timeout_ms' | 'idle_timeout_s' | 'retention_days' |
    'device_mapping' | 'user_mapping' | 'service_allowlist' | 'metadata'
  >>,
): Promise<VoiceAgentConfigRow> {
  const result = await pool.query<VoiceAgentConfigRow>(
    `INSERT INTO voice_agent_config (
       namespace, default_agent_id, timeout_ms, idle_timeout_s, retention_days,
       device_mapping, user_mapping, service_allowlist, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (namespace) DO UPDATE SET
       default_agent_id = EXCLUDED.default_agent_id,
       timeout_ms = EXCLUDED.timeout_ms,
       idle_timeout_s = EXCLUDED.idle_timeout_s,
       retention_days = EXCLUDED.retention_days,
       device_mapping = EXCLUDED.device_mapping,
       user_mapping = EXCLUDED.user_mapping,
       service_allowlist = EXCLUDED.service_allowlist,
       metadata = EXCLUDED.metadata,
       updated_at = NOW()
     RETURNING *`,
    [
      namespace,
      updates.default_agent_id ?? null,
      updates.timeout_ms ?? 15000,
      updates.idle_timeout_s ?? 300,
      updates.retention_days ?? 30,
      JSON.stringify(updates.device_mapping ?? {}),
      JSON.stringify(updates.user_mapping ?? {}),
      JSON.stringify(updates.service_allowlist ?? [
        'light', 'switch', 'cover', 'climate', 'media_player',
        'scene', 'script', 'input_boolean', 'input_number', 'input_select',
      ]),
      JSON.stringify(updates.metadata ?? {}),
    ],
  );
  return result.rows[0];
}

/** Options for the agent response request. */
interface AgentRequestOptions {
  language?: string;
  context?: Record<string, unknown>;
  entities?: EntityInfo[];
  areas?: AreaInfo[];
}

/** Agent response from the OpenClaw gateway. */
interface AgentResponse {
  text: string;
  continue_conversation: boolean;
  service_calls?: ServiceCall[];
}

/**
 * Call the OpenClaw gateway to get an agent response.
 *
 * This sends the user text + context to the configured agent and returns
 * the agent's response. If the gateway is not available, returns a fallback.
 */
export async function getAgentResponse(
  pool: Pool,
  routing: AgentRouting,
  text: string,
  conversationId: string,
  namespace: string,
  options?: AgentRequestOptions,
): Promise<AgentResponse> {
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
  if (!gatewayUrl) {
    // No gateway configured — return a stub response for development/testing
    return {
      text: `Agent "${routing.agent_id}" received: ${text}`,
      continue_conversation: true,
    };
  }

  // Build the conversation history for context
  const historyResult = await pool.query(
    `SELECT role, text FROM voice_message
     WHERE conversation_id = $1
     ORDER BY timestamp DESC LIMIT 10`,
    [conversationId],
  );
  const history = historyResult.rows.reverse();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), routing.timeout_ms);

  try {
    const response = await fetch(`${gatewayUrl}/api/agents/${routing.agent_id}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        conversation_id: conversationId,
        namespace,
        history,
        language: options?.language,
        context: {
          ...(options?.context ?? {}),
          entities: options?.entities,
          areas: options?.areas,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Gateway returned ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as AgentResponse;
    return {
      text: data.text ?? '',
      continue_conversation: data.continue_conversation ?? true,
      service_calls: data.service_calls,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Agent "${routing.agent_id}" timed out after ${routing.timeout_ms}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
