/**
 * Voice conversation types and interfaces.
 * Epic #1431 — Voice agent backend.
 */

// ---------- Database row types ----------

/** Row from the voice_conversation table. */
export interface VoiceConversationRow {
  id: string;
  namespace: string;
  agent_id: string | null;
  device_id: string | null;
  user_email: string | null;
  created_at: Date;
  last_active_at: Date;
  metadata: Record<string, unknown>;
}

/** Row from the voice_message table. */
export interface VoiceMessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  text: string;
  service_calls: ServiceCall[] | null;
  timestamp: Date;
}

/** Row from the voice_agent_config table. */
export interface VoiceAgentConfigRow {
  id: string;
  namespace: string;
  default_agent_id: string | null;
  timeout_ms: number;
  idle_timeout_s: number;
  retention_days: number;
  device_mapping: Record<string, string>;
  user_mapping: Record<string, string>;
  service_allowlist: string[];
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

// ---------- WebSocket message types ----------

/** Client-to-server: text conversation message. */
export interface ConversationTextMessage {
  type: 'conversation.text';
  conversation_id?: string;
  text: string;
  language?: string;
  agent_id?: string;
  context?: Record<string, unknown>;
}

/** Client-to-server: entity context sync (HA integration). */
export interface EntityContextMessage {
  type: 'context.entities';
  entities: EntityInfo[];
  areas?: AreaInfo[];
}

/** Client-to-server: service call result acknowledgment. */
export interface ServiceCallResultMessage {
  type: 'service_call.result';
  conversation_id: string;
  call_index: number;
  success: boolean;
  error?: string;
  result?: Record<string, unknown>;
}

/** Client-to-server: pong heartbeat response. */
export interface PongMessage {
  type: 'pong';
}

/** All valid client-to-server message types. */
export type ClientMessage =
  | ConversationTextMessage
  | EntityContextMessage
  | ServiceCallResultMessage
  | PongMessage;

/** Server-to-client: conversation response. */
export interface ConversationResponseMessage {
  type: 'conversation.response';
  conversation_id: string;
  text: string;
  continue_conversation: boolean;
  service_calls?: ServiceCall[];
}

/** Server-to-client: error message. */
export interface ConversationErrorMessage {
  type: 'conversation.error';
  conversation_id: string;
  error: string;
  message: string;
}

/** Server-to-client: ping heartbeat. */
export interface PingMessage {
  type: 'ping';
  timestamp: string;
}

/** Server-to-client: connection established. */
export interface ConnectionEstablishedMessage {
  type: 'connection.established';
  client_id: string;
}

/** All valid server-to-client message types. */
export type ServerMessage =
  | ConversationResponseMessage
  | ConversationErrorMessage
  | PingMessage
  | ConnectionEstablishedMessage;

// ---------- Service call types ----------

/** A structured service call (e.g., for Home Assistant). */
export interface ServiceCall {
  domain: string;
  service: string;
  target?: ServiceCallTarget;
  data?: Record<string, unknown>;
}

/** Target for a service call. */
export interface ServiceCallTarget {
  entity_id?: string | string[];
  area_id?: string | string[];
  device_id?: string | string[];
}

/** Entity information for context sync. */
export interface EntityInfo {
  entity_id: string;
  domain: string;
  state: string;
  friendly_name?: string;
  area_id?: string;
  attributes?: Record<string, unknown>;
}

/** Area information for context sync. */
export interface AreaInfo {
  area_id: string;
  name: string;
}

// ---------- Agent routing types ----------

/** Resolved agent routing result. */
export interface AgentRouting {
  agent_id: string;
  timeout_ms: number;
}

/** Voice config update body. */
export interface VoiceConfigUpdateBody {
  default_agent_id?: string | null;
  timeout_ms?: number;
  idle_timeout_s?: number;
  retention_days?: number;
  device_mapping?: Record<string, string>;
  user_mapping?: Record<string, string>;
  service_allowlist?: string[];
}

// ---------- Constants ----------

/** Default safe domains for service calls. */
export const DEFAULT_SAFE_DOMAINS: readonly string[] = [
  'light',
  'switch',
  'cover',
  'climate',
  'media_player',
  'scene',
  'script',
  'input_boolean',
  'input_number',
  'input_select',
] as const;

/** Always-blocked service calls (destructive operations). */
export const BLOCKED_SERVICES: readonly string[] = [
  'automation.delete',
  'homeassistant.restart',
  'homeassistant.stop',
  'homeassistant.check_config',
  'recorder.purge',
  'recorder.disable',
  'system_log.clear',
] as const;

/** Default WebSocket heartbeat interval in ms. */
export const WS_HEARTBEAT_INTERVAL_MS = 30000;

/** Stale connection threshold: 2x heartbeat interval. */
export const WS_STALE_THRESHOLD_MS = WS_HEARTBEAT_INTERVAL_MS * 2;
