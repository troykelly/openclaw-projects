/**
 * OpenAPI path definitions for Symphony orchestration endpoints.
 * Issues #2204, #2205, #2206, #2212, #2213, #2214 — Epic #2186
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonBody, jsonResponse, uuidParam } from '../helpers.ts';

const projectIdParam = {
  name: 'project_id',
  in: 'path' as const,
  required: true,
  description: 'Project UUID',
  schema: { type: 'string', format: 'uuid' },
};

const tags = ['Symphony'] as const;

export function symphonyPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Symphony', description: 'Symphony orchestration: config, runs, hosts, tools, dashboard, cleanup, metrics, WebSocket feed, and dead-letter queue' },
    ],
    schemas: {
      SymphonyFeedEvent: {
        type: 'object',
        required: ['type', 'data', 'timestamp', 'namespace'],
        properties: {
          type: {
            type: 'string',
            enum: [
              'symphony:run_state_changed',
              'symphony:stage_updated',
              'symphony:provisioning_progress',
              'symphony:run_failed',
              'symphony:run_succeeded',
              'symphony:queue_changed',
              'symphony:heartbeat',
            ],
            description: 'Symphony event type',
          },
          data: { type: 'object', description: 'Event payload data' },
          timestamp: { type: 'string', format: 'date-time' },
          namespace: { type: 'string' },
        },
      },
      SymphonyFeedStatsResponse: {
        type: 'object',
        required: ['total_connections', 'authenticated_connections'],
        properties: {
          total_connections: { type: 'integer' },
          authenticated_connections: { type: 'integer' },
        },
      },
      SymphonyDeadLetterEntry: {
        type: 'object',
        required: ['id', 'namespace', 'payload', 'error', 'source', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          namespace: { type: 'string' },
          payload: { type: 'object' },
          error: { type: 'string' },
          source: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
          resolved_at: { type: 'string', format: 'date-time', nullable: true },
          resolved_by: { type: 'string', nullable: true },
        },
      },
      SymphonyConfig: {
        type: 'object',
        properties: {
          project_id: { type: 'string', format: 'uuid' },
          enabled: { type: 'boolean' },
          config: { type: 'object' },
        },
      },
      SymphonyRun: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          work_item_id: { type: 'string', format: 'uuid' },
          status: { type: 'string' },
          stage: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      SymphonyHost: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          hostname: { type: 'string' },
          status: { type: 'string' },
        },
      },
      SymphonyTool: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          config: { type: 'object' },
        },
      },
      SymphonyRepo: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          url: { type: 'string' },
          branch: { type: 'string', nullable: true },
        },
      },
    },
    paths: {
      // ── WebSocket Feed (#2205) ──
      '/api/symphony/feed': {
        get: {
          operationId: 'connectSymphonyFeed',
          summary: 'Symphony WebSocket feed',
          description: 'Establishes a WebSocket connection for real-time Symphony orchestration events.',
          tags,
          parameters: [
            { name: 'Authorization', in: 'header', description: 'Bearer JWT', schema: { type: 'string' } },
          ],
          responses: {
            '101': { description: 'WebSocket upgrade successful' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/api/symphony/feed/stats': {
        get: {
          operationId: 'getSymphonyFeedStats',
          summary: 'Symphony feed connection stats',
          tags,
          responses: {
            '200': jsonResponse('Feed stats', { $ref: '#/components/schemas/SymphonyFeedStatsResponse' }),
            ...errorResponses(401, 500),
          },
        },
      },
      // ── Dead Letter (#2212) ──
      '/api/symphony/dead-letter': {
        get: {
          operationId: 'getSymphonyDeadLetters',
          summary: 'List unresolved dead-letter entries',
          tags,
          parameters: [
            { name: 'namespace', in: 'query', schema: { type: 'string' } },
            { name: 'source', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } },
          ],
          responses: {
            '200': jsonResponse('Dead-letter entries', {
              type: 'array',
              items: { $ref: '#/components/schemas/SymphonyDeadLetterEntry' },
            }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/api/symphony/dead-letter/{id}/resolve': {
        post: {
          operationId: 'resolveSymphonyDeadLetter',
          summary: 'Resolve a dead-letter entry',
          tags,
          parameters: [uuidParam('id', 'Dead-letter entry UUID')],
          responses: {
            '200': jsonResponse('Resolved', { type: 'object', properties: { resolved: { type: 'boolean' } } }),
            ...errorResponses(401, 404, 500),
          },
        },
      },
      // ── Configuration (#2204) ──
      '/symphony/config': {
        get: {
          operationId: 'listSymphonyConfigs',
          summary: 'List all Symphony configurations',
          tags,
          responses: {
            '200': jsonResponse('Configuration list', { type: 'array', items: { $ref: '#/components/schemas/SymphonyConfig' } }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/symphony/config/{project_id}': {
        get: {
          operationId: 'getSymphonyConfig',
          summary: 'Get Symphony configuration for a project',
          tags,
          parameters: [projectIdParam],
          responses: {
            '200': jsonResponse('Configuration', { $ref: '#/components/schemas/SymphonyConfig' }),
            ...errorResponses(401, 404, 500),
          },
        },
        put: {
          operationId: 'upsertSymphonyConfig',
          summary: 'Create or update Symphony configuration',
          tags,
          parameters: [projectIdParam],
          requestBody: jsonBody({ type: 'object' }),
          responses: {
            '200': jsonResponse('Updated configuration', { $ref: '#/components/schemas/SymphonyConfig' }),
            ...errorResponses(400, 401, 500),
          },
        },
        delete: {
          operationId: 'deleteSymphonyConfig',
          summary: 'Delete Symphony configuration',
          tags,
          parameters: [projectIdParam],
          responses: {
            '204': { description: 'Configuration deleted' },
            ...errorResponses(401, 404, 500),
          },
        },
      },
      // ── Repositories (#2204) ──
      '/symphony/projects/{id}/repos': {
        get: {
          operationId: 'listSymphonyRepos',
          summary: 'List project repositories',
          tags,
          parameters: [uuidParam('id', 'Project UUID')],
          responses: {
            '200': jsonResponse('Repository list', { type: 'array', items: { $ref: '#/components/schemas/SymphonyRepo' } }),
            ...errorResponses(401, 500),
          },
        },
        post: {
          operationId: 'addSymphonyRepo',
          summary: 'Add a repository to a project',
          tags,
          parameters: [uuidParam('id', 'Project UUID')],
          requestBody: jsonBody({ type: 'object', properties: { url: { type: 'string' }, branch: { type: 'string' } } }),
          responses: {
            '201': jsonResponse('Created repository', { $ref: '#/components/schemas/SymphonyRepo' }),
            ...errorResponses(400, 401, 500),
          },
        },
      },
      '/symphony/projects/{id}/repos/{repo_id}': {
        put: {
          operationId: 'updateSymphonyRepo',
          summary: 'Update a project repository',
          tags,
          parameters: [uuidParam('id', 'Project UUID'), uuidParam('repo_id', 'Repository UUID')],
          requestBody: jsonBody({ type: 'object' }),
          responses: {
            '200': jsonResponse('Updated repository', { $ref: '#/components/schemas/SymphonyRepo' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteSymphonyRepo',
          summary: 'Remove a repository from a project',
          tags,
          parameters: [uuidParam('id', 'Project UUID'), uuidParam('repo_id', 'Repository UUID')],
          responses: {
            '204': { description: 'Repository removed' },
            ...errorResponses(401, 404, 500),
          },
        },
      },
      // ── Hosts (#2204) ──
      '/symphony/projects/{id}/hosts': {
        get: {
          operationId: 'listSymphonyHosts',
          summary: 'List project hosts',
          tags,
          parameters: [uuidParam('id', 'Project UUID')],
          responses: {
            '200': jsonResponse('Host list', { type: 'array', items: { $ref: '#/components/schemas/SymphonyHost' } }),
            ...errorResponses(401, 500),
          },
        },
        post: {
          operationId: 'addSymphonyHost',
          summary: 'Add a host to a project',
          tags,
          parameters: [uuidParam('id', 'Project UUID')],
          requestBody: jsonBody({ type: 'object', properties: { hostname: { type: 'string' } } }),
          responses: {
            '201': jsonResponse('Created host', { $ref: '#/components/schemas/SymphonyHost' }),
            ...errorResponses(400, 401, 500),
          },
        },
      },
      '/symphony/projects/{id}/hosts/{host_id}': {
        get: {
          operationId: 'getSymphonyHost',
          summary: 'Get a specific host',
          tags,
          parameters: [uuidParam('id', 'Project UUID'), uuidParam('host_id', 'Host UUID')],
          responses: {
            '200': jsonResponse('Host details', { $ref: '#/components/schemas/SymphonyHost' }),
            ...errorResponses(401, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteSymphonyHost',
          summary: 'Remove a host',
          tags,
          parameters: [uuidParam('id', 'Project UUID'), uuidParam('host_id', 'Host UUID')],
          responses: {
            '204': { description: 'Host removed' },
            ...errorResponses(401, 404, 500),
          },
        },
      },
      '/symphony/projects/{id}/hosts/{host_id}/drain': {
        post: {
          operationId: 'drainSymphonyHost',
          summary: 'Drain a host (stop accepting new runs)',
          tags,
          parameters: [uuidParam('id', 'Project UUID'), uuidParam('host_id', 'Host UUID')],
          responses: {
            '200': jsonResponse('Host drained', { type: 'object', properties: { status: { type: 'string' } } }),
            ...errorResponses(401, 404, 500),
          },
        },
      },
      '/symphony/projects/{id}/hosts/{host_id}/activate': {
        post: {
          operationId: 'activateSymphonyHost',
          summary: 'Activate a drained host',
          tags,
          parameters: [uuidParam('id', 'Project UUID'), uuidParam('host_id', 'Host UUID')],
          responses: {
            '200': jsonResponse('Host activated', { type: 'object', properties: { status: { type: 'string' } } }),
            ...errorResponses(401, 404, 500),
          },
        },
      },
      // ── Tools (#2204) ──
      '/symphony/tools': {
        get: {
          operationId: 'listSymphonyTools',
          summary: 'List Symphony tools',
          tags,
          responses: {
            '200': jsonResponse('Tool list', { type: 'array', items: { $ref: '#/components/schemas/SymphonyTool' } }),
            ...errorResponses(401, 500),
          },
        },
        post: {
          operationId: 'createSymphonyTool',
          summary: 'Create a Symphony tool',
          tags,
          requestBody: jsonBody({ type: 'object', properties: { name: { type: 'string' }, config: { type: 'object' } } }),
          responses: {
            '201': jsonResponse('Created tool', { $ref: '#/components/schemas/SymphonyTool' }),
            ...errorResponses(400, 401, 500),
          },
        },
      },
      '/symphony/tools/{id}': {
        put: {
          operationId: 'updateSymphonyTool',
          summary: 'Update a Symphony tool',
          tags,
          parameters: [uuidParam()],
          requestBody: jsonBody({ type: 'object' }),
          responses: {
            '200': jsonResponse('Updated tool', { $ref: '#/components/schemas/SymphonyTool' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteSymphonyTool',
          summary: 'Delete a Symphony tool',
          tags,
          parameters: [uuidParam()],
          responses: {
            '204': { description: 'Tool deleted' },
            ...errorResponses(401, 404, 500),
          },
        },
      },
      // ── Runs (#2204) ──
      '/symphony/runs': {
        get: {
          operationId: 'listSymphonyRuns',
          summary: 'List Symphony runs',
          tags,
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'work_item_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: {
            '200': jsonResponse('Run list', { type: 'array', items: { $ref: '#/components/schemas/SymphonyRun' } }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/symphony/runs/{id}': {
        get: {
          operationId: 'getSymphonyRun',
          summary: 'Get a Symphony run',
          tags,
          parameters: [uuidParam()],
          responses: {
            '200': jsonResponse('Run details', { $ref: '#/components/schemas/SymphonyRun' }),
            ...errorResponses(401, 404, 500),
          },
        },
      },
      '/symphony/runs/{id}/cancel': {
        post: {
          operationId: 'cancelSymphonyRun',
          summary: 'Cancel a running Symphony run',
          tags,
          parameters: [uuidParam()],
          responses: {
            '200': jsonResponse('Cancelled', { type: 'object', properties: { status: { type: 'string' } } }),
            ...errorResponses(401, 404, 409, 500),
          },
        },
      },
      '/symphony/runs/{id}/retry': {
        post: {
          operationId: 'retrySymphonyRun',
          summary: 'Retry a failed Symphony run',
          tags,
          parameters: [uuidParam()],
          responses: {
            '200': jsonResponse('Retried', { type: 'object', properties: { run_id: { type: 'string', format: 'uuid' } } }),
            ...errorResponses(401, 404, 409, 500),
          },
        },
      },
      '/symphony/runs/{id}/approve': {
        post: {
          operationId: 'approveSymphonyRun',
          summary: 'Approve a Symphony run awaiting approval',
          tags,
          parameters: [uuidParam()],
          responses: {
            '200': jsonResponse('Approved', { type: 'object', properties: { status: { type: 'string' } } }),
            ...errorResponses(401, 404, 409, 500),
          },
        },
      },
      '/symphony/runs/{id}/merge': {
        post: {
          operationId: 'mergeSymphonyRun',
          summary: 'Trigger merge for a Symphony run',
          tags,
          parameters: [uuidParam()],
          responses: {
            '200': jsonResponse('Merge initiated', { type: 'object', properties: { status: { type: 'string' } } }),
            ...errorResponses(401, 404, 409, 500),
          },
        },
      },
      '/symphony/runs/{id}/events': {
        get: {
          operationId: 'getSymphonyRunEvents',
          summary: 'List events for a Symphony run',
          tags,
          parameters: [
            uuidParam(),
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } },
          ],
          responses: {
            '200': jsonResponse('Run events', { type: 'array', items: { type: 'object' } }),
            ...errorResponses(401, 404, 500),
          },
        },
      },
      '/symphony/runs/{id}/terminal': {
        get: {
          operationId: 'getSymphonyRunTerminal',
          summary: 'Get terminal output for a Symphony run',
          tags,
          parameters: [uuidParam()],
          responses: {
            '200': jsonResponse('Terminal output', { type: 'object' }),
            ...errorResponses(401, 404, 500),
          },
        },
      },
      // ── Dashboard (#2204) ──
      '/symphony/dashboard/status': {
        get: {
          operationId: 'getSymphonyDashboardStatus',
          summary: 'Get Symphony dashboard status overview',
          tags,
          responses: {
            '200': jsonResponse('Dashboard status', { type: 'object' }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/symphony/dashboard/queue': {
        get: {
          operationId: 'getSymphonyDashboardQueue',
          summary: 'Get Symphony run queue',
          tags,
          responses: {
            '200': jsonResponse('Queue entries', { type: 'array', items: { type: 'object' } }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/symphony/dashboard/hosts': {
        get: {
          operationId: 'getSymphonyDashboardHosts',
          summary: 'Get host status overview',
          tags,
          responses: {
            '200': jsonResponse('Host status', { type: 'array', items: { type: 'object' } }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/symphony/dashboard/health': {
        get: {
          operationId: 'getSymphonyDashboardHealth',
          summary: 'Get Symphony system health',
          tags,
          responses: {
            '200': jsonResponse('System health', { type: 'object' }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/symphony/dashboard/queue/reorder': {
        post: {
          operationId: 'reorderSymphonyQueue',
          summary: 'Reorder the Symphony run queue',
          tags,
          requestBody: jsonBody({ type: 'object', properties: { order: { type: 'array', items: { type: 'string' } } } }),
          responses: {
            '200': jsonResponse('Reordered', { type: 'object', properties: { success: { type: 'boolean' } } }),
            ...errorResponses(400, 401, 500),
          },
        },
      },
      // ── Sync (#2204) ──
      '/symphony/sync/{project_id}': {
        post: {
          operationId: 'triggerSymphonySync',
          summary: 'Trigger a sync for a project',
          tags,
          parameters: [projectIdParam],
          responses: {
            '200': jsonResponse('Sync triggered', { type: 'object' }),
            ...errorResponses(401, 404, 500),
          },
        },
      },
      '/symphony/sync/{project_id}/status': {
        get: {
          operationId: 'getSymphonySyncStatus',
          summary: 'Get sync status for a project',
          tags,
          parameters: [projectIdParam],
          responses: {
            '200': jsonResponse('Sync status', { type: 'object' }),
            ...errorResponses(401, 404, 500),
          },
        },
      },
      // ── Cleanup (#2213) ──
      '/symphony/cleanup': {
        get: {
          operationId: 'listSymphonyCleanupItems',
          summary: 'List cleanup queue items',
          tags,
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          ],
          responses: {
            '200': jsonResponse('Cleanup items', { type: 'array', items: { type: 'object' } }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/symphony/cleanup/{id}/resolve': {
        post: {
          operationId: 'resolveSymphonyCleanupItem',
          summary: 'Resolve a cleanup queue item',
          tags,
          parameters: [uuidParam()],
          responses: {
            '200': jsonResponse('Resolved', { type: 'object', properties: { resolved: { type: 'boolean' } } }),
            ...errorResponses(401, 404, 500),
          },
        },
      },
      // ── Metrics (#2206) ──
      '/symphony/metrics': {
        get: {
          operationId: 'getSymphonyMetrics',
          summary: 'Get Prometheus-format Symphony metrics',
          tags,
          responses: {
            '200': { description: 'Prometheus metrics', content: { 'text/plain': { schema: { type: 'string' } } } },
            ...errorResponses(401, 500),
          },
        },
      },
    },
  };
}
