/**
 * OpenAPI path definitions for Terminal known host verification.
 *
 * Covers known host CRUD and host key approval.
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

export function terminalKnownHostsPaths(): OpenApiDomainModule {
  return {
    tags: [
      {
        name: 'Terminal Known Hosts',
        description: 'SSH host key trust store and verification',
      },
    ],

    schemas: {
      TerminalKnownHost: {
        type: 'object',
        required: ['id', 'namespace', 'host', 'port', 'key_type', 'key_fingerprint', 'public_key', 'trusted_at', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          namespace: { type: 'string' },
          connection_id: { type: 'string', format: 'uuid', nullable: true },
          host: { type: 'string' },
          port: { type: 'integer', default: 22 },
          key_type: { type: 'string', description: 'SSH key type', example: 'ssh-ed25519' },
          key_fingerprint: { type: 'string', description: 'SSH key fingerprint' },
          public_key: { type: 'string', description: 'Full public key for verification' },
          trusted_at: { type: 'string', format: 'date-time' },
          trusted_by: { type: 'string', nullable: true, description: 'Who approved (agent/user/tofu)' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },

      TerminalKnownHostCreateInput: {
        type: 'object',
        required: ['host', 'key_type', 'key_fingerprint', 'public_key'],
        properties: {
          connection_id: { type: 'string', format: 'uuid' },
          host: { type: 'string' },
          port: { type: 'integer', default: 22 },
          key_type: { type: 'string', description: 'SSH key type (e.g. ssh-ed25519, ssh-rsa)' },
          key_fingerprint: { type: 'string' },
          public_key: { type: 'string' },
          trusted_by: { type: 'string', default: 'user' },
        },
      },

      TerminalKnownHostApproveInput: {
        type: 'object',
        required: ['session_id', 'host', 'key_type', 'fingerprint', 'public_key'],
        description: 'Approves a pending host key verification, unblocking a session in pending_host_verification status.',
        properties: {
          session_id: { type: 'string', format: 'uuid', description: 'Session waiting for host verification' },
          host: { type: 'string' },
          port: { type: 'integer', default: 22 },
          key_type: { type: 'string' },
          fingerprint: { type: 'string' },
          public_key: { type: 'string' },
        },
      },
    },

    paths: {
      '/api/terminal/known-hosts': {
        get: {
          operationId: 'listTerminalKnownHosts',
          summary: 'List trusted host keys',
          description: 'Returns a paginated list of trusted SSH host keys, optionally filtered by host or connection.',
          tags: ['Terminal Known Hosts'],
          parameters: [
            namespaceParam(),
            ...paginationParams(),
            {
              name: 'host',
              in: 'query',
              description: 'Filter by host (partial match)',
              schema: { type: 'string' },
            },
            {
              name: 'connection_id',
              in: 'query',
              description: 'Filter by connection UUID',
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            '200': jsonResponse('List of known hosts', {
              type: 'object',
              properties: {
                known_hosts: { type: 'array', items: ref('TerminalKnownHost') },
                total: { type: 'integer' },
              },
            }),
            ...errorResponses(403, 500),
          },
        },
        post: {
          operationId: 'trustTerminalHostKey',
          summary: 'Manually trust a host key',
          description: 'Manually adds a host key to the trust store. Uses upsert on (namespace, host, port, key_type).',
          tags: ['Terminal Known Hosts'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('TerminalKnownHostCreateInput')),
          responses: {
            '201': jsonResponse('Trusted host key', ref('TerminalKnownHost')),
            ...errorResponses(400, 401, 403, 500),
          },
        },
      },

      '/api/terminal/known-hosts/approve': {
        post: {
          operationId: 'approveTerminalHostKey',
          summary: 'Approve pending host verification',
          description:
            'Approves a pending host key verification for a session in pending_host_verification status. ' +
            'Stores the key in the trust store and notifies the gRPC worker to proceed.',
          tags: ['Terminal Known Hosts'],
          parameters: [namespaceParam()],
          requestBody: jsonBody(ref('TerminalKnownHostApproveInput')),
          responses: {
            '200': jsonResponse('Approval result', {
              type: 'object',
              properties: {
                approved: { type: 'boolean' },
                session_id: { type: 'string', format: 'uuid' },
              },
            }),
            ...errorResponses(400, 401, 403, 404, 502),
          },
        },
      },

      '/api/terminal/known-hosts/{id}': {
        parameters: [uuidParam('id', 'Known host UUID')],
        delete: {
          operationId: 'revokeTerminalKnownHost',
          summary: 'Revoke trust for a host key',
          description: 'Removes a host key from the trust store.',
          tags: ['Terminal Known Hosts'],
          parameters: [namespaceParam()],
          responses: {
            '204': { description: 'Host key trust revoked' },
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },
    },
  };
}
