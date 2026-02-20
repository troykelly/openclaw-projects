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

/** Safe agent_id pattern: alphanumeric, dots, hyphens, underscores only. */
const SAFE_AGENT_ID_REGEX = /^[a-zA-Z0-9._-]+$/;

/**
 * Validate that an agent_id is safe for use in URL paths.
 * Prevents SSRF via path injection (e.g., `../../admin`).
 */
function isValidAgentId(agentId: string): boolean {
  return SAFE_AGENT_ID_REGEX.test(agentId) && agentId.length <= 128;
}

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
  // 1. Runtime override — validate format to prevent SSRF via path injection
  if (overrideAgentId) {
    if (!isValidAgentId(overrideAgentId)) {
      throw new Error(`Invalid agent_id format: must match ${SAFE_AGENT_ID_REGEX.source}`);
    }
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
  // Validate agent_id formats to prevent SSRF when used in gateway URLs
  if (updates.default_agent_id && !isValidAgentId(updates.default_agent_id)) {
    throw new Error(`Invalid default_agent_id format: must match ${SAFE_AGENT_ID_REGEX.source}`);
  }
  if (updates.device_mapping) {
    for (const agentId of Object.values(updates.device_mapping)) {
      if (!isValidAgentId(agentId)) {
        throw new Error(`Invalid agent_id in device_mapping: must match ${SAFE_AGENT_ID_REGEX.source}`);
      }
    }
  }
  if (updates.user_mapping) {
    for (const agentId of Object.values(updates.user_mapping)) {
      if (!isValidAgentId(agentId)) {
        throw new Error(`Invalid agent_id in user_mapping: must match ${SAFE_AGENT_ID_REGEX.source}`);
      }
    }
  }

  const result = await pool.query<VoiceAgentConfigRow>(
    `INSERT INTO voice_agent_config (
       namespace, default_agent_id, timeout_ms, idle_timeout_s, retention_days,
       device_mapping, user_mapping, service_allowlist, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (namespace) DO UPDATE SET
       default_agent_id = COALESCE(EXCLUDED.default_agent_id, voice_agent_config.default_agent_id),
       timeout_ms = COALESCE(EXCLUDED.timeout_ms, voice_agent_config.timeout_ms),
       idle_timeout_s = COALESCE(EXCLUDED.idle_timeout_s, voice_agent_config.idle_timeout_s),
       retention_days = COALESCE(EXCLUDED.retention_days, voice_agent_config.retention_days),
       device_mapping = COALESCE(EXCLUDED.device_mapping, voice_agent_config.device_mapping),
       user_mapping = COALESCE(EXCLUDED.user_mapping, voice_agent_config.user_mapping),
       service_allowlist = COALESCE(EXCLUDED.service_allowlist, voice_agent_config.service_allowlist),
       metadata = COALESCE(EXCLUDED.metadata, voice_agent_config.metadata),
       updated_at = NOW()
     RETURNING *`,
    [
      namespace,
      updates.default_agent_id ?? null,
      updates.timeout_ms ?? null,
      updates.idle_timeout_s ?? null,
      updates.retention_days ?? null,
      updates.device_mapping !== undefined ? JSON.stringify(updates.device_mapping) : null,
      updates.user_mapping !== undefined ? JSON.stringify(updates.user_mapping) : null,
      updates.service_allowlist !== undefined ? JSON.stringify(updates.service_allowlist) : null,
      updates.metadata !== undefined ? JSON.stringify(updates.metadata) : null,
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
  // Validate agent_id format before constructing URL to prevent SSRF
  if (!isValidAgentId(routing.agent_id)) {
    throw new Error(`Invalid agent_id format: must match ${SAFE_AGENT_ID_REGEX.source}`);
  }

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
