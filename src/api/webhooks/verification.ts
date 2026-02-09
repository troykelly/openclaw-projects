/**
 * Webhook signature verification for inbound webhooks.
 * Part of Issue #224.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { readFileSync } from 'fs';
import type { FastifyRequest } from 'fastify';

/**
 * Get a secret from environment variable or file.
 * Supports:
 * - Direct value: FOO=secret
 * - File-based: FOO_FILE=/path/to/secret
 */
function getSecretFromEnvSync(prefix: string): string | null {
  const value = process.env[prefix];
  if (value) return value;

  const filePath = process.env[`${prefix}_FILE`];
  if (filePath) {
    try {
      return readFileSync(filePath, 'utf-8').trim();
    } catch {
      return null;
    }
  }

  // Command-based secrets not supported in sync version
  return null;
}

/**
 * Twilio webhook signature verifier.
 * Validates X-Twilio-Signature header using HMAC-SHA1.
 *
 * @see https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function verifyTwilioSignature(request: FastifyRequest): boolean {
  const authToken = getSecretFromEnvSync('TWILIO_AUTH_TOKEN');
  if (!authToken) {
    console.warn('[Webhook] TWILIO_AUTH_TOKEN not configured, rejecting request');
    return false;
  }

  const signature = request.headers['x-twilio-signature'] as string | undefined;
  if (!signature) {
    return false;
  }

  // Get the full URL including the protocol
  const url = getFullUrl(request);

  // Get sorted POST parameters
  const body = (request.body as Record<string, string>) || {};
  const paramString = Object.keys(body)
    .sort()
    .reduce((acc, key) => acc + key + body[key], '');

  const data = url + paramString;

  const expectedSignature = createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');

  try {
    return timingSafeEqual(Buffer.from(signature, 'base64'), Buffer.from(expectedSignature, 'base64'));
  } catch {
    return false;
  }
}

/**
 * Postmark webhook authentication using Basic Auth.
 * Postmark doesn't provide signatures, so we use HTTP Basic Auth.
 */
export function verifyPostmarkAuth(request: FastifyRequest): boolean {
  const expectedUsername = getSecretFromEnvSync('POSTMARK_WEBHOOK_USERNAME');
  const expectedPassword = getSecretFromEnvSync('POSTMARK_WEBHOOK_PASSWORD');

  // If not configured, allow (for development) but warn
  if (!expectedUsername || !expectedPassword) {
    console.warn('[Webhook] POSTMARK_WEBHOOK_USERNAME/PASSWORD not configured');
    // Check if we're in development mode
    if (process.env.NODE_ENV === 'development' || process.env.OPENCLAW_PROJECTS_AUTH_DISABLED === 'true') {
      return true;
    }
    return false;
  }

  const authHeader = request.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return false;
  }

  try {
    const credentials = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
    const [username, password] = credentials.split(':');

    // Use timing-safe comparison
    const usernameMatch = timingSafeEqual(Buffer.from(username || ''), Buffer.from(expectedUsername));
    const passwordMatch = timingSafeEqual(Buffer.from(password || ''), Buffer.from(expectedPassword));

    return usernameMatch && passwordMatch;
  } catch {
    return false;
  }
}

/**
 * Cloudflare Email Workers webhook verification.
 * Uses a shared secret in X-Cloudflare-Email-Secret header.
 */
export function verifyCloudflareEmailSecret(request: FastifyRequest): boolean {
  const expectedSecret = getSecretFromEnvSync('CLOUDFLARE_EMAIL_SECRET');
  if (!expectedSecret) {
    console.warn('[Webhook] CLOUDFLARE_EMAIL_SECRET not configured');
    if (process.env.NODE_ENV === 'development' || process.env.OPENCLAW_PROJECTS_AUTH_DISABLED === 'true') {
      return true;
    }
    return false;
  }

  const providedSecret = request.headers['x-cloudflare-email-secret'] as string | undefined;
  if (!providedSecret) {
    return false;
  }

  try {
    return timingSafeEqual(Buffer.from(providedSecret), Buffer.from(expectedSecret));
  } catch {
    return false;
  }
}

/**
 * Generic webhook HMAC-SHA256 verification.
 * Can be used for custom integrations.
 */
export function verifyHmacSha256(request: FastifyRequest, secretEnvVar: string, signatureHeader: string = 'x-signature'): boolean {
  const secret = getSecretFromEnvSync(secretEnvVar);
  if (!secret) {
    return false;
  }

  const signature = request.headers[signatureHeader.toLowerCase()] as string | undefined;
  if (!signature) {
    return false;
  }

  const body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);

  const expectedSignature = createHmac('sha256', secret).update(Buffer.from(body, 'utf-8')).digest('hex');

  // Handle signatures with or without prefix (sha256=...)
  const cleanSignature = signature.startsWith('sha256=') ? signature.slice(7) : signature;

  try {
    return timingSafeEqual(Buffer.from(cleanSignature, 'hex'), Buffer.from(expectedSignature, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Get the full URL from a Fastify request.
 */
function getFullUrl(request: FastifyRequest): string {
  const protocol = request.protocol || 'https';
  const host = request.headers['host'] || request.hostname;
  const url = request.url;
  return `${protocol}://${host}${url}`;
}

/**
 * Webhook verifier types.
 */
export type WebhookProvider = 'twilio' | 'postmark' | 'cloudflare' | 'generic';

/**
 * Verify a webhook request based on provider.
 */
export function verifyWebhook(request: FastifyRequest, provider: WebhookProvider): boolean {
  switch (provider) {
    case 'twilio':
      return verifyTwilioSignature(request);
    case 'postmark':
      return verifyPostmarkAuth(request);
    case 'cloudflare':
      return verifyCloudflareEmailSecret(request);
    case 'generic':
      return verifyHmacSha256(request, 'GENERIC_WEBHOOK_SECRET');
    default:
      return false;
  }
}

/**
 * Check if webhook verification is configured for a provider.
 */
export function isWebhookVerificationConfigured(provider: WebhookProvider): boolean {
  switch (provider) {
    case 'twilio':
      return !!getSecretFromEnvSync('TWILIO_AUTH_TOKEN');
    case 'postmark':
      return !!(getSecretFromEnvSync('POSTMARK_WEBHOOK_USERNAME') && getSecretFromEnvSync('POSTMARK_WEBHOOK_PASSWORD'));
    case 'cloudflare':
      return !!getSecretFromEnvSync('CLOUDFLARE_EMAIL_SECRET');
    case 'generic':
      return !!getSecretFromEnvSync('GENERIC_WEBHOOK_SECRET');
    default:
      return false;
  }
}
