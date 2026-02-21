/**
 * OpenAPI path definitions for health checks, capabilities, and spec endpoints.
 * Routes: GET /api/health, GET /api/health/live, GET /api/health/ready,
 *         GET /api/capabilities, GET /api/openapi.json
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonResponse } from '../helpers.ts';

export function healthPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Health', description: 'Health checks and system status' },
      { name: 'Discovery', description: 'API capability discovery and OpenAPI specification' },
    ],
    schemas: {
      HealthResponse: {
        type: 'object',
        required: ['status', 'timestamp', 'components'],
        properties: {
          status: {
            type: 'string',
            enum: ['healthy', 'degraded', 'unhealthy'],
            description: 'Overall system health status',
            example: 'healthy',
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            description: 'Time of the health check',
            example: '2026-02-21T14:30:00Z',
          },
          components: {
            type: 'object',
            description: 'Per-component health statuses keyed by component name',
            additionalProperties: {
              type: 'object',
              properties: {
                status: {
                  type: 'string',
                  enum: ['healthy', 'degraded', 'unhealthy'],
                  description: 'Health status of this component',
                  example: 'healthy',
                },
                latency_ms: {
                  type: 'number',
                  description: 'Latency of the component check in milliseconds',
                  example: 12.5,
                },
                details: {
                  type: 'object',
                  description: 'Additional component-specific details',
                  properties: {
                    version: {
                      type: 'string',
                      description: 'Version of the component',
                      example: '16.2',
                    },
                    connection_pool_size: {
                      type: 'integer',
                      description: 'Number of connections in the pool',
                      example: 10,
                    },
                  },
                },
              },
              required: ['status'],
            },
            example: {
              database: { status: 'healthy', latency_ms: 12.5, details: { version: '16.2' } },
              embeddings: { status: 'healthy', latency_ms: 45.2 },
            },
          },
        },
      },
      LivenessResponse: {
        type: 'object',
        required: ['status'],
        properties: {
          status: {
            type: 'string',
            description: 'Liveness status indicator, always "ok" if the process is running',
            example: 'ok',
          },
        },
      },
      CapabilitiesResponse: {
        type: 'object',
        required: ['name', 'version', 'description', 'capabilities'],
        properties: {
          name: {
            type: 'string',
            description: 'Name of the API service',
            example: 'openclaw-projects',
          },
          version: {
            type: 'string',
            description: 'Semantic version of the API',
            example: '1.0.0',
          },
          description: {
            type: 'string',
            description: 'Human-readable description of the API service',
            example: 'Project management, memory, and communications backend for OpenClaw agents',
          },
          documentation: {
            type: 'string',
            description: 'Path to the SKILL.md documentation file',
            example: '/docs/SKILL.md',
          },
          authentication: {
            type: 'object',
            description: 'Authentication configuration for the API',
            properties: {
              type: {
                type: 'string',
                description: 'Authentication scheme type',
                example: 'bearer',
              },
              header: {
                type: 'string',
                description: 'HTTP header name for authentication',
                example: 'Authorization',
              },
              format: {
                type: 'string',
                description: 'Expected format of the authentication header value',
                example: 'Bearer <token>',
              },
              envVars: {
                type: 'array',
                items: { type: 'string' },
                description: 'Environment variable names that can provide the authentication token',
                example: ['OPENCLAW_API_TOKEN', 'OPENCLAW_JWT'],
              },
            },
          },
          capabilities: {
            type: 'array',
            description: 'List of API capability groups with their endpoints',
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Name of the capability group',
                  example: 'Task Management',
                },
                description: {
                  type: 'string',
                  description: 'Human-readable description of this capability',
                  example: 'Create, update, and manage tasks and projects',
                },
                endpoints: {
                  type: 'array',
                  description: 'List of endpoints in this capability group',
                  items: {
                    type: 'object',
                    properties: {
                      method: {
                        type: 'string',
                        description: 'HTTP method for the endpoint',
                        example: 'GET',
                      },
                      path: {
                        type: 'string',
                        description: 'URL path for the endpoint',
                        example: '/api/work-items',
                      },
                      description: {
                        type: 'string',
                        description: 'Human-readable description of the endpoint',
                        example: 'List all work items',
                      },
                      parameters: {
                        type: 'object',
                        description: 'Map of parameter names to their descriptions',
                        additionalProperties: { type: 'string' },
                        example: { limit: 'Maximum number of results', offset: 'Number of results to skip' },
                      },
                    },
                  },
                },
              },
            },
          },
          workflows: {
            type: 'array',
            description: 'Common multi-step workflows supported by the API',
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Name of the workflow',
                  example: 'Create and assign a task',
                },
                description: {
                  type: 'string',
                  description: 'Human-readable description of the workflow',
                  example: 'Creates a new task and assigns it to a user within a namespace',
                },
                steps: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Ordered list of steps in the workflow',
                  example: ['POST /api/work-items', 'PATCH /api/work-items/{id}'],
                },
              },
            },
          },
        },
      },
    },
    paths: {
      '/api/health': {
        get: {
          operationId: 'getHealth',
          summary: 'Detailed health check',
          description: 'Returns detailed health status for all system components including database, webhooks, and embeddings. Returns 503 if any critical component is unhealthy.',
          tags: ['Health'],
          security: [],
          responses: {
            '200': jsonResponse('System healthy or degraded', { $ref: '#/components/schemas/HealthResponse' }),
            ...errorResponses(503),
          },
        },
      },
      '/api/health/live': {
        get: {
          operationId: 'getLiveness',
          summary: 'Liveness probe',
          description: 'Simple liveness check that always returns ok if the server process is running. Used by orchestration systems (e.g. Kubernetes) to detect hung processes.',
          tags: ['Health'],
          security: [],
          responses: {
            '200': jsonResponse('Server is alive', { $ref: '#/components/schemas/LivenessResponse' }),
          },
        },
      },
      '/api/health/ready': {
        get: {
          operationId: 'getReadiness',
          summary: 'Readiness probe',
          description: 'Checks that all critical dependencies (database, etc.) are available. Returns 503 if the system is not ready to serve traffic.',
          tags: ['Health'],
          security: [],
          responses: {
            '200': jsonResponse('System ready', { $ref: '#/components/schemas/LivenessResponse' }),
            ...errorResponses(503),
          },
        },
      },
      '/api/capabilities': {
        get: {
          operationId: 'getCapabilities',
          summary: 'API capabilities discovery',
          description: 'Returns a machine-readable description of all API capabilities, endpoints, authentication requirements, and common workflows. Designed for OpenClaw agents to discover available operations.',
          tags: ['Discovery'],
          security: [],
          responses: {
            '200': jsonResponse('Capabilities manifest', { $ref: '#/components/schemas/CapabilitiesResponse' }),
          },
        },
      },
      '/api/openapi.json': {
        get: {
          operationId: 'getOpenApiSpec',
          summary: 'OpenAPI specification',
          description: 'Returns the assembled OpenAPI 3.0.3 specification for this API.',
          tags: ['Discovery'],
          security: [],
          responses: {
            '200': {
              description: 'OpenAPI 3.0.3 specification document',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    description: 'Full OpenAPI 3.0.3 specification document',
                    properties: {
                      openapi: {
                        type: 'string',
                        description: 'OpenAPI specification version',
                        example: '3.0.3',
                      },
                      info: {
                        type: 'object',
                        description: 'API metadata including title, version, and description',
                      },
                      paths: {
                        type: 'object',
                        description: 'Available API paths and their operations',
                      },
                      components: {
                        type: 'object',
                        description: 'Reusable schema components, security schemes, and parameters',
                      },
                    },
                    required: ['openapi', 'info', 'paths'],
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
