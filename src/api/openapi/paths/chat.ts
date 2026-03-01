/**
 * OpenAPI path definitions for Agent Chat endpoints.
 *
 * Routes: POST/GET /api/chat/sessions, GET/PATCH /api/chat/sessions/:id,
 *         POST /api/chat/sessions/:id/end,
 *         POST/GET /api/chat/sessions/:id/messages,
 *         POST /api/chat/ws/ticket, GET /api/chat/ws,
 *         POST /api/chat/sessions/:id/stream,
 *         POST /api/chat/sessions/:id/agent-message,
 *         POST /api/notifications/agent,
 *         POST /api/push/subscribe
 *
 * Rate limits (#1960):
 * - Session creation: 5/min per user
 * - Messages: 10/min per user
 * - Stream chunks: 100/sec + 256KB total per session
 * - Typing: 2/sec per connection
 * - attract_attention: 3/hour + 10/day per user
 * - 429 responses include Retry-After header
 *
 * Epic #1940 — Agent Chat.
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonBody, jsonResponse, uuidParam } from '../helpers.ts';

export function chatPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Chat', description: 'Agent chat session and message management' },
    ],
    schemas: {
      ChatSession: {
        type: 'object',
        required: ['id', 'thread_id', 'user_email', 'agent_id', 'namespace', 'status', 'version', 'started_at', 'last_activity_at', 'metadata'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique session identifier' },
          thread_id: { type: 'string', format: 'uuid', description: 'Associated external thread ID' },
          user_email: { type: 'string', format: 'email', description: 'Email of the session owner' },
          agent_id: { type: 'string', description: 'Agent identifier for this session' },
          namespace: { type: 'string', description: 'Namespace this session belongs to' },
          status: { type: 'string', enum: ['active', 'ended', 'expired'], description: 'Session status' },
          title: { type: 'string', nullable: true, description: 'Optional session title (max 200 chars)' },
          version: { type: 'integer', description: 'Optimistic locking version' },
          started_at: { type: 'string', format: 'date-time', description: 'When the session started' },
          ended_at: { type: 'string', format: 'date-time', nullable: true, description: 'When the session ended' },
          last_activity_at: { type: 'string', format: 'date-time', description: 'Last activity timestamp' },
          metadata: { type: 'object', description: 'Additional metadata (max 16KB)' },
        },
      },
      ChatMessage: {
        type: 'object',
        required: ['id', 'thread_id', 'direction', 'body', 'status', 'content_type', 'received_at', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique message identifier' },
          thread_id: { type: 'string', format: 'uuid', description: 'Thread this message belongs to' },
          external_message_key: { type: 'string', description: 'External message key' },
          direction: { type: 'string', enum: ['inbound', 'outbound'], description: 'Message direction' },
          body: { type: 'string', nullable: true, description: 'Message content (max 64KB)' },
          status: { type: 'string', enum: ['pending', 'streaming', 'delivered', 'failed'], description: 'Message delivery status' },
          idempotency_key: { type: 'string', format: 'uuid', nullable: true, description: 'Idempotency key for deduplication' },
          agent_run_id: { type: 'string', nullable: true, description: 'Agent run that generated this message' },
          content_type: { type: 'string', enum: ['text/plain', 'text/markdown', 'application/vnd.openclaw.rich-card'], description: 'Content type' },
          received_at: { type: 'string', format: 'date-time', description: 'When the message was received' },
          created_at: { type: 'string', format: 'date-time', description: 'When the message was created' },
          updated_at: { type: 'string', format: 'date-time', nullable: true, description: 'When the message was last updated' },
        },
      },
    },
    paths: {
      '/api/chat/sessions': {
        post: {
          operationId: 'createChatSession',
          summary: 'Create a new chat session',
          description: 'Creates a new chat session with the specified agent. Also creates the backing external thread.',
          tags: ['Chat'],
          requestBody: jsonBody({
            type: 'object',
            required: ['agent_id'],
            properties: {
              agent_id: { type: 'string', description: 'Agent to chat with' },
              title: { type: 'string', description: 'Optional session title (max 200 chars)', maxLength: 200 },
            },
          }),
          responses: {
            '201': jsonResponse('Session created', { $ref: '#/components/schemas/ChatSession' }),
            ...errorResponses(400, 401, 429, 500),
          },
        },
        get: {
          operationId: 'listChatSessions',
          summary: 'List chat sessions',
          description: 'Returns cursor-paginated list of chat sessions for the authenticated user.',
          tags: ['Chat'],
          parameters: [
            { name: 'limit', in: 'query', description: 'Max results (1-100, default 20)', schema: { type: 'integer', default: 20 } },
            { name: 'cursor', in: 'query', description: 'Pagination cursor (last_activity_at of last item)', schema: { type: 'string' } },
            { name: 'status', in: 'query', description: 'Filter by status', schema: { type: 'string', enum: ['active', 'ended', 'expired'] } },
          ],
          responses: {
            '200': jsonResponse('Session list', {
              type: 'object',
              properties: {
                sessions: { type: 'array', items: { $ref: '#/components/schemas/ChatSession' } },
                next_cursor: { type: 'string', nullable: true, description: 'Cursor for next page' },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },
      '/api/chat/sessions/{id}': {
        get: {
          operationId: 'getChatSession',
          summary: 'Get chat session details',
          description: 'Returns details of a specific chat session.',
          tags: ['Chat'],
          parameters: [uuidParam('id', 'Chat session ID')],
          responses: {
            '200': jsonResponse('Session details', { $ref: '#/components/schemas/ChatSession' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        patch: {
          operationId: 'updateChatSession',
          summary: 'Update chat session title',
          description: 'Updates the title of a chat session. Uses optimistic locking via version field.',
          tags: ['Chat'],
          parameters: [uuidParam('id', 'Chat session ID')],
          requestBody: jsonBody({
            type: 'object',
            required: ['version'],
            properties: {
              title: { type: 'string', nullable: true, description: 'New title (null to clear)' },
              version: { type: 'integer', description: 'Current version for optimistic locking' },
            },
          }),
          responses: {
            '200': jsonResponse('Updated session', { $ref: '#/components/schemas/ChatSession' }),
            ...errorResponses(400, 401, 404, 409, 500),
          },
        },
      },
      '/api/chat/sessions/{id}/end': {
        post: {
          operationId: 'endChatSession',
          summary: 'End a chat session',
          description: 'Ends an active chat session. Uses SELECT FOR UPDATE for race safety.',
          tags: ['Chat'],
          parameters: [uuidParam('id', 'Chat session ID')],
          responses: {
            '200': jsonResponse('Ended session', { $ref: '#/components/schemas/ChatSession' }),
            ...errorResponses(400, 401, 404, 409, 500),
          },
        },
      },
      '/api/chat/sessions/{id}/messages': {
        post: {
          operationId: 'sendChatMessage',
          summary: 'Send a chat message',
          description: 'Sends a message in a chat session. Dispatches webhook to OpenClaw gateway. Supports idempotency via idempotency_key.',
          tags: ['Chat'],
          parameters: [uuidParam('id', 'Chat session ID')],
          requestBody: jsonBody({
            type: 'object',
            required: ['content'],
            properties: {
              content: { type: 'string', description: 'Message content (max 64KB)' },
              idempotency_key: { type: 'string', format: 'uuid', description: 'UUID for idempotent sends' },
              content_type: {
                type: 'string',
                enum: ['text/plain', 'text/markdown', 'application/vnd.openclaw.rich-card'],
                default: 'text/plain',
                description: 'Content type',
              },
            },
          }),
          responses: {
            '201': jsonResponse('Message sent', { $ref: '#/components/schemas/ChatMessage' }),
            '200': jsonResponse('Existing message (idempotent)', { $ref: '#/components/schemas/ChatMessage' }),
            ...errorResponses(400, 401, 404, 409, 429, 500),
          },
        },
        get: {
          operationId: 'listChatMessages',
          summary: 'List chat messages',
          description: 'Returns cursor-paginated list of messages in a chat session, ordered by received_at DESC.',
          tags: ['Chat'],
          parameters: [
            uuidParam('id', 'Chat session ID'),
            { name: 'limit', in: 'query', description: 'Max results (1-100, default 20)', schema: { type: 'integer', default: 20 } },
            { name: 'cursor', in: 'query', description: 'Base64url-encoded pagination cursor', schema: { type: 'string' } },
          ],
          responses: {
            '200': jsonResponse('Message list', {
              type: 'object',
              properties: {
                messages: { type: 'array', items: { $ref: '#/components/schemas/ChatMessage' } },
                next_cursor: { type: 'string', nullable: true, description: 'Cursor for next page' },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      // ── WebSocket ticket endpoint (Issue #1944) ────────────────────
      '/api/chat/ws/ticket': {
        post: {
          operationId: 'createChatWsTicket',
          summary: 'Generate one-time WebSocket ticket',
          description: 'Creates a one-time ticket (30s TTL) for authenticating a WebSocket connection. Avoids sending JWTs in query strings.',
          tags: ['Chat'],
          requestBody: jsonBody({
            type: 'object',
            required: ['session_id'],
            properties: {
              session_id: { type: 'string', format: 'uuid', description: 'Chat session to connect to' },
            },
          }),
          responses: {
            '200': jsonResponse('Ticket generated', {
              type: 'object',
              properties: {
                ticket: { type: 'string', description: 'One-time ticket string (64 hex chars)' },
                expires_in: { type: 'integer', description: 'TTL in seconds', example: 30 },
              },
            }),
            ...errorResponses(400, 401, 404, 409, 500),
          },
        },
      },

      // ── Streaming callback endpoint (Issue #1945) ──────────────────
      '/api/chat/sessions/{id}/stream': {
        post: {
          operationId: 'chatStreamCallback',
          summary: 'Agent streams response tokens',
          description: 'M2M endpoint for agents to stream response chunks, signal completion, or report failure. Authenticated via Bearer M2M token + X-Stream-Secret header. Rate limited to 100 chunks/sec and 256KB total per session.',
          tags: ['Chat'],
          parameters: [
            uuidParam('id', 'Chat session ID'),
            { name: 'X-Stream-Secret', in: 'header', required: true, description: 'Timing-safe stream secret for session authentication', schema: { type: 'string' } },
            { name: 'X-Agent-Id', in: 'header', required: false, description: 'Optional agent ID for verification', schema: { type: 'string' } },
          ],
          requestBody: jsonBody({
            type: 'object',
            required: ['type'],
            properties: {
              type: {
                type: 'string',
                enum: ['chunk', 'completed', 'failed'],
                description: 'Stream message type',
              },
              content: { type: 'string', description: 'Chunk content (max 4KB) or final content (max 256KB)' },
              seq: { type: 'integer', description: 'Monotonic sequence number (required for chunk type)' },
              message_id: { type: 'string', format: 'uuid', description: 'Optional message ID' },
              agent_run_id: { type: 'string', description: 'Agent run identifier' },
              error: { type: 'string', description: 'Error message (for failed type)' },
              content_type: {
                type: 'string',
                enum: ['text/plain', 'text/markdown', 'application/vnd.openclaw.rich-card'],
                default: 'text/plain',
                description: 'Content type (for completed type)',
              },
            },
          }),
          responses: {
            '200': jsonResponse('Stream event processed', {
              type: 'object',
              properties: {
                ok: { type: 'boolean' },
                message_id: { type: 'string', format: 'uuid', description: 'Message ID for the stream' },
              },
            }),
            ...errorResponses(400, 401, 403, 404, 409, 429, 500),
          },
        },
      },

      // ── Agent message endpoint (Issue #1954) ──────────────────────────
      '/api/chat/sessions/{id}/agent-message': {
        post: {
          operationId: 'chatAgentSendMessage',
          summary: 'Agent sends message to user in session',
          description: 'M2M endpoint for agents to send messages to users in active chat sessions. Authenticated via X-Stream-Secret header. Rate limited to 10 messages/min per session.',
          tags: ['Chat'],
          parameters: [
            uuidParam('id', 'Chat session ID'),
            { name: 'X-Stream-Secret', in: 'header', required: true, description: 'Timing-safe stream secret for session authentication', schema: { type: 'string' } },
          ],
          requestBody: jsonBody({
            type: 'object',
            required: ['content'],
            properties: {
              content: { type: 'string', description: 'Message content (max 64KB)' },
              content_type: {
                type: 'string',
                enum: ['text/plain', 'text/markdown', 'application/vnd.openclaw.rich-card'],
                default: 'text/markdown',
                description: 'Content type',
              },
              urgency: {
                type: 'string',
                enum: ['low', 'normal', 'high', 'urgent'],
                default: 'normal',
                description: 'Notification urgency for escalation',
              },
              agent_id: { type: 'string', description: 'Agent identifier (optional override)' },
            },
          }),
          responses: {
            '201': jsonResponse('Message sent', {
              type: 'object',
              properties: {
                ok: { type: 'boolean' },
                message_id: { type: 'string', format: 'uuid' },
              },
            }),
            ...errorResponses(400, 401, 403, 404, 409, 429, 500),
          },
        },
      },

      // ── Agent notification endpoint (Issue #1954) ─────────────────────
      '/api/notifications/agent': {
        post: {
          operationId: 'chatAgentAttractAttention',
          summary: 'Agent sends notification with escalation',
          description: 'M2M endpoint for agents to send notifications with urgency-based escalation. Deduplicates by reason_key within 15-minute window. Rate limited to 3/hour and 10/day per user.',
          tags: ['Chat'],
          parameters: [
            { name: 'X-User-Email', in: 'header', required: false, description: 'Target user email (alternative to user_email in body)', schema: { type: 'string', format: 'email' } },
          ],
          requestBody: jsonBody({
            type: 'object',
            required: ['message', 'urgency', 'reason_key'],
            properties: {
              user_email: { type: 'string', format: 'email', description: 'Target user email (alternative to X-User-Email header)' },
              message: { type: 'string', description: 'Notification message (max 500 chars)' },
              urgency: {
                type: 'string',
                enum: ['low', 'normal', 'high', 'urgent'],
                description: 'Urgency level controlling escalation channels',
              },
              reason_key: { type: 'string', description: 'Dedup key (max 100 chars)' },
              session_id: { type: 'string', format: 'uuid', description: 'Optional: link to chat session' },
              action_url: { type: 'string', format: 'uri', description: 'Optional: URL for notification click' },
              agent_id: { type: 'string', description: 'Agent identifier' },
            },
          }),
          responses: {
            '200': jsonResponse('Notification processed', {
              type: 'object',
              properties: {
                ok: { type: 'boolean' },
                notification_id: { type: 'string', format: 'uuid' },
                deduplicated: { type: 'boolean', description: 'True if notification was deduplicated' },
              },
            }),
            ...errorResponses(400, 401, 429, 500),
          },
        },
      },

      // ── Push subscription endpoint (Issue #1956) ──────────────────────
      '/api/push/subscribe': {
        post: {
          operationId: 'pushSubscribe',
          summary: 'Subscribe to browser push notifications',
          description: 'Store a Web Push subscription for the authenticated user. Max 5 subscriptions per user.',
          tags: ['Chat'],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              subscription: {
                type: 'object',
                description: 'Web Push subscription from PushManager.subscribe()',
                properties: {
                  endpoint: { type: 'string', format: 'uri' },
                  keys: {
                    type: 'object',
                    properties: {
                      p256dh: { type: 'string' },
                      auth: { type: 'string' },
                    },
                  },
                },
              },
              action: {
                type: 'string',
                enum: ['subscribe', 'unsubscribe'],
                default: 'subscribe',
              },
              endpoint: { type: 'string', description: 'Endpoint URL for unsubscribe action' },
            },
          }),
          responses: {
            '200': jsonResponse('Subscription updated', {
              type: 'object',
              properties: { ok: { type: 'boolean' } },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },
    },
  };
}
