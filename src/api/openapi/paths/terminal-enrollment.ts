/**
 * OpenAPI path definitions for Terminal enrollment tokens.
 *
 * Covers enrollment token CRUD and remote self-registration.
 * Epic #1667 — TMux Session Management.
 */
import type { OpenApiDomainModule } from '../types.ts';
import {
  ref,
  uuidParam,
  paginationParams,
  errorResponses,
  jsonBody,
  jsonResponse,
  namespaceParam,
} from '../helpers.ts';

export function terminalEnrollmentPaths(): OpenApiDomainModule {
  return {
    tags: [
      {
        name: 'Terminal Enrollment',
        description: 'Enrollment tokens for remote server self-registration',
      },
    ],

    schemas: {
      TerminalEnrollmentToken: {
        type: 'object',
        required: ['id', 'namespace', 'label', 'uses', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          namespace: { type: 'string' },
          label: { type: 'string', description: 'Human-readable label' },
          max_uses: { type: 'integer', nullable: true, description: 'Max number of uses (null = unlimited)' },
          uses: { type: 'integer', default: 0 },
          expires_at: { type: 'string', format: 'date-time', nullable: true },
          connection_defaults: { type: 'object', nullable: true, additionalProperties: true, description: 'Default values for enrolled connections' },
          allowed_tags: { type: 'array', nullable: true, items: { type: 'string' }, description: 'Tags auto-applied to enrolled connections' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },

      TerminalEnrollmentTokenCreateInput: {
        type: 'object',
        required: ['label'],
        properties: {
          label: { type: 'string', description: 'Human-readable label for the token' },
          max_uses: { type: 'integer', minimum: 1, description: 'Maximum number of uses (omit for unlimited)' },
          expires_at: { type: 'string', format: 'date-time', description: 'Expiry timestamp' },
          connection_defaults: { type: 'object', additionalProperties: true, description: 'Default values for enrolled connections' },
          allowed_tags: { type: 'array', items: { type: 'string' } },
        },
      },

      TerminalEnrollmentTokenCreateResponse: {
        type: 'object',
        description: 'Response includes the plaintext token (shown once, never retrievable again).',
        properties: {
          id: { type: 'string', format: 'uuid' },
          namespace: { type: 'string' },
          label: { type: 'string' },
          max_uses: { type: 'integer', nullable: true },
          uses: { type: 'integer' },
          expires_at: { type: 'string', format: 'date-time', nullable: true },
          connection_defaults: { type: 'object', nullable: true, additionalProperties: true },
          allowed_tags: { type: 'array', nullable: true, items: { type: 'string' } },
          created_at: { type: 'string', format: 'date-time' },
          token: { type: 'string', description: 'Plaintext enrollment token (shown ONCE)' },
          enrollment_script: { type: 'string', description: 'Ready-to-use enrollment curl command' },
        },
      },

      TerminalEnrollInput: {
        type: 'object',
        required: ['token', 'hostname'],
        properties: {
          token: { type: 'string', description: 'Enrollment token (plaintext)' },
          hostname: { type: 'string', description: 'Hostname of the enrolling server' },
          ssh_port: { type: 'integer', default: 22 },
          public_key: { type: 'string', description: 'SSH public key (creates a credential if provided)' },
          tags: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
      },

      TerminalEnrollResponse: {
        type: 'object',
        properties: {
          connection: { $ref: '#/components/schemas/TerminalConnection' },
          credential: { $ref: '#/components/schemas/TerminalCredential', nullable: true },
          enrollment_token_label: { type: 'string' },
        },
      },
    },

    paths: {
      '/api/terminal/enrollment-tokens': {
        get: {
          operationId: 'listTerminalEnrollmentTokens',
          summary: 'List enrollment tokens',
          description: 'Returns a paginated list of enrollment tokens (token hashes are never returned).',
          tags: ['Terminal Enrollment'],
          parameters: [namespaceParam(), ...paginationParams()],
          responses: {
            '200': jsonResponse('List of tokens', {
              type: 'object',
              properties: {
                tokens: { type: 'array', items: ref('TerminalEnrollmentToken') },
                total: { type: 'integer' },
                limit: { type: 'integer' },
                offset: { type: 'integer' },
              },
            }),
            ...errorResponses(403, 500),
          },
        },
        post: {
          operationId: 'createTerminalEnrollmentToken',
          summary: 'Create an enrollment token',
          description: 'Creates a new enrollment token. The plaintext token is returned ONCE and cannot be retrieved later.',
          tags: ['Terminal Enrollment'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('TerminalEnrollmentTokenCreateInput')),
          responses: {
            '201': jsonResponse('Created token (includes plaintext token)', ref('TerminalEnrollmentTokenCreateResponse')),
            ...errorResponses(400, 401, 403, 500),
          },
        },
      },

      '/api/terminal/enrollment-tokens/{id}': {
        parameters: [uuidParam('id', 'Enrollment token UUID')],
        delete: {
          operationId: 'revokeTerminalEnrollmentToken',
          summary: 'Revoke an enrollment token',
          description: 'Permanently deletes an enrollment token.',
          tags: ['Terminal Enrollment'],
          parameters: [namespaceParam()],
          responses: {
            '204': { description: 'Token revoked' },
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },

      '/api/terminal/enroll': {
        post: {
          operationId: 'enrollTerminalServer',
          summary: 'Self-register a remote server',
          description:
            'Remote server self-registration endpoint. Validates the enrollment token, creates a connection, ' +
            'and optionally creates a credential from the provided public key. ' +
            'This endpoint does not require standard Bearer auth — the enrollment token serves as authentication.',
          tags: ['Terminal Enrollment'],
          security: [],
          requestBody: jsonBody(ref('TerminalEnrollInput')),
          responses: {
            '201': jsonResponse('Enrollment result', ref('TerminalEnrollResponse')),
            ...errorResponses(400, 401, 500),
          },
        },
      },
    },
  };
}
