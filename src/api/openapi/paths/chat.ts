/**
 * OpenAPI path definitions for Agent Chat endpoints.
 *
 * Routes: POST/GET /api/chat/sessions, GET/PATCH /api/chat/sessions/:id,
 *         POST /api/chat/sessions/:id/end,
 *         POST/GET /api/chat/sessions/:id/messages
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
    },
  };
}
