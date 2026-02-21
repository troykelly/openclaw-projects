/**
 * OpenAPI path definitions for email endpoints.
 * Routes: GET /api/email/messages, GET /api/email/messages/:message_id,
 *         GET /api/email/threads, GET /api/email/threads/:thread_id,
 *         GET /api/email/folders, POST /api/email/messages/send,
 *         POST /api/email/drafts, PATCH /api/email/drafts/:draft_id,
 *         PATCH /api/email/messages/:message_id, DELETE /api/email/messages/:message_id,
 *         GET /api/email/messages/:message_id/attachments/:attachment_id,
 *         POST /api/sync/emails,
 *         GET /api/emails, POST /api/emails/send, POST /api/emails/create-work-item
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonBody, jsonResponse } from '../helpers.ts';

export function emailPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Email', description: 'Live email access via connected OAuth providers (Gmail, Outlook)' },
      { name: 'EmailLegacy', description: 'Legacy email endpoints for backward compatibility' },
    ],
    schemas: {
      EmailRecipient: {
        type: 'object',
        required: ['email'],
        properties: {
          email: {
            type: 'string',
            description: 'Email address of the recipient',
            example: 'alice@example.com',
          },
          name: {
            type: 'string',
            description: 'Display name of the recipient',
            example: 'Alice Smith',
          },
        },
      },
      EmailMessage: {
        type: 'object',
        required: ['id', 'subject', 'from', 'to', 'date', 'is_read', 'is_starred', 'has_attachments'],
        properties: {
          id: {
            type: 'string',
            description: 'Provider-specific message identifier',
            example: '18d4f2e3a4b5c6d7',
          },
          thread_id: {
            type: 'string',
            nullable: true,
            description: 'Provider-specific thread identifier this message belongs to',
            example: '18d4f2e3a4b5c6d0',
          },
          subject: {
            type: 'string',
            description: 'Email subject line',
            example: 'Re: Project Update',
          },
          from: {
            $ref: '#/components/schemas/EmailRecipient',
            description: 'Sender of the email',
          },
          to: {
            type: 'array',
            items: { $ref: '#/components/schemas/EmailRecipient' },
            description: 'Primary recipients of the email',
          },
          cc: {
            type: 'array',
            items: { $ref: '#/components/schemas/EmailRecipient' },
            description: 'Carbon copy recipients',
          },
          bcc: {
            type: 'array',
            items: { $ref: '#/components/schemas/EmailRecipient' },
            description: 'Blind carbon copy recipients',
          },
          body_text: {
            type: 'string',
            nullable: true,
            description: 'Plain text body of the email',
            example: 'Hi team, here is the latest update on the project...',
          },
          body_html: {
            type: 'string',
            nullable: true,
            description: 'HTML body of the email',
            example: '<p>Hi team, here is the latest update on the project...</p>',
          },
          date: {
            type: 'string',
            format: 'date-time',
            description: 'Date and time the email was sent or received',
            example: '2026-02-21T14:30:00Z',
          },
          is_read: {
            type: 'boolean',
            description: 'Whether the email has been marked as read',
            example: false,
          },
          is_starred: {
            type: 'boolean',
            description: 'Whether the email has been starred or flagged',
            example: false,
          },
          labels: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of provider labels or categories applied to this message',
            example: ['INBOX', 'IMPORTANT'],
          },
          has_attachments: {
            type: 'boolean',
            description: 'Whether the email has file attachments',
            example: true,
          },
        },
      },
      EmailThread: {
        type: 'object',
        required: ['id', 'subject', 'snippet', 'messages', 'message_count'],
        properties: {
          id: {
            type: 'string',
            description: 'Provider-specific thread identifier',
            example: '18d4f2e3a4b5c6d0',
          },
          subject: {
            type: 'string',
            description: 'Subject line of the thread (from the first message)',
            example: 'Re: Project Update',
          },
          snippet: {
            type: 'string',
            description: 'Short preview of the most recent message in the thread',
            example: 'Hi team, here is the latest update...',
          },
          messages: {
            type: 'array',
            items: { $ref: '#/components/schemas/EmailMessage' },
            description: 'All messages in the thread ordered chronologically',
          },
          message_count: {
            type: 'integer',
            description: 'Total number of messages in the thread',
            example: 5,
          },
        },
      },
      EmailFolder: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: {
            type: 'string',
            description: 'Provider-specific folder or label identifier',
            example: 'INBOX',
          },
          name: {
            type: 'string',
            description: 'Human-readable folder or label name',
            example: 'Inbox',
          },
          type: {
            type: 'string',
            nullable: true,
            description: 'System folder type (e.g. inbox, sent, drafts, trash) or null for custom labels',
            example: 'inbox',
          },
          message_count: {
            type: 'integer',
            nullable: true,
            description: 'Total number of messages in this folder',
            example: 1250,
          },
          unread_count: {
            type: 'integer',
            nullable: true,
            description: 'Number of unread messages in this folder',
            example: 23,
          },
        },
      },
    },
    paths: {
      '/api/email/messages': {
        get: {
          operationId: 'listEmailMessages',
          summary: 'List or search emails via provider API',
          description: 'Lists emails from a connected provider with optional filtering by folder, query, and labels.',
          tags: ['Email'],
          parameters: [
            {
              name: 'connection_id',
              in: 'query',
              required: true,
              description: 'UUID of the OAuth connection to fetch emails from',
              schema: { type: 'string', format: 'uuid' },
              example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
            },
            {
              name: 'folder_id',
              in: 'query',
              description: 'Folder or label ID to filter messages by',
              schema: { type: 'string' },
              example: 'INBOX',
            },
            {
              name: 'q',
              in: 'query',
              description: 'Search query string (provider-specific syntax, e.g. Gmail search operators)',
              schema: { type: 'string' },
              example: 'from:bob@example.com subject:project',
            },
            {
              name: 'max_results',
              in: 'query',
              description: 'Maximum number of messages to return',
              schema: { type: 'integer' },
              example: 25,
            },
            {
              name: 'page_token',
              in: 'query',
              description: 'Pagination token from a previous response',
              schema: { type: 'string' },
              example: 'CiAKGjBpNDd2Nmp2Zml2cXRwYjBpOXA',
            },
            {
              name: 'include_spam_trash',
              in: 'query',
              description: 'Include messages from spam and trash folders',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'false',
            },
            {
              name: 'label_ids',
              in: 'query',
              description: 'Comma-separated label IDs to filter messages by',
              schema: { type: 'string' },
              example: 'IMPORTANT,STARRED',
            },
          ],
          responses: {
            '200': jsonResponse('Email messages', {
              type: 'object',
              properties: {
                messages: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/EmailMessage' },
                  description: 'List of email messages matching the query',
                },
                next_page_token: {
                  type: 'string',
                  nullable: true,
                  description: 'Token to fetch the next page of results, or null if no more pages',
                  example: 'CiAKGjBpNDd2Nmp2Zml2cXRwYjBpOXA',
                },
              },
            }),
            ...errorResponses(400, 401, 500, 502),
          },
        },
      },
      '/api/email/messages/{message_id}': {
        get: {
          operationId: 'getEmailMessage',
          summary: 'Get a single email message',
          description: 'Returns the full email message including body content.',
          tags: ['Email'],
          parameters: [
            {
              name: 'message_id',
              in: 'path',
              required: true,
              description: 'Provider-specific message identifier',
              schema: { type: 'string' },
              example: '18d4f2e3a4b5c6d7',
            },
            {
              name: 'connection_id',
              in: 'query',
              required: true,
              description: 'UUID of the OAuth connection to fetch the message from',
              schema: { type: 'string', format: 'uuid' },
              example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
            },
          ],
          responses: {
            '200': jsonResponse('Email message', { $ref: '#/components/schemas/EmailMessage' }),
            ...errorResponses(400, 401, 404, 500, 502),
          },
        },
        patch: {
          operationId: 'updateEmailMessage',
          summary: 'Update message state',
          description: 'Updates read status, star status, labels, or moves the message to a different folder.',
          tags: ['Email'],
          parameters: [
            {
              name: 'message_id',
              in: 'path',
              required: true,
              description: 'Provider-specific message identifier',
              schema: { type: 'string' },
              example: '18d4f2e3a4b5c6d7',
            },
          ],
          requestBody: jsonBody({
            type: 'object',
            required: ['connection_id'],
            properties: {
              connection_id: {
                type: 'string',
                format: 'uuid',
                description: 'UUID of the OAuth connection the message belongs to',
                example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
              },
              is_read: {
                type: 'boolean',
                description: 'Set the read status of the message',
                example: true,
              },
              is_starred: {
                type: 'boolean',
                description: 'Set the starred/flagged status of the message',
                example: false,
              },
              add_labels: {
                type: 'array',
                items: { type: 'string' },
                description: 'Label IDs to add to the message',
                example: ['IMPORTANT'],
              },
              remove_labels: {
                type: 'array',
                items: { type: 'string' },
                description: 'Label IDs to remove from the message',
                example: ['UNREAD'],
              },
              move_to: {
                type: 'string',
                description: 'Folder ID to move the message to',
                example: 'TRASH',
              },
            },
          }),
          responses: {
            '204': { description: 'Message updated' },
            ...errorResponses(400, 401, 404, 500, 502),
          },
        },
        delete: {
          operationId: 'deleteEmailMessage',
          summary: 'Delete an email message',
          description: 'Moves a message to trash, or permanently deletes it if permanent=true.',
          tags: ['Email'],
          parameters: [
            {
              name: 'message_id',
              in: 'path',
              required: true,
              description: 'Provider-specific message identifier',
              schema: { type: 'string' },
              example: '18d4f2e3a4b5c6d7',
            },
            {
              name: 'connection_id',
              in: 'query',
              required: true,
              description: 'UUID of the OAuth connection the message belongs to',
              schema: { type: 'string', format: 'uuid' },
              example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
            },
            {
              name: 'permanent',
              in: 'query',
              description: 'Permanently delete the message instead of moving to trash',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'false',
            },
          ],
          responses: {
            '204': { description: 'Message deleted' },
            ...errorResponses(400, 401, 404, 500, 502),
          },
        },
      },
      '/api/email/threads': {
        get: {
          operationId: 'listEmailThreads',
          summary: 'List email threads',
          description: 'Lists email threads from a connected provider with optional filtering.',
          tags: ['Email'],
          parameters: [
            {
              name: 'connection_id',
              in: 'query',
              required: true,
              description: 'UUID of the OAuth connection to fetch threads from',
              schema: { type: 'string', format: 'uuid' },
              example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
            },
            {
              name: 'folder_id',
              in: 'query',
              description: 'Folder or label ID to filter threads by',
              schema: { type: 'string' },
              example: 'INBOX',
            },
            {
              name: 'q',
              in: 'query',
              description: 'Search query string (provider-specific syntax)',
              schema: { type: 'string' },
              example: 'from:bob@example.com',
            },
            {
              name: 'max_results',
              in: 'query',
              description: 'Maximum number of threads to return',
              schema: { type: 'integer' },
              example: 25,
            },
            {
              name: 'page_token',
              in: 'query',
              description: 'Pagination token from a previous response',
              schema: { type: 'string' },
              example: 'CiAKGjBpNDd2Nmp2Zml2cXRwYjBpOXA',
            },
            {
              name: 'include_spam_trash',
              in: 'query',
              description: 'Include threads from spam and trash folders',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'false',
            },
            {
              name: 'label_ids',
              in: 'query',
              description: 'Comma-separated label IDs to filter threads by',
              schema: { type: 'string' },
              example: 'IMPORTANT,STARRED',
            },
          ],
          responses: {
            '200': jsonResponse('Email threads', {
              type: 'object',
              properties: {
                threads: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/EmailThread' },
                  description: 'List of email threads matching the query',
                },
                next_page_token: {
                  type: 'string',
                  nullable: true,
                  description: 'Token to fetch the next page of results, or null if no more pages',
                  example: 'CiAKGjBpNDd2Nmp2Zml2cXRwYjBpOXA',
                },
              },
            }),
            ...errorResponses(400, 401, 500, 502),
          },
        },
      },
      '/api/email/threads/{thread_id}': {
        get: {
          operationId: 'getEmailThread',
          summary: 'Get a full email thread',
          description: 'Returns a complete email thread with all messages.',
          tags: ['Email'],
          parameters: [
            {
              name: 'thread_id',
              in: 'path',
              required: true,
              description: 'Provider-specific thread identifier',
              schema: { type: 'string' },
              example: '18d4f2e3a4b5c6d0',
            },
            {
              name: 'connection_id',
              in: 'query',
              required: true,
              description: 'UUID of the OAuth connection to fetch the thread from',
              schema: { type: 'string', format: 'uuid' },
              example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
            },
          ],
          responses: {
            '200': jsonResponse('Email thread', { $ref: '#/components/schemas/EmailThread' }),
            ...errorResponses(400, 401, 404, 500, 502),
          },
        },
      },
      '/api/email/folders': {
        get: {
          operationId: 'listEmailFolders',
          summary: 'List email folders/labels',
          description: 'Returns the list of available email folders or labels from the provider.',
          tags: ['Email'],
          parameters: [
            {
              name: 'connection_id',
              in: 'query',
              required: true,
              description: 'UUID of the OAuth connection to list folders from',
              schema: { type: 'string', format: 'uuid' },
              example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
            },
          ],
          responses: {
            '200': jsonResponse('Folders', {
              type: 'object',
              properties: {
                folders: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/EmailFolder' },
                  description: 'List of email folders or labels from the provider',
                },
              },
            }),
            ...errorResponses(400, 401, 500, 502),
          },
        },
      },
      '/api/email/messages/send': {
        post: {
          operationId: 'sendEmail',
          summary: 'Send an email via provider API',
          description: 'Sends an email through the connected OAuth provider. Supports replies and thread continuation.',
          tags: ['Email'],
          requestBody: jsonBody({
            type: 'object',
            required: ['connection_id', 'to', 'subject'],
            properties: {
              connection_id: {
                type: 'string',
                format: 'uuid',
                description: 'UUID of the OAuth connection to send the email through',
                example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
              },
              to: {
                type: 'array',
                items: { $ref: '#/components/schemas/EmailRecipient' },
                description: 'Primary recipients of the email',
              },
              cc: {
                type: 'array',
                items: { $ref: '#/components/schemas/EmailRecipient' },
                description: 'Carbon copy recipients',
              },
              bcc: {
                type: 'array',
                items: { $ref: '#/components/schemas/EmailRecipient' },
                description: 'Blind carbon copy recipients',
              },
              subject: {
                type: 'string',
                description: 'Email subject line',
                example: 'Re: Project Update',
              },
              body_text: {
                type: 'string',
                description: 'Plain text body of the email',
                example: 'Hi team, here is the latest update on the project...',
              },
              body_html: {
                type: 'string',
                description: 'HTML body of the email',
                example: '<p>Hi team, here is the latest update on the project...</p>',
              },
              reply_to_message_id: {
                type: 'string',
                description: 'Provider message ID to reply to (sets In-Reply-To header)',
                example: '18d4f2e3a4b5c6d7',
              },
              thread_id: {
                type: 'string',
                description: 'Provider thread ID to continue the conversation in',
                example: '18d4f2e3a4b5c6d0',
              },
            },
          }),
          responses: {
            '200': jsonResponse('Sent message', { $ref: '#/components/schemas/EmailMessage' }),
            ...errorResponses(400, 401, 500, 502),
          },
        },
      },
      '/api/email/drafts': {
        post: {
          operationId: 'createEmailDraft',
          summary: 'Create a draft email',
          description: 'Creates a new draft email in the connected provider.',
          tags: ['Email'],
          requestBody: jsonBody({
            type: 'object',
            required: ['connection_id'],
            properties: {
              connection_id: {
                type: 'string',
                format: 'uuid',
                description: 'UUID of the OAuth connection to create the draft in',
                example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
              },
              to: {
                type: 'array',
                items: { $ref: '#/components/schemas/EmailRecipient' },
                description: 'Primary recipients of the draft',
              },
              cc: {
                type: 'array',
                items: { $ref: '#/components/schemas/EmailRecipient' },
                description: 'Carbon copy recipients',
              },
              bcc: {
                type: 'array',
                items: { $ref: '#/components/schemas/EmailRecipient' },
                description: 'Blind carbon copy recipients',
              },
              subject: {
                type: 'string',
                description: 'Email subject line',
                example: 'Draft: Project Proposal',
              },
              body_text: {
                type: 'string',
                description: 'Plain text body of the draft',
                example: 'Hi team, I am working on the project proposal...',
              },
              body_html: {
                type: 'string',
                description: 'HTML body of the draft',
                example: '<p>Hi team, I am working on the project proposal...</p>',
              },
              reply_to_message_id: {
                type: 'string',
                description: 'Provider message ID this draft is replying to',
                example: '18d4f2e3a4b5c6d7',
              },
              thread_id: {
                type: 'string',
                description: 'Provider thread ID this draft belongs to',
                example: '18d4f2e3a4b5c6d0',
              },
            },
          }),
          responses: {
            '201': jsonResponse('Draft created', { $ref: '#/components/schemas/EmailMessage' }),
            ...errorResponses(400, 401, 500, 502),
          },
        },
      },
      '/api/email/drafts/{draft_id}': {
        patch: {
          operationId: 'updateEmailDraft',
          summary: 'Update a draft email',
          description: 'Updates an existing draft email in the connected provider.',
          tags: ['Email'],
          parameters: [
            {
              name: 'draft_id',
              in: 'path',
              required: true,
              description: 'Provider-specific draft identifier',
              schema: { type: 'string' },
              example: '18d4f2e3a4b5c6d9',
            },
          ],
          requestBody: jsonBody({
            type: 'object',
            required: ['connection_id'],
            properties: {
              connection_id: {
                type: 'string',
                format: 'uuid',
                description: 'UUID of the OAuth connection the draft belongs to',
                example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
              },
              to: {
                type: 'array',
                items: { $ref: '#/components/schemas/EmailRecipient' },
                description: 'Updated primary recipients',
              },
              cc: {
                type: 'array',
                items: { $ref: '#/components/schemas/EmailRecipient' },
                description: 'Updated carbon copy recipients',
              },
              bcc: {
                type: 'array',
                items: { $ref: '#/components/schemas/EmailRecipient' },
                description: 'Updated blind carbon copy recipients',
              },
              subject: {
                type: 'string',
                description: 'Updated email subject line',
                example: 'Draft: Project Proposal v2',
              },
              body_text: {
                type: 'string',
                description: 'Updated plain text body',
                example: 'Hi team, here is the revised project proposal...',
              },
              body_html: {
                type: 'string',
                description: 'Updated HTML body',
                example: '<p>Hi team, here is the revised project proposal...</p>',
              },
              thread_id: {
                type: 'string',
                description: 'Provider thread ID this draft belongs to',
                example: '18d4f2e3a4b5c6d0',
              },
            },
          }),
          responses: {
            '200': jsonResponse('Updated draft', { $ref: '#/components/schemas/EmailMessage' }),
            ...errorResponses(400, 401, 404, 500, 502),
          },
        },
      },
      '/api/email/messages/{message_id}/attachments/{attachment_id}': {
        get: {
          operationId: 'getEmailAttachment',
          summary: 'Download email attachment',
          description: 'Downloads an attachment from an email message.',
          tags: ['Email'],
          parameters: [
            {
              name: 'message_id',
              in: 'path',
              required: true,
              description: 'Provider-specific message identifier',
              schema: { type: 'string' },
              example: '18d4f2e3a4b5c6d7',
            },
            {
              name: 'attachment_id',
              in: 'path',
              required: true,
              description: 'Provider-specific attachment identifier',
              schema: { type: 'string' },
              example: 'ANGjdJ8vB2vR3Gj9',
            },
            {
              name: 'connection_id',
              in: 'query',
              required: true,
              description: 'UUID of the OAuth connection the message belongs to',
              schema: { type: 'string', format: 'uuid' },
              example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
            },
          ],
          responses: {
            '200': jsonResponse('Attachment data', {
              type: 'object',
              required: ['data', 'size'],
              properties: {
                data: {
                  type: 'string',
                  description: 'Base64-encoded attachment content',
                  example: 'SGVsbG8gV29ybGQ=',
                },
                size: {
                  type: 'integer',
                  description: 'Size of the attachment in bytes',
                  example: 245760,
                },
                filename: {
                  type: 'string',
                  description: 'Original filename of the attachment',
                  example: 'project-plan.pdf',
                },
                mime_type: {
                  type: 'string',
                  description: 'MIME type of the attachment',
                  example: 'application/pdf',
                },
              },
            }),
            ...errorResponses(400, 401, 404, 500, 502),
          },
        },
      },
      '/api/sync/emails': {
        post: {
          operationId: 'syncEmails',
          summary: 'Trigger email sync (legacy)',
          description: 'Legacy endpoint that returns a redirect to the live email API. Email is now accessed live via /api/email/messages.',
          tags: ['EmailLegacy'],
          deprecated: true,
          requestBody: jsonBody({
            type: 'object',
            required: ['connection_id'],
            properties: {
              connection_id: {
                type: 'string',
                format: 'uuid',
                description: 'UUID of the OAuth connection to sync emails from',
                example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
              },
            },
          }),
          responses: {
            '200': jsonResponse('Live API redirect info', {
              type: 'object',
              properties: {
                status: {
                  type: 'string',
                  description: 'Indicates this is now a live API redirect',
                  example: 'live_api',
                },
                message: {
                  type: 'string',
                  description: 'Human-readable redirect message',
                  example: 'Email is now accessed live via /api/email/messages. No sync needed.',
                },
                connection_id: {
                  type: 'string',
                  format: 'uuid',
                  description: 'The OAuth connection ID from the request',
                  example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
                },
                provider: {
                  type: 'string',
                  description: 'The OAuth provider for the connection',
                  example: 'google',
                },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },
      '/api/emails': {
        get: {
          operationId: 'listEmailsLegacy',
          summary: 'List emails (legacy)',
          description: 'Legacy email listing endpoint. Proxies to the live API when connection_id is provided, otherwise queries locally stored emails.',
          tags: ['EmailLegacy'],
          deprecated: true,
          parameters: [
            {
              name: 'connection_id',
              in: 'query',
              description: 'OAuth connection ID (proxies to live API when provided)',
              schema: { type: 'string', format: 'uuid' },
              example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
            },
            {
              name: 'provider',
              in: 'query',
              description: 'Filter locally stored emails by provider name',
              schema: { type: 'string' },
              example: 'google',
            },
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum number of emails to return',
              schema: { type: 'integer', default: 50, maximum: 100 },
              example: 50,
            },
          ],
          responses: {
            '200': jsonResponse('Email list', {
              type: 'object',
              properties: {
                emails: {
                  type: 'array',
                  description: 'List of email messages',
                  items: {
                    type: 'object',
                    properties: {
                      id: {
                        type: 'string',
                        description: 'Email message identifier',
                        example: '18d4f2e3a4b5c6d7',
                      },
                      subject: {
                        type: 'string',
                        description: 'Email subject line',
                        example: 'Re: Project Update',
                      },
                      from: {
                        type: 'string',
                        description: 'Sender email address',
                        example: 'bob@example.com',
                      },
                      date: {
                        type: 'string',
                        format: 'date-time',
                        description: 'Date the email was sent or received',
                        example: '2026-02-21T14:30:00Z',
                      },
                      snippet: {
                        type: 'string',
                        description: 'Short preview of the email body',
                        example: 'Hi team, here is the latest update...',
                      },
                    },
                  },
                },
              },
            }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/api/emails/send': {
        post: {
          operationId: 'sendEmailLegacy',
          summary: 'Send email (legacy)',
          description: 'Legacy email send endpoint. Proxies to the new API when connection_id and to are provided.',
          tags: ['EmailLegacy'],
          deprecated: true,
          requestBody: jsonBody({
            type: 'object',
            properties: {
              connection_id: {
                type: 'string',
                format: 'uuid',
                description: 'UUID of the OAuth connection to send through (proxies to new API)',
                example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
              },
              user_email: {
                type: 'string',
                description: 'Email address of the sending user (legacy field)',
                example: 'alice@example.com',
              },
              thread_id: {
                type: 'string',
                description: 'Thread ID to continue the conversation in',
                example: '18d4f2e3a4b5c6d0',
              },
              body: {
                type: 'string',
                description: 'Email body content',
                example: 'Hi team, here is the latest update on the project...',
              },
              to: {
                type: 'array',
                items: { $ref: '#/components/schemas/EmailRecipient' },
                description: 'Primary recipients of the email',
              },
              subject: {
                type: 'string',
                description: 'Email subject line',
                example: 'Re: Project Update',
              },
            },
          }),
          responses: {
            '200': jsonResponse('Send result', {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Provider-specific message identifier of the sent email',
                  example: '18d4f2e3a4b5c6d7',
                },
                thread_id: {
                  type: 'string',
                  description: 'Provider-specific thread identifier',
                  example: '18d4f2e3a4b5c6d0',
                },
                status: {
                  type: 'string',
                  description: 'Send status',
                  example: 'sent',
                },
              },
            }),
            '202': jsonResponse('Queued for sending', {
              type: 'object',
              properties: {
                status: {
                  type: 'string',
                  description: 'Indicates the email has been queued for sending',
                  example: 'queued',
                },
                thread_id: {
                  type: 'string',
                  description: 'Thread ID the email will be sent to',
                  example: '18d4f2e3a4b5c6d0',
                },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
      '/api/emails/create-work-item': {
        post: {
          operationId: 'createWorkItemFromEmail',
          summary: 'Create work item from email',
          description: 'Creates a new work item from an email message, linking the communication thread.',
          tags: ['EmailLegacy'],
          requestBody: jsonBody({
            type: 'object',
            required: ['message_id'],
            properties: {
              message_id: {
                type: 'string',
                format: 'uuid',
                description: 'UUID of the external message to create a work item from',
                example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
              },
              title: {
                type: 'string',
                description: 'Override title for the work item (defaults to email subject)',
                example: 'Follow up on project proposal',
              },
            },
          }),
          responses: {
            '201': jsonResponse('Work item created', {
              type: 'object',
              properties: {
                work_item: {
                  type: 'object',
                  description: 'The newly created work item',
                  properties: {
                    id: {
                      type: 'string',
                      format: 'uuid',
                      description: 'Unique identifier of the created work item',
                      example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
                    },
                    title: {
                      type: 'string',
                      description: 'Title of the work item',
                      example: 'Follow up on project proposal',
                    },
                    status: {
                      type: 'string',
                      description: 'Initial status of the work item',
                      example: 'open',
                    },
                    work_item_kind: {
                      type: 'string',
                      description: 'Type of the work item',
                      example: 'task',
                    },
                  },
                },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
    },
  };
}
