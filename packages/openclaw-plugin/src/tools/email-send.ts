/**
 * email_send tool implementation.
 * Sends email messages via Postmark.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';

/** Email validation regex (simplified, allowing most valid emails) */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Maximum subject line length (RFC 2822 recommends 78, but we allow up to 998) */
const MAX_SUBJECT_LENGTH = 998;

/** Parameters for email_send tool */
export const EmailSendParamsSchema = z.object({
  to: z.string().regex(EMAIL_REGEX, 'Invalid email address format'),
  subject: z.string().min(1, 'Subject cannot be empty').max(MAX_SUBJECT_LENGTH, `Subject must be ${MAX_SUBJECT_LENGTH} characters or less`),
  body: z.string().min(1, 'Email body cannot be empty'),
  html_body: z.string().optional(),
  thread_id: z.string().optional(),
  idempotency_key: z.string().optional(),
});
export type EmailSendParams = z.infer<typeof EmailSendParamsSchema>;

/** Email send response from API */
interface EmailSendApiResponse {
  message_id: string;
  thread_id?: string;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'delivered';
}

/** Successful tool result */
export interface EmailSendSuccess {
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
export interface EmailSendFailure {
  success: false;
  error: string;
}

/** Tool result type */
export type EmailSendResult = EmailSendSuccess | EmailSendFailure;

/** Tool configuration */
export interface EmailSendToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

/** Tool definition */
export interface EmailSendTool {
  name: string;
  description: string;
  parameters: typeof EmailSendParamsSchema;
  execute: (params: EmailSendParams) => Promise<EmailSendResult>;
}

/**
 * Sanitize email addresses from error messages for privacy.
 */
function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Remove email addresses from error messages
    const sanitized = error.message.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]');
    return sanitized;
  }
  return 'An unexpected error occurred while sending email.';
}

/**
 * Creates the email_send tool.
 */
export function createEmailSendTool(options: EmailSendToolOptions): EmailSendTool {
  const { client, logger, user_id } = options;

  return {
    name: 'email_send',
    description: 'Send an email message. Use when you need to communicate via email. ' + 'Requires the recipient email address, subject, and body.',
    parameters: EmailSendParamsSchema,

    async execute(params: EmailSendParams): Promise<EmailSendResult> {
      // Validate parameters
      const parseResult = EmailSendParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { to, subject, body, html_body, thread_id, idempotency_key } = parseResult.data;

      // Log invocation (without email address for privacy)
      logger.info('email_send invoked', {
        user_id,
        subjectLength: subject.length,
        bodyLength: body.length,
        hasHtmlBody: !!html_body,
        hasThreadId: !!thread_id,
        hasIdempotencyKey: !!idempotency_key,
      });

      try {
        // Call API
        const response = await client.post<EmailSendApiResponse>(
          '/api/postmark/email/send',
          {
            to,
            subject,
            body,
            html_body,
            thread_id,
            idempotency_key,
          },
          { user_id },
        );

        if (!response.success) {
          logger.error('email_send API error', {
            user_id,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to send email',
          };
        }

        const { message_id, thread_id: responseThreadId, status } = response.data;

        logger.debug('email_send completed', {
          user_id,
          message_id,
          status,
        });

        return {
          success: true,
          data: {
            content: `Email sent successfully (ID: ${message_id}, Status: ${status})`,
            details: {
              message_id,
              thread_id: responseThreadId,
              status,
              user_id,
            },
          },
        };
      } catch (error) {
        logger.error('email_send failed', {
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
