/**
 * Payload builders for different webhook event types.
 * Part of Issue #201.
 */

import type { AgentHookPayload, WakeHookPayload } from './types.ts';
import { getOpenClawConfig } from './config.ts';

/**
 * Build payload for SMS received event.
 */
export function buildSmsReceivedPayload(params: {
  contact_id: string;
  contact_name: string;
  endpoint_type: string;
  endpoint_value: string;
  m365_contact_id?: string;
  trust_level?: string;
  thread_id: string;
  message_id: string;
  message_body: string;
  agent_id?: string;
}): AgentHookPayload {
  const config = getOpenClawConfig();

  return {
    message: `SMS received from ${params.contact_name}:\n\n${params.message_body}`,
    name: 'SMS Handler',
    session_key: `sms:contact:${params.contact_id}:thread:${params.thread_id}`,
    wake_mode: 'now',
    deliver: true,
    channel: 'last',
    model: config?.defaultModel || 'anthropic/claude-sonnet-4-20250514',
    timeout_seconds: config?.timeout_seconds || 300,
    ...(params.agent_id ? { agent_id: params.agent_id } : {}),
    context: {
      event_type: 'sms_received',
      contact_id: params.contact_id,
      contact_name: params.contact_name,
      endpoint_type: params.endpoint_type,
      endpoint_value: params.endpoint_value,
      m365_contact_id: params.m365_contact_id,
      trust_level: params.trust_level || 'low',
      thread_id: params.thread_id,
      message_id: params.message_id,
      message_body: params.message_body,
      ...(params.agent_id ? { agent_id: params.agent_id } : {}),
    },
  };
}

/**
 * Build payload for email received event.
 */
export function buildEmailReceivedPayload(params: {
  contact_id: string;
  contact_name: string;
  from_email: string;
  to_email?: string;
  subject?: string;
  thread_id: string;
  message_id: string;
  message_body: string;
  agent_id?: string;
}): AgentHookPayload {
  const config = getOpenClawConfig();

  return {
    message: `Email received from ${params.contact_name} <${params.from_email}>:\n\nSubject: ${params.subject || '(no subject)'}\n\n${params.message_body}`,
    name: 'Email Handler',
    session_key: `email:contact:${params.contact_id}:thread:${params.thread_id}`,
    wake_mode: 'now',
    deliver: true,
    channel: 'last',
    model: config?.defaultModel || 'anthropic/claude-sonnet-4-20250514',
    timeout_seconds: config?.timeout_seconds || 300,
    ...(params.agent_id ? { agent_id: params.agent_id } : {}),
    context: {
      event_type: 'email_received',
      contact_id: params.contact_id,
      contact_name: params.contact_name,
      from_email: params.from_email,
      to_email: params.to_email,
      subject: params.subject,
      thread_id: params.thread_id,
      message_id: params.message_id,
      message_body: params.message_body,
      ...(params.agent_id ? { agent_id: params.agent_id } : {}),
    },
  };
}

/**
 * Build payload for reminder due event.
 */
export function buildReminderDuePayload(params: {
  work_item_id: string;
  work_item_title: string;
  work_item_description?: string;
  work_item_kind: string;
  not_before: Date;
  contact_id?: string;
  contact_name?: string;
  agent_id?: string;
}): AgentHookPayload {
  const config = getOpenClawConfig();

  return {
    message: `Reminder: ${params.work_item_title}${params.work_item_description ? '\n\n' + params.work_item_description : ''}`,
    name: 'Reminder Handler',
    session_key: `reminder:work_item:${params.work_item_id}`,
    wake_mode: 'now',
    deliver: true,
    channel: 'last',
    model: config?.defaultModel || 'anthropic/claude-sonnet-4-20250514',
    timeout_seconds: config?.timeout_seconds || 120,
    ...(params.agent_id ? { agent_id: params.agent_id } : {}),
    context: {
      event_type: 'reminder_due',
      work_item_id: params.work_item_id,
      work_item_title: params.work_item_title,
      work_item_description: params.work_item_description,
      work_item_kind: params.work_item_kind,
      not_before: params.not_before.toISOString(),
      contact_id: params.contact_id,
      contact_name: params.contact_name,
      ...(params.agent_id ? { agent_id: params.agent_id } : {}),
    },
  };
}

/**
 * Build payload for deadline approaching event.
 * This uses the /hooks/wake endpoint instead of /hooks/agent.
 */
export function buildDeadlineApproachingPayload(params: {
  work_item_id: string;
  work_item_title: string;
  work_item_kind: string;
  not_after: Date;
  hours_remaining: number;
  agent_id?: string;
}): WakeHookPayload {
  return {
    text: `Deadline approaching: "${params.work_item_title}" (${params.work_item_kind}) is due in ${params.hours_remaining} hours (${params.not_after.toISOString()})`,
    mode: 'now',
    ...(params.agent_id ? { agent_id: params.agent_id } : {}),
  };
}

/**
 * Get the correct webhook destination for an event type.
 */
export function getWebhookDestination(eventType: string): string {
  switch (eventType) {
    case 'deadline_approaching':
      return '/hooks/wake';
    case 'sms_received':
    case 'email_received':
    case 'reminder_due':
    case 'spawn_agent':
    default:
      return '/hooks/agent';
  }
}
