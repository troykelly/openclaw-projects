/**
 * Types for webhook dispatch to OpenClaw gateway.
 * All property names use snake_case to match the project-wide convention (Issue #1412).
 * Part of Issue #201.
 */

export type WebhookEventType = 'sms_received' | 'email_received' | 'reminder_due' | 'deadline_approaching' | 'spawn_agent';

export interface OpenClawConfig {
  gatewayUrl: string;
  apiToken: string;
  defaultModel?: string;
  timeout_seconds?: number;
}

export interface WebhookOutboxEntry {
  id: string;
  kind: string;
  destination: string;
  run_at: Date;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  attempts: number;
  last_error: string | null;
  locked_at: Date | null;
  locked_by: string | null;
  dispatched_at: Date | null;
  idempotency_key: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AgentHookPayload {
  message: string;
  name: string;
  session_key?: string;
  wake_mode?: 'now' | 'schedule';
  deliver?: boolean;
  channel?: 'last' | 'new';
  model?: string;
  timeout_seconds?: number;
  /** Agent identifier for multi-agent routing in OpenClaw gateway. Maps to user_email scope. */
  agent_id?: string;
  context: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WakeHookPayload {
  text: string;
  mode?: 'now' | 'schedule';
  /** Agent identifier for multi-agent routing in OpenClaw gateway. Maps to user_email scope. */
  agent_id?: string;
  [key: string]: unknown;
}

export interface WebhookDispatchResult {
  success: boolean;
  status_code?: number;
  error?: string;
  response_body?: unknown;
}

export interface DispatchStats {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
}
