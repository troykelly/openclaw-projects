/**
 * sms_send tool implementation.
 * Sends SMS messages via Twilio.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';

/** E.164 phone number regex */
const E164_REGEX = /^\+[1-9]\d{1,14}$/;

/** Maximum SMS body length (Twilio standard) */
const MAX_BODY_LENGTH = 1600;

/** Parameters for sms_send tool */
export const SmsSendParamsSchema = z.object({
  to: z.string().regex(E164_REGEX, 'Phone number must be in E.164 format (e.g., +15551234567)'),
  body: z.string().min(1, 'Message body cannot be empty').max(MAX_BODY_LENGTH, `Message body must be ${MAX_BODY_LENGTH} characters or less`),
  idempotency_key: z.string().optional(),
});
export type SmsSendParams = z.infer<typeof SmsSendParamsSchema>;

/** SMS send response from API */
interface SmsSendApiResponse {
  message_id: string;
  thread_id?: string;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'delivered';
}

/** Successful tool result */
export interface SmsSendSuccess {
  success: true;
  data: {
    content: string;
    details: {
      message_id: string;
      thread_id?: string;
      status: string;
      user_id: string;
    };
  };
}

/** Failed tool result */
export interface SmsSendFailure {
  success: false;
  error: string;
}

/** Tool result type */
export type SmsSendResult = SmsSendSuccess | SmsSendFailure;

/** Tool configuration */
export interface SmsSendToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

/** Tool definition */
export interface SmsSendTool {
  name: string;
  description: string;
  parameters: typeof SmsSendParamsSchema;
  execute: (params: SmsSendParams) => Promise<SmsSendResult>;
}

/**
 * Sanitize phone numbers from error messages for privacy.
 */
function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Remove phone numbers from error messages
    const sanitized = error.message.replace(/\+\d{1,15}/g, '[phone]');
    return sanitized;
  }
  return 'An unexpected error occurred while sending SMS.';
}

/**
 * Check if Twilio is configured.
 */
function isTwilioConfigured(config: PluginConfig): boolean {
  return !!(config.twilioAccountSid && config.twilioAuthToken && config.twilioPhoneNumber);
}

/**
 * Creates the sms_send tool.
 */
export function createSmsSendTool(options: SmsSendToolOptions): SmsSendTool {
  const { client, logger, config, user_id } = options;

  return {
    name: 'sms_send',
    description:
      'Send an SMS message to a phone number. Use when you need to notify someone via text message. ' +
      'Requires the recipient phone number in E.164 format (e.g., +15551234567).',
    parameters: SmsSendParamsSchema,

    async execute(params: SmsSendParams): Promise<SmsSendResult> {
      // Validate parameters
      const parseResult = SmsSendParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { to, body, idempotency_key } = parseResult.data;

      // Check Twilio configuration
      if (!isTwilioConfigured(config)) {
        return {
          success: false,
          error: 'Twilio is not configured. Please configure Twilio credentials.',
        };
      }

      // Log invocation (without phone number for privacy)
      logger.info('sms_send invoked', {
        user_id,
        bodyLength: body.length,
        hasIdempotencyKey: !!idempotency_key,
      });

      try {
        // Call API
        const response = await client.post<SmsSendApiResponse>(
          '/api/twilio/sms/send',
          {
            to,
            body,
            idempotency_key,
          },
          { user_id },
        );

        if (!response.success) {
          logger.error('sms_send API error', {
            user_id,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to send SMS',
          };
        }

        const { message_id, thread_id, status } = response.data;

        logger.debug('sms_send completed', {
          user_id,
          message_id,
          status,
        });

        return {
          success: true,
          data: {
            content: `SMS sent successfully (ID: ${message_id}, Status: ${status})`,
            details: {
              message_id,
              thread_id,
              status,
              user_id,
            },
          },
        };
      } catch (error) {
        logger.error('sms_send failed', {
          user_id,
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          success: false,
          error: sanitizeErrorMessage(error),
        };
      }
    },
  };
}
