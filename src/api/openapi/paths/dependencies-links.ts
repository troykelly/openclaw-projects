/**
 * OpenAPI path definitions for dependencies, external links, and participants.
 * Routes: GET/POST/DELETE /api/work-items/{id}/dependencies,
 *         GET /api/work-items/{id}/dependency-graph,
 *         GET/POST/DELETE /api/work-items/{id}/links,
 *         GET/POST/DELETE /api/work-items/{id}/participants
 */
import type { OpenApiDomainModule } from '../types.ts';
import { ref, uuidParam, errorResponses, jsonBody, jsonResponse } from '../helpers.ts';

export function dependenciesLinksPaths(): OpenApiDomainModule {
  const workItemIdParam = uuidParam('id', 'Work item UUID');

  return {
    tags: [
      { name: 'Dependencies', description: 'Work item dependency management and graph analysis' },
      { name: 'External Links', description: 'Links to external systems (GitHub, etc.)' },
      { name: 'Participants', description: 'Work item participant management' },
    ],

    schemas: {
      Dependency: {
        type: 'object',
        required: ['id', 'work_item_id', 'depends_on_work_item_id', 'kind', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the dependency relationship', example: 'e4f5a6b7-8901-23cd-ef45-678901234567' },
          work_item_id: { type: 'string', format: 'uuid', description: 'UUID of the work item that has this dependency', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          depends_on_work_item_id: { type: 'string', format: 'uuid', description: 'UUID of the work item this depends on (the blocker)', example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
          kind: { type: 'string', description: 'Type of dependency relationship', example: 'depends_on' },
          depends_on_title: { type: 'string', description: 'Title of the blocking work item for display', example: 'Set up database schema' },
          created_at: { type: 'string', format: 'date-time', description: 'When the dependency was created', example: '2026-02-21T14:30:00Z' },
        },
      },
      DependencyCreate: {
        type: 'object',
        required: ['depends_on_work_item_id'],
        properties: {
          depends_on_work_item_id: { type: 'string', format: 'uuid', description: 'UUID of the work item this should depend on', example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
          kind: { type: 'string', default: 'depends_on', description: 'Type of dependency (default: depends_on)', example: 'depends_on' },
        },
      },
      DependencyGraphNode: {
        type: 'object',
        required: ['id', 'title', 'kind', 'status', 'level', 'is_blocker'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'UUID of the work item node', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          title: { type: 'string', description: 'Title of the work item', example: 'Implement user authentication' },
          kind: { type: 'string', description: 'Hierarchy level (project, initiative, epic, issue, task)', example: 'task' },
          status: { type: 'string', description: 'Current workflow status', example: 'in_progress' },
          priority: { type: 'string', description: 'Priority ranking (P0-P4)', example: 'P1' },
          parent_id: { type: 'string', format: 'uuid', nullable: true, description: 'UUID of the parent work item', example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
          level: { type: 'integer', description: 'Depth level in the hierarchy', example: 2 },
          not_before: { type: 'string', format: 'date-time', nullable: true, description: 'Start date of the work item', example: '2026-03-01T09:00:00Z' },
          not_after: { type: 'string', format: 'date-time', nullable: true, description: 'Deadline of the work item', example: '2026-03-15T17:00:00Z' },
          estimate_minutes: { type: 'integer', nullable: true, description: 'Estimated effort in minutes', example: 120 },
          actual_minutes: { type: 'integer', nullable: true, description: 'Actual effort spent in minutes', example: 90 },
          is_blocker: { type: 'boolean', description: 'Whether this item is currently blocking other open items', example: true },
        },
      },
      DependencyGraphEdge: {
        type: 'object',
        required: ['id', 'source', 'target', 'kind'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'UUID of the dependency edge', example: 'e4f5a6b7-8901-23cd-ef45-678901234567' },
          source: { type: 'string', format: 'uuid', description: 'UUID of the source (blocking) work item', example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
          target: { type: 'string', format: 'uuid', description: 'UUID of the target (blocked) work item', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          kind: { type: 'string', description: 'Type of dependency relationship', example: 'depends_on' },
        },
      },
      CriticalPathItem: {
        type: 'object',
        required: ['id', 'title'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'UUID of the work item on the critical path', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          title: { type: 'string', description: 'Title of the work item', example: 'Set up database schema' },
          estimate_minutes: { type: 'integer', nullable: true, description: 'Estimated effort contributing to the critical path length', example: 120 },
        },
      },
      DependencyGraphResponse: {
        type: 'object',
        required: ['nodes', 'edges', 'critical_path'],
        properties: {
          nodes: { type: 'array', items: { $ref: '#/components/schemas/DependencyGraphNode' }, description: 'Work items in the dependency graph as nodes' },
          edges: { type: 'array', items: { $ref: '#/components/schemas/DependencyGraphEdge' }, description: 'Dependency relationships as directed edges' },
          critical_path: {
            type: 'array',
            items: { $ref: '#/components/schemas/CriticalPathItem' },
            description: 'Longest path through the dependency graph by total estimate sum, identifying the project bottleneck',
          },
        },
      },
      ExternalLink: {
        type: 'object',
        required: ['id', 'work_item_id', 'provider', 'url', 'external_id', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the external link', example: 'f5a6b7c8-9012-34de-f567-890123456789' },
          work_item_id: { type: 'string', format: 'uuid', description: 'UUID of the work item this link belongs to', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          provider: { type: 'string', description: 'External system provider name', example: 'github' },
          url: { type: 'string', format: 'uri', description: 'URL of the external resource', example: 'https://github.com/acme/app/issues/42' },
          external_id: { type: 'string', description: 'Identifier of the resource in the external system', example: 'acme/app#42' },
          github_owner: { type: 'string', nullable: true, description: 'GitHub repository owner (for GitHub links)', example: 'acme' },
          github_repo: { type: 'string', nullable: true, description: 'GitHub repository name (for GitHub links)', example: 'app' },
          github_kind: { type: 'string', nullable: true, description: 'GitHub resource type (issue, pull_request, project)', example: 'issue' },
          github_number: { type: 'integer', nullable: true, description: 'GitHub issue or PR number', example: 42 },
          github_node_id: { type: 'string', nullable: true, description: 'GitHub GraphQL node ID', example: 'I_kwDOBxxxxxx' },
          github_project_node_id: { type: 'string', nullable: true, description: 'GitHub project GraphQL node ID', example: 'PVT_kwHOBxxxxxx' },
          created_at: { type: 'string', format: 'date-time', description: 'When the link was created', example: '2026-02-21T14:30:00Z' },
        },
      },
      ExternalLinkCreate: {
        type: 'object',
        required: ['provider', 'url', 'external_id'],
        properties: {
          provider: { type: 'string', description: 'External system provider name (e.g. github, jira)', example: 'github' },
          url: { type: 'string', format: 'uri', description: 'URL of the external resource', example: 'https://github.com/acme/app/issues/42' },
          external_id: { type: 'string', description: 'Unique identifier in the external system', example: 'acme/app#42' },
          github_owner: { type: 'string', description: 'GitHub repository owner (required for GitHub links)', example: 'acme' },
          github_repo: { type: 'string', description: 'GitHub repository name (required for GitHub links)', example: 'app' },
          github_kind: { type: 'string', description: 'GitHub resource type (required for GitHub links: issue, pull_request, project)', example: 'issue' },
          github_number: { type: 'integer', description: 'GitHub issue or PR number (required for GitHub issues and PRs)', example: 42 },
          github_node_id: { type: 'string', nullable: true, description: 'GitHub GraphQL node ID for API operations', example: 'I_kwDOBxxxxxx' },
          github_project_node_id: { type: 'string', nullable: true, description: 'GitHub project GraphQL node ID', example: 'PVT_kwHOBxxxxxx' },
        },
      },
      Participant: {
        type: 'object',
        required: ['id', 'work_item_id', 'participant', 'role', 'created_at'],
        properties: {
          id: { type: 'string', format: 'uuid', description: 'Unique identifier for the participant record', example: 'a6b7c8d9-0123-45ef-6789-012345678901' },
          work_item_id: { type: 'string', format: 'uuid', description: 'UUID of the work item this participant belongs to', example: 'd290f1ee-6c54-4b01-90e6-d701748f0851' },
          participant: { type: 'string', description: 'Participant identifier (e.g. email address or display name)', example: 'alice@example.com' },
          role: { type: 'string', description: 'Role of the participant on this work item', example: 'assignee' },
          created_at: { type: 'string', format: 'date-time', description: 'When the participant was added', example: '2026-02-21T14:30:00Z' },
        },
      },
      ParticipantCreate: {
        type: 'object',
        required: ['participant', 'role'],
        properties: {
          participant: { type: 'string', description: 'Participant identifier (e.g. email address or display name)', example: 'alice@example.com' },
          role: { type: 'string', description: 'Role to assign (e.g. assignee, reviewer, observer)', example: 'assignee' },
        },
      },
    },

    paths: {
      // ==================== Dependencies ====================
      '/api/work-items/{id}/dependencies': {
        parameters: [workItemIdParam],
        get: {
          operationId: 'listWorkItemDependencies',
          summary: 'List dependencies for a work item',
          description: 'Returns items that this work item depends on.',
          tags: ['Dependencies'],
          responses: {
            '200': jsonResponse('Dependencies', {
              type: 'object',
              properties: {
                items: { type: 'array', description: 'Array of dependency relationships', items: ref('Dependency') },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
        post: {
          operationId: 'createWorkItemDependency',
          summary: 'Create a dependency',
          description: 'Creates a dependency relationship between two work items. Validates that both items exist, prevents self-references and cycles. For depends_on relationships, may auto-adjust the not_before date based on blockers.',
          tags: ['Dependencies'],
          requestBody: jsonBody(ref('DependencyCreate')),
          responses: {
            '201': jsonResponse('Created dependency', ref('Dependency')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/work-items/{id}/dependencies/{dependency_id}': {
        parameters: [
          workItemIdParam,
          uuidParam('dependency_id', 'Dependency UUID'),
        ],
        delete: {
          operationId: 'deleteWorkItemDependency',
          summary: 'Delete a dependency',
          description: 'Removes a dependency relationship between two work items.',
          tags: ['Dependencies'],
          responses: {
            '204': { description: 'Dependency deleted' },
            ...errorResponses(401, 404, 500),
          },
        },
      },

      '/api/work-items/{id}/dependency-graph': {
        parameters: [workItemIdParam],
        get: {
          operationId: 'getWorkItemDependencyGraph',
          summary: 'Get dependency graph for a work item subtree',
          description: 'Returns a graph representation of all descendants and their inter-dependencies. Identifies blockers and computes the critical path (longest chain by estimate sum).',
          tags: ['Dependencies'],
          responses: {
            '200': jsonResponse('Dependency graph', ref('DependencyGraphResponse')),
            ...errorResponses(401, 404, 500),
          },
        },
      },

      // ==================== External Links ====================
      '/api/work-items/{id}/links': {
        parameters: [workItemIdParam],
        get: {
          operationId: 'listWorkItemLinks',
          summary: 'List external links for a work item',
          description: 'Returns all external links (GitHub issues, PRs, projects, etc.) associated with a work item.',
          tags: ['External Links'],
          responses: {
            '200': jsonResponse('External links', {
              type: 'object',
              properties: {
                items: { type: 'array', description: 'Array of external link records', items: ref('ExternalLink') },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
        post: {
          operationId: 'createWorkItemLink',
          summary: 'Create an external link',
          description: 'Links a work item to an external resource. For GitHub links, additional fields (github_owner, github_repo, github_kind) are required.',
          tags: ['External Links'],
          requestBody: jsonBody(ref('ExternalLinkCreate')),
          responses: {
            '201': jsonResponse('Created link', ref('ExternalLink')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/work-items/{id}/links/{link_id}': {
        parameters: [
          workItemIdParam,
          uuidParam('link_id', 'External link UUID'),
        ],
        delete: {
          operationId: 'deleteWorkItemLink',
          summary: 'Delete an external link',
          description: 'Removes the external link from the work item.',
          tags: ['External Links'],
          responses: {
            '204': { description: 'Link deleted' },
            ...errorResponses(401, 404, 500),
          },
        },
      },

      // ==================== Participants ====================
      '/api/work-items/{id}/participants': {
        parameters: [workItemIdParam],
        get: {
          operationId: 'listWorkItemParticipants',
          summary: 'List participants for a work item',
          description: 'Returns all participants assigned to a work item with their roles.',
          tags: ['Participants'],
          responses: {
            '200': jsonResponse('Participants', {
              type: 'object',
              properties: {
                items: { type: 'array', description: 'Array of participant records', items: ref('Participant') },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
        post: {
          operationId: 'addWorkItemParticipant',
          summary: 'Add a participant to a work item',
          description: 'Adds a participant with a specific role. Upserts on conflict (same participant + role).',
          tags: ['Participants'],
          requestBody: jsonBody(ref('ParticipantCreate')),
          responses: {
            '201': jsonResponse('Added participant', ref('Participant')),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },

      '/api/work-items/{id}/participants/{participant_id}': {
        parameters: [
          workItemIdParam,
          uuidParam('participant_id', 'Participant UUID'),
        ],
        delete: {
          operationId: 'removeWorkItemParticipant',
          summary: 'Remove a participant from a work item',
          description: 'Removes a participant record from a work item.',
          tags: ['Participants'],
          responses: {
            '204': { description: 'Participant removed' },
            ...errorResponses(401, 404, 500),
          },
        },
      },
    },
  };
}
