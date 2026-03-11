/**
 * OpenAPI path definitions for the Cloudflare Email inbound webhook.
 * Route: POST /cloudflare/email
 *
 * This endpoint receives parsed email payloads from a Cloudflare Email Worker.
 * It is NOT authenticated via Bearer token — it uses HMAC-SHA256 signature
 * verification via X-Cloudflare-Email-Signature (preferred) or the deprecated
 * X-Cloudflare-Email-Secret shared-secret header (backward compat).
 *
 * Part of Issue #210, #2061, #2062, #2411, #2412.
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonBody, jsonResponse } from '../helpers.ts';

export function cloudflareEmailPaths(): OpenApiDomainModule {
  return {
    tags: [
      {
        name: 'CloudflareEmail',
        description:
          'Inbound email webhook for Cloudflare Email Workers. ' +
          'Receives parsed email payloads, creates contacts and threads, ' +
          'and returns a triage decision (accept/reject) that the Worker ' +
          'uses to control SMTP-level acceptance.',
      },
    ],
    schemas: {
      CloudflareEmailPayload: {
        type: 'object',
        required: ['from', 'to', 'subject', 'headers', 'timestamp'],
        properties: {
          from: {
            type: 'string',
            description: 'Sender email address (from MIME From header or envelope)',
            example: 'sender@example.com',
          },
          to: {
            type: 'string',
            description: 'Recipient email address (envelope recipient)',
            example: 'support@myapp.com',
          },
          subject: {
            type: 'string',
            description: 'Email subject line',
            example: 'Question about my order',
          },
          text_body: {
            type: 'string',
            nullable: true,
            description: 'Plain text body extracted from MIME. Falls back to stripped HTML if absent.',
            example: 'Hi, I have a question about order #12345.',
          },
          html_body: {
            type: 'string',
            nullable: true,
            description: 'HTML body extracted from MIME.',
            example: '<p>Hi, I have a question about order #12345.</p>',
          },
          headers: {
            $ref: '#/components/schemas/CloudflareEmailHeaders',
          },
          raw: {
            type: 'string',
            nullable: true,
            description:
              'Full raw MIME message (optional). Only included when the Worker has INCLUDE_RAW_MIME=true. ' +
              'Useful for debugging but increases payload size significantly.',
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            description:
              'ISO 8601 timestamp when the Worker processed the email. ' +
              'Used for replay protection — payloads older than 5 minutes are rejected.',
            example: '2026-03-03T12:00:00.000Z',
          },
        },
      },
      CloudflareEmailHeaders: {
        type: 'object',
        description:
          'Email headers extracted by the Cloudflare Worker. ' +
          'Used for threading (Message-ID, In-Reply-To, References) and metadata.',
        properties: {
          'message-id': {
            type: 'string',
            description: 'RFC 5322 Message-ID header. Used as the external message key for deduplication.',
            example: '<unique-id-123@example.com>',
          },
          'in-reply-to': {
            type: 'string',
            nullable: true,
            description: 'In-Reply-To header. Links this email to the message it replies to, enabling threading.',
            example: '<original-id-456@example.com>',
          },
          references: {
            type: 'string',
            nullable: true,
            description: 'References header. Space-separated list of Message-IDs in the thread chain.',
            example: '<original-id-456@example.com> <reply-id-789@example.com>',
          },
        },
        additionalProperties: {
          type: 'string',
          description: 'Additional headers the Worker may include (date, list-id, etc.)',
        },
      },
      CloudflareEmailWebhookResponse: {
        type: 'object',
        required: ['success', 'action'],
        description:
          'Webhook response controlling the Worker triage decision. ' +
          'The Worker inspects `action` to decide whether to accept or reject the email at the SMTP level.',
        properties: {
          success: {
            type: 'boolean',
            description: 'Whether the webhook processed the payload successfully',
            example: true,
          },
          action: {
            type: 'string',
            enum: ['accept', 'reject'],
            description:
              'Triage decision. "accept" means the email is routed to an agent. ' +
              '"reject" signals the Worker to return an SMTP 550 bounce via message.setReject().',
            example: 'accept',
          },
          reject_reason: {
            type: 'string',
            nullable: true,
            description: 'Human-readable reason when action is "reject". Sent as the SMTP rejection reason.',
            example: 'No agent configured for this address',
          },
          receipt_id: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description: 'Database ID of the stored message (present on both accept and reject)',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          contact_id: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description: 'Database ID of the sender contact (created or matched)',
            example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
          },
          thread_id: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description: 'Database ID of the email thread',
            example: 'b2c3d4e5-6789-01ab-cdef-2345678901bc',
          },
          message_id: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description: 'Database ID of the stored email message',
            example: 'c3d4e5f6-7890-12ab-cdef-3456789012cd',
          },
          auto_reply: {
            $ref: '#/components/schemas/CloudflareEmailAutoReply',
          },
        },
      },
      CloudflareEmailAutoReply: {
        type: 'object',
        nullable: true,
        required: ['subject', 'text_body'],
        description:
          'Optional auto-reply content. When present, the Worker constructs a MIME reply ' +
          'and sends it back to the sender via message.reply(). Only included when action is "accept".',
        properties: {
          subject: {
            type: 'string',
            description: 'Subject line for the reply (typically "Re: <original subject>")',
            example: 'Re: Question about my order',
          },
          text_body: {
            type: 'string',
            description: 'Plain text body of the auto-reply',
            example: 'Thank you for your message. An agent will respond shortly.',
          },
          html_body: {
            type: 'string',
            nullable: true,
            description: 'HTML body of the auto-reply (optional)',
            example: '<p>Thank you for your message. An agent will respond shortly.</p>',
          },
        },
      },
    },
    paths: {
      '/cloudflare/email': {
        post: {
          operationId: 'receiveCloudflareEmail',
          summary: 'Receive inbound email from Cloudflare Email Worker',
          description:
            'Webhook endpoint for Cloudflare Email Workers. Receives a parsed email payload, ' +
            'creates or matches the sender contact, threads the email using Message-ID/In-Reply-To/References, ' +
            'stores the message, and returns a triage decision.\n\n' +
            '**Authentication:** Preferred: HMAC-SHA256 via `X-Cloudflare-Email-Signature` header ' +
            '(`sha256=<hex>` computed over the raw request body). ' +
            'Deprecated fallback: static `X-Cloudflare-Email-Secret` shared secret header. ' +
            'Both are verified using timing-safe comparison.\n\n' +
            '**Triage flow:**\n' +
            '1. Email is always stored (contact, thread, message created)\n' +
            '2. Route resolver checks `inbound_destination` for the recipient address\n' +
            '3. Falls back to `channel_default` for the email channel\n' +
            '4. If a route is found → `action: "accept"`, webhook dispatched to agent\n' +
            '5. If no route → `action: "reject"`, Worker bounces the email via SMTP 550\n\n' +
            '**Threading:** Emails are grouped into threads using the Message-ID header as the external key. ' +
            'Replies are linked to existing threads via the In-Reply-To and References headers.\n\n' +
            '**Idempotency:** Duplicate messages (same Message-ID + thread) are upserted, not duplicated.\n\n' +
            '**Replay protection:** Payloads with timestamps older than 5 minutes are rejected (400).\n\n' +
            'See `examples/cloudflare-email-worker/` for the reference Worker implementation.',
          tags: ['CloudflareEmail'],
          security: [], // Not using Bearer auth
          parameters: [
            {
              name: 'X-Cloudflare-Email-Signature',
              in: 'header',
              required: false,
              description:
                'HMAC-SHA256 signature over the raw request body, formatted as `sha256=<hex>`. ' +
                'Computed using the CLOUDFLARE_EMAIL_SECRET as the HMAC key. ' +
                'This is the preferred authentication method (Issue #2411).',
              schema: { type: 'string' },
              example: 'sha256=a1b2c3d4e5f6...',
            },
            {
              name: 'X-Cloudflare-Email-Secret',
              in: 'header',
              required: false,
              deprecated: true,
              description:
                'Deprecated: Static shared secret for authenticating the Cloudflare Worker. ' +
                'Must match the CLOUDFLARE_EMAIL_SECRET environment variable. ' +
                'Migrate to X-Cloudflare-Email-Signature for HMAC-based verification.',
              schema: { type: 'string' },
              example: 'your-shared-secret-here',
            },
          ],
          requestBody: jsonBody({
            $ref: '#/components/schemas/CloudflareEmailPayload',
          }),
          responses: {
            '200': jsonResponse(
              'Email processed — check `action` field for triage decision',
              { $ref: '#/components/schemas/CloudflareEmailWebhookResponse' },
            ),
            ...errorResponses(400, 401, 500),
          },
        },
      },
    },
  };
}
