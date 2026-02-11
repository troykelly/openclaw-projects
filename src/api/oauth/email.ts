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
  if (!connection.enabledFeatures.includes('email')) {
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
  if (connection.permissionLevel !== 'read_write') {
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
  if (!connection.isActive) {
    throw new OAuthError(
      'This connection is currently disabled',
      'CONNECTION_DISABLED',
      connection.provider,
      403,
    );
  }
}

/** Look up and validate a connection for email operations. */
async function resolveConnection(pool: Pool, connectionId: string): Promise<{ connection: OAuthConnection; accessToken: string }> {
  const connection = await getConnection(pool, connectionId);
  if (!connection) {
    throw new NoConnectionError(connectionId);
  }
  requireActiveConnection(connection);
  requireEmailFeature(connection);
  const accessToken = await getValidAccessToken(pool, connectionId);
  return { connection, accessToken };
}

/**
 * List or search emails for a connection.
 * Requires: email feature enabled.
 */
export async function listMessages(
  pool: Pool,
  connectionId: string,
  params: EmailListParams = {},
): Promise<EmailListResult> {
  const { connection, accessToken } = await resolveConnection(pool, connectionId);
  const provider = getProvider(connection);
  return provider.listMessages(accessToken, params);
}

/**
 * Get a single email message by ID.
 * Requires: email feature enabled.
 */
export async function getMessage(
  pool: Pool,
  connectionId: string,
  messageId: string,
): Promise<EmailMessage> {
  const { connection, accessToken } = await resolveConnection(pool, connectionId);
  const provider = getProvider(connection);
  return provider.getMessage(accessToken, messageId);
}

/**
 * List email threads (conversation view).
 * Requires: email feature enabled.
 */
export async function listThreads(
  pool: Pool,
  connectionId: string,
  params: EmailListParams = {},
): Promise<EmailThreadListResult> {
  const { connection, accessToken } = await resolveConnection(pool, connectionId);
  const provider = getProvider(connection);
  return provider.listThreads(accessToken, params);
}

/**
 * Get a full email thread with all messages.
 * Requires: email feature enabled.
 */
export async function getThread(
  pool: Pool,
  connectionId: string,
  threadId: string,
): Promise<EmailThread & { messages: EmailMessage[] }> {
  const { connection, accessToken } = await resolveConnection(pool, connectionId);
  const provider = getProvider(connection);
  return provider.getThread(accessToken, threadId);
}

/**
 * List email folders/labels.
 * Requires: email feature enabled.
 */
export async function listFolders(
  pool: Pool,
  connectionId: string,
): Promise<EmailFolder[]> {
  const { connection, accessToken } = await resolveConnection(pool, connectionId);
  const provider = getProvider(connection);
  return provider.listFolders(accessToken);
}

/**
 * Send a new email.
 * Requires: email feature enabled + read_write permission.
 */
export async function sendMessage(
  pool: Pool,
  connectionId: string,
  params: EmailSendParams,
): Promise<EmailSendResult> {
  const { connection, accessToken } = await resolveConnection(pool, connectionId);
  requireWritePermission(connection);
  const provider = getProvider(connection);
  return provider.sendMessage(accessToken, params);
}

/**
 * Create a draft email.
 * Requires: email feature enabled + read_write permission.
 */
export async function createDraft(
  pool: Pool,
  connectionId: string,
  params: EmailDraftParams,
): Promise<EmailMessage> {
  const { connection, accessToken } = await resolveConnection(pool, connectionId);
  requireWritePermission(connection);
  const provider = getProvider(connection);
  return provider.createDraft(accessToken, params);
}

/**
 * Update a draft email.
 * Requires: email feature enabled + read_write permission.
 */
export async function updateDraft(
  pool: Pool,
  connectionId: string,
  draftId: string,
  params: EmailDraftParams,
): Promise<EmailMessage> {
  const { connection, accessToken } = await resolveConnection(pool, connectionId);
  requireWritePermission(connection);
  const provider = getProvider(connection);
  return provider.updateDraft(accessToken, draftId, params);
}

/**
 * Update message state (read, starred, labels, move).
 * Requires: email feature enabled + read_write permission.
 */
export async function updateMessage(
  pool: Pool,
  connectionId: string,
  messageId: string,
  params: EmailUpdateParams,
): Promise<void> {
  const { connection, accessToken } = await resolveConnection(pool, connectionId);
  requireWritePermission(connection);
  const provider = getProvider(connection);
  return provider.updateMessage(accessToken, messageId, params);
}

/**
 * Delete an email message.
 * Requires: email feature enabled + read_write permission.
 */
export async function deleteMessage(
  pool: Pool,
  connectionId: string,
  messageId: string,
  permanent = false,
): Promise<void> {
  const { connection, accessToken } = await resolveConnection(pool, connectionId);
  requireWritePermission(connection);
  const provider = getProvider(connection);
  return provider.deleteMessage(accessToken, messageId, permanent);
}

/**
 * Download an attachment.
 * Requires: email feature enabled.
 */
export async function getAttachment(
  pool: Pool,
  connectionId: string,
  messageId: string,
  attachmentId: string,
): Promise<EmailAttachmentContent> {
  const { connection, accessToken } = await resolveConnection(pool, connectionId);
  const provider = getProvider(connection);
  return provider.getAttachment(accessToken, messageId, attachmentId);
}
