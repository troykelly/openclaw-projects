/**
 * OpenAPI path definitions for Terminal Credential management.
 *
 * Covers credential CRUD and key pair generation.
 * SECURITY: encrypted_value is never exposed in any response schema.
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

export function terminalCredentialsPaths(): OpenApiDomainModule {
  return {
    tags: [
      {
        name: 'Terminal Credentials',
        description: 'SSH credential management (keys, passwords, command providers)',
      },
    ],

    schemas: {
      TerminalCredential: {
        type: 'object',
        description: 'Credential metadata. The encrypted private key or password is never returned.',
        required: ['id', 'namespace', 'name', 'kind', 'created_at', 'updated_at'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          namespace: { type: 'string' },
          name: { type: 'string', description: 'Human label', example: 'troy-ed25519' },
          kind: {
            type: 'string',
            enum: ['ssh_key', 'password', 'command'],
            description: 'Credential type',
          },
          command: { type: 'string', nullable: true, description: 'External command for command-based credentials', example: 'op read op://vault/key' },
          command_timeout_s: { type: 'integer', default: 10, description: 'Max wait for command' },
          cache_ttl_s: { type: 'integer', default: 0, description: 'Cache duration (0 = no cache)' },
          fingerprint: { type: 'string', nullable: true, description: 'SSH key fingerprint' },
          public_key: { type: 'string', nullable: true, description: 'Public key (safe to display)' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },

      TerminalCredentialCreateInput: {
        type: 'object',
        required: ['name', 'kind'],
        properties: {
          name: { type: 'string', description: 'Human label for the credential' },
          kind: { type: 'string', enum: ['ssh_key', 'password', 'command'] },
          value: {
            type: 'string',
            writeOnly: true,
            description: 'Private key or password (required for ssh_key/password kinds). Never returned in responses.',
          },
          command: { type: 'string', description: 'External command (required for command kind)' },
          command_timeout_s: { type: 'integer', default: 10 },
          cache_ttl_s: { type: 'integer', default: 0 },
          fingerprint: { type: 'string', nullable: true },
          public_key: { type: 'string', nullable: true },
        },
      },

      TerminalCredentialUpdateInput: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          value: { type: 'string', writeOnly: true, description: 'New private key or password' },
          command: { type: 'string' },
          command_timeout_s: { type: 'integer' },
          cache_ttl_s: { type: 'integer' },
          fingerprint: { type: 'string', nullable: true },
          public_key: { type: 'string', nullable: true },
        },
      },

      TerminalGenerateKeyInput: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Label for the generated key pair' },
          type: {
            type: 'string',
            enum: ['ed25519', 'rsa'],
            default: 'ed25519',
            description: 'Key algorithm',
          },
        },
      },
    },

    paths: {
      '/api/terminal/credentials': {
        get: {
          operationId: 'listTerminalCredentials',
          summary: 'List credentials (metadata only)',
          description: 'Returns a paginated list of credential metadata. Private keys and passwords are never returned.',
          tags: ['Terminal Credentials'],
          parameters: [namespaceParam(), ...paginationParams()],
          responses: {
            '200': jsonResponse('List of credentials', {
              type: 'object',
              properties: {
                credentials: { type: 'array', items: ref('TerminalCredential') },
                total: { type: 'integer' },
              },
            }),
            ...errorResponses(403, 500),
          },
        },
        post: {
          operationId: 'createTerminalCredential',
          summary: 'Create a credential',
          description: 'Creates a new credential. For ssh_key/password kinds, the value is envelope-encrypted at rest.',
          tags: ['Terminal Credentials'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('TerminalCredentialCreateInput')),
          responses: {
            '201': jsonResponse('Created credential (metadata only)', ref('TerminalCredential')),
            ...errorResponses(400, 401, 403, 500),
          },
        },
      },

      '/api/terminal/credentials/{id}': {
        parameters: [uuidParam('id', 'Credential UUID')],
        get: {
          operationId: 'getTerminalCredential',
          summary: 'Get credential metadata',
          description: 'Returns metadata for a single credential. The encrypted value is never returned.',
          tags: ['Terminal Credentials'],
          parameters: [namespaceParam()],
          responses: {
            '200': jsonResponse('Credential metadata', ref('TerminalCredential')),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
        patch: {
          operationId: 'updateTerminalCredential',
          summary: 'Update a credential',
          description: 'Partially updates credential fields. If value is provided, re-encrypts.',
          tags: ['Terminal Credentials'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('TerminalCredentialUpdateInput')),
          responses: {
            '200': jsonResponse('Updated credential (metadata only)', ref('TerminalCredential')),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteTerminalCredential',
          summary: 'Soft-delete a credential',
          description: 'Marks a credential as deleted (soft delete).',
          tags: ['Terminal Credentials'],
          parameters: [namespaceParam()],
          responses: {
            '204': { description: 'Credential deleted' },
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },

      '/api/terminal/credentials/generate': {
        post: {
          operationId: 'generateTerminalKeyPair',
          summary: 'Generate an SSH key pair',
          description: 'Generates a new SSH key pair (ed25519 or RSA). The private key is encrypted and stored. The public key is returned for copy.',
          tags: ['Terminal Credentials'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('TerminalGenerateKeyInput')),
          responses: {
            '201': jsonResponse('Generated key pair (public key returned)', ref('TerminalCredential')),
            ...errorResponses(400, 401, 403, 500),
          },
        },
      },
    },
  };
}
