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
  contactId: string;
  contactName: string;
  endpointType: string;
  endpointValue: string;
  m365ContactId?: string;
  trustLevel?: string;
  threadId: string;
  messageId: string;
  messageBody: string;
}): AgentHookPayload {
  const config = getOpenClawConfig();

  return {
    message: `SMS received from ${params.contactName}:\n\n${params.messageBody}`,
    name: 'SMS Handler',
    sessionKey: `sms:contact:${params.contactId}:thread:${params.threadId}`,
    wakeMode: 'now',
    deliver: true,
    channel: 'last',
    model: config?.defaultModel || 'anthropic/claude-sonnet-4-20250514',
    timeoutSeconds: config?.timeoutSeconds || 300,
    context: {
      event_type: 'sms_received',
      contact_id: params.contactId,
      contact_name: params.contactName,
      endpoint_type: params.endpointType,
      endpoint_value: params.endpointValue,
      m365_contact_id: params.m365ContactId,
      trust_level: params.trustLevel || 'low',
      thread_id: params.threadId,
      message_id: params.messageId,
      message_body: params.messageBody,
    },
  };
}

/**
 * Build payload for email received event.
 */
export function buildEmailReceivedPayload(params: {
  contactId: string;
  contactName: string;
  fromEmail: string;
  toEmail?: string;
  subject?: string;
  threadId: string;
  messageId: string;
  messageBody: string;
}): AgentHookPayload {
  const config = getOpenClawConfig();

  return {
    message: `Email received from ${params.contactName} <${params.fromEmail}>:\n\nSubject: ${params.subject || '(no subject)'}\n\n${params.messageBody}`,
    name: 'Email Handler',
    sessionKey: `email:contact:${params.contactId}:thread:${params.threadId}`,
    wakeMode: 'now',
    deliver: true,
    channel: 'last',
    model: config?.defaultModel || 'anthropic/claude-sonnet-4-20250514',
    timeoutSeconds: config?.timeoutSeconds || 300,
    context: {
      event_type: 'email_received',
      contact_id: params.contactId,
      contact_name: params.contactName,
      from_email: params.fromEmail,
      to_email: params.toEmail,
      subject: params.subject,
      thread_id: params.threadId,
      message_id: params.messageId,
      message_body: params.messageBody,
    },
  };
}

/**
 * Build payload for reminder due event.
 */
export function buildReminderDuePayload(params: {
  workItemId: string;
  workItemTitle: string;
  workItemDescription?: string;
  workItemKind: string;
  notBefore: Date;
  contactId?: string;
  contactName?: string;
}): AgentHookPayload {
  const config = getOpenClawConfig();

  return {
    message: `Reminder: ${params.workItemTitle}${params.workItemDescription ? '\n\n' + params.workItemDescription : ''}`,
    name: 'Reminder Handler',
    sessionKey: `reminder:work_item:${params.workItemId}`,
    wakeMode: 'now',
    deliver: true,
    channel: 'last',
    model: config?.defaultModel || 'anthropic/claude-sonnet-4-20250514',
    timeoutSeconds: config?.timeoutSeconds || 120,
    context: {
      event_type: 'reminder_due',
      work_item_id: params.workItemId,
      work_item_title: params.workItemTitle,
      work_item_description: params.workItemDescription,
      work_item_kind: params.workItemKind,
      not_before: params.notBefore.toISOString(),
      contact_id: params.contactId,
      contact_name: params.contactName,
    },
  };
}

/**
 * Build payload for deadline approaching event.
 * This uses the /hooks/wake endpoint instead of /hooks/agent.
 */
export function buildDeadlineApproachingPayload(params: {
  workItemId: string;
  workItemTitle: string;
  workItemKind: string;
  notAfter: Date;
  hoursRemaining: number;
}): WakeHookPayload {
  return {
    text: `Deadline approaching: "${params.workItemTitle}" (${params.workItemKind}) is due in ${params.hoursRemaining} hours (${params.notAfter.toISOString()})`,
    mode: 'now',
  };
}

/**
 * Build payload for spawn agent event.
 */
export function buildSpawnAgentPayload(params: {
  agentType: string;
  repository?: string;
  epicNumber?: number;
  workItemId?: string;
  workItemTitle?: string;
  instructions?: string;
}): AgentHookPayload {
  const config = getOpenClawConfig();

  return {
    message: `Spawn ${params.agentType} agent${params.repository ? ` for ${params.repository}` : ''}${params.epicNumber ? ` (Epic #${params.epicNumber})` : ''}\n\n${params.instructions || 'No specific instructions provided.'}`,
    name: `${params.agentType} Spawner`,
    sessionKey: params.workItemId ? `spawn:work_item:${params.workItemId}` : `spawn:${params.agentType}:${Date.now()}`,
    wakeMode: 'now',
    deliver: false,
    channel: 'new',
    model: config?.defaultModel || 'anthropic/claude-sonnet-4-20250514',
    timeoutSeconds: config?.timeoutSeconds || 600,
    context: {
      event_type: 'spawn_agent',
      agent_type: params.agentType,
      repository: params.repository,
      epic_number: params.epicNumber,
      work_item_id: params.workItemId,
      work_item_title: params.workItemTitle,
      instructions: params.instructions,
    },
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
