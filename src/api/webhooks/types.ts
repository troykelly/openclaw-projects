/**
 * Types for webhook dispatch to OpenClaw gateway.
 * Part of Issue #201.
 */

export type WebhookEventType =
  | 'sms_received'
  | 'email_received'
  | 'reminder_due'
  | 'deadline_approaching'
  | 'spawn_agent';

export interface OpenClawConfig {
  gatewayUrl: string;
  hookToken: string;
  defaultModel?: string;
  timeoutSeconds?: number;
}

export interface WebhookOutboxEntry {
  id: string;
  kind: string;
  destination: string;
  runAt: Date;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  attempts: number;
  lastError: string | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  dispatchedAt: Date | null;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentHookPayload {
  message: string;
  name: string;
  sessionKey?: string;
  wakeMode?: 'now' | 'schedule';
  deliver?: boolean;
  channel?: 'last' | 'new';
  model?: string;
  timeoutSeconds?: number;
  context: Record<string, unknown>;
}

export interface WakeHookPayload {
  text: string;
  mode?: 'now' | 'schedule';
}

export interface WebhookDispatchResult {
  success: boolean;
  statusCode?: number;
  error?: string;
  responseBody?: unknown;
}

export interface DispatchStats {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
}
