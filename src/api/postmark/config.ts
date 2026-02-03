/**
 * Postmark configuration and validation.
 * Part of Issue #293.
 */

import { getPostmarkTransactionalToken } from '../../email/postmark.js';

export interface PostmarkConfig {
  serverToken: string;
  fromEmail: string;
}

/**
 * Check if Postmark is configured with required environment variables.
 */
export function isPostmarkConfigured(): boolean {
  // POSTMARK_FROM_EMAIL is required for outbound
  if (!process.env.POSTMARK_FROM_EMAIL) {
    return false;
  }

  // Token can come from env var or file
  return !!(
    process.env.POSTMARK_TRANSACTIONAL_TOKEN ||
    process.env.POSTMARK_SERVER_TOKEN ||
    process.env.POSTMARK_TRANSACTIONAL_TOKEN_FILE
  );
}

/**
 * Get Postmark configuration from environment variables.
 * Throws if required configuration is missing.
 */
export async function getPostmarkConfig(): Promise<PostmarkConfig> {
  const fromEmail = process.env.POSTMARK_FROM_EMAIL;

  if (!fromEmail) {
    throw new Error('Postmark not configured. Required env var: POSTMARK_FROM_EMAIL');
  }

  // Try to get token from env or file
  const serverToken =
    process.env.POSTMARK_SERVER_TOKEN ||
    (await getPostmarkTransactionalToken());

  if (!serverToken) {
    throw new Error(
      'Postmark not configured. Required env var: POSTMARK_SERVER_TOKEN or POSTMARK_TRANSACTIONAL_TOKEN'
    );
  }

  return { serverToken, fromEmail };
}

/**
 * Synchronous check if we have the from email configured.
 * Used for quick validation before async token lookup.
 */
export function hasPostmarkFromEmail(): boolean {
  return !!process.env.POSTMARK_FROM_EMAIL;
}
