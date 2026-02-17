/**
 * Unified email service layer.
 * Part of Issue #1048.
 *
 * Provides live API access to email operations by routing requests through
 * the appropriate provider (Microsoft Graph Mail or Gmail). Handles
 * connection lookup, token refresh, feature/permission validation.
 */

import type { Pool } from 'pg';
import { OAuthError, NoConnectionError } from './types.ts';
import type { OAuthConnection } from './types.ts';
import { getConnection, getValidAccessToken } from './service.ts';
import { microsoftEmailProvider } from './email-microsoft.ts';
import { googleEmailProvider } from './email-google.ts';
import type {
  EmailProvider,
  EmailListParams,
  EmailListResult,
  EmailThreadListResult,
  EmailMessage,
  EmailThread,
  EmailFolder,
  EmailSendParams,
  EmailSendResult,
  EmailDraftParams,
  EmailUpdateParams,
  EmailAttachmentContent,
} from './email-types.ts';

/** Resolve the email provider implementation for a connection. */
function getProvider(connection: OAuthConnection): EmailProvider {
  switch (connection.provider) {
    case 'microsoft':
      return microsoftEmailProvider;
    case 'google':
      return googleEmailProvider;
    default:
      throw new OAuthError(`Unsupported email provider: ${connection.provider}`, 'UNSUPPORTED_PROVIDER', connection.provider);
  }
}

/** Validate that a connection has the email feature enabled. */
function requireEmailFeature(connection: OAuthConnection): void {
  if (!connection.enabled_features.includes('email')) {
    throw new OAuthError(
      'Email feature is not enabled on this connection',
      'FEATURE_NOT_ENABLED',
      connection.provider,
      403,
    );
  }
}

/** Validate that a connection has write permission. */
function requireWritePermission(connection: OAuthConnection): void {
  if (connection.permission_level !== 'read_write') {
    throw new OAuthError(
      'Write permission is required for this operation. Connection is read-only.',
      'PERMISSION_DENIED',
      connection.provider,
      403,
    );
  }
}

/** Validate that a connection is active. */
function requireActiveConnection(connection: OAuthConnection): void {
  if (!connection.is_active) {
    throw new OAuthError(
      'This connection is currently disabled',
      'CONNECTION_DISABLED',
      connection.provider,
      403,
    );
  }
}

/** Look up and validate a connection for email operations. */
async function resolveConnection(pool: Pool, connection_id: string): Promise<{ connection: OAuthConnection; access_token: string }> {
  const connection = await getConnection(pool, connection_id);
  if (!connection) {
    throw new NoConnectionError(connection_id);
  }
  requireActiveConnection(connection);
  requireEmailFeature(connection);
  const access_token = await getValidAccessToken(pool, connection_id);
  return { connection, access_token };
}

/**
 * List or search emails for a connection.
 * Requires: email feature enabled.
 */
export async function listMessages(
  pool: Pool,
  connection_id: string,
  params: EmailListParams = {},
): Promise<EmailListResult> {
  const { connection, access_token } = await resolveConnection(pool, connection_id);
  const provider = getProvider(connection);
  return provider.listMessages(access_token, params);
}

/**
 * Get a single email message by ID.
 * Requires: email feature enabled.
 */
export async function getMessage(
  pool: Pool,
  connection_id: string,
  message_id: string,
): Promise<EmailMessage> {
  const { connection, access_token } = await resolveConnection(pool, connection_id);
  const provider = getProvider(connection);
  return provider.getMessage(access_token, message_id);
}

/**
 * List email threads (conversation view).
 * Requires: email feature enabled.
 */
export async function listThreads(
  pool: Pool,
  connection_id: string,
  params: EmailListParams = {},
): Promise<EmailThreadListResult> {
  const { connection, access_token } = await resolveConnection(pool, connection_id);
  const provider = getProvider(connection);
  return provider.listThreads(access_token, params);
}

/**
 * Get a full email thread with all messages.
 * Requires: email feature enabled.
 */
export async function getThread(
  pool: Pool,
  connection_id: string,
  thread_id: string,
): Promise<EmailThread & { messages: EmailMessage[] }> {
  const { connection, access_token } = await resolveConnection(pool, connection_id);
  const provider = getProvider(connection);
  return provider.getThread(access_token, thread_id);
}

/**
 * List email folders/labels.
 * Requires: email feature enabled.
 */
export async function listFolders(
  pool: Pool,
  connection_id: string,
): Promise<EmailFolder[]> {
  const { connection, access_token } = await resolveConnection(pool, connection_id);
  const provider = getProvider(connection);
  return provider.listFolders(access_token);
}

/**
 * Send a new email.
 * Requires: email feature enabled + read_write permission.
 */
export async function sendMessage(
  pool: Pool,
  connection_id: string,
  params: EmailSendParams,
): Promise<EmailSendResult> {
  const { connection, access_token } = await resolveConnection(pool, connection_id);
  requireWritePermission(connection);
  const provider = getProvider(connection);
  return provider.sendMessage(access_token, params);
}

/**
 * Create a draft email.
 * Requires: email feature enabled + read_write permission.
 */
export async function createDraft(
  pool: Pool,
  connection_id: string,
  params: EmailDraftParams,
): Promise<EmailMessage> {
  const { connection, access_token } = await resolveConnection(pool, connection_id);
  requireWritePermission(connection);
  const provider = getProvider(connection);
  return provider.createDraft(access_token, params);
}

/**
 * Update a draft email.
 * Requires: email feature enabled + read_write permission.
 */
export async function updateDraft(
  pool: Pool,
  connection_id: string,
  draftId: string,
  params: EmailDraftParams,
): Promise<EmailMessage> {
  const { connection, access_token } = await resolveConnection(pool, connection_id);
  requireWritePermission(connection);
  const provider = getProvider(connection);
  return provider.updateDraft(access_token, draftId, params);
}

/**
 * Update message state (read, starred, labels, move).
 * Requires: email feature enabled + read_write permission.
 */
export async function updateMessage(
  pool: Pool,
  connection_id: string,
  message_id: string,
  params: EmailUpdateParams,
): Promise<void> {
  const { connection, access_token } = await resolveConnection(pool, connection_id);
  requireWritePermission(connection);
  const provider = getProvider(connection);
  return provider.updateMessage(access_token, message_id, params);
}

/**
 * Delete an email message.
 * Requires: email feature enabled + read_write permission.
 */
export async function deleteMessage(
  pool: Pool,
  connection_id: string,
  message_id: string,
  permanent = false,
): Promise<void> {
  const { connection, access_token } = await resolveConnection(pool, connection_id);
  requireWritePermission(connection);
  const provider = getProvider(connection);
  return provider.deleteMessage(access_token, message_id, permanent);
}

/**
 * Download an attachment.
 * Requires: email feature enabled.
 */
export async function getAttachment(
  pool: Pool,
  connection_id: string,
  message_id: string,
  attachmentId: string,
): Promise<EmailAttachmentContent> {
  const { connection, access_token } = await resolveConnection(pool, connection_id);
  const provider = getProvider(connection);
  return provider.getAttachment(access_token, message_id, attachmentId);
}
