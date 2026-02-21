/**
 * OpenAPI path definitions for home automation endpoints.
 * Routes: GET /api/ha/routines, GET /api/ha/routines/:id,
 *         PATCH /api/ha/routines/:id, DELETE /api/ha/routines/:id,
 *         POST /api/ha/routines/:id/confirm, POST /api/ha/routines/:id/reject,
 *         GET /api/ha/routines/:id/observations,
 *         GET /api/ha/anomalies, PATCH /api/ha/anomalies/:id,
 *         GET /api/ha/observations
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonBody, jsonResponse, paginationParams, uuidParam, dataEnvelope } from '../helpers.ts';

export function homeAutomationPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'HomeAutomation', description: 'Home Assistant routine detection, anomaly tracking, and observation queries' },
    ],
    schemas: {
      HaRoutine: {
        type: 'object',
        required: ['id', 'namespace', 'title', 'status', 'confidence', 'sequence', 'occurrence_count', 'created_at', 'updated_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the detected routine',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          namespace: {
            type: 'string',
            description: 'Namespace this routine belongs to',
            example: 'my-workspace',
          },
          title: {
            type: 'string',
            description: 'Human-readable title for the routine',
            example: 'Morning lights sequence',
          },
          description: {
            type: 'string',
            nullable: true,
            description: 'Optional description of what this routine does',
            example: 'Turns on kitchen and living room lights every morning at 7am',
          },
          status: {
            type: 'string',
            enum: ['tentative', 'confirmed', 'rejected', 'archived'],
            description: 'Current status of the routine',
            example: 'tentative',
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Confidence score for the detected routine pattern (0-1)',
            example: 0.85,
          },
          sequence: {
            type: 'array',
            description: 'Ordered sequence of entity state changes that make up the routine',
            items: {
              type: 'object',
              required: ['entity_id', 'state'],
              properties: {
                entity_id: {
                  type: 'string',
                  description: 'Home Assistant entity identifier',
                  example: 'light.living_room',
                },
                state: {
                  type: 'string',
                  description: 'Target state for the entity in this step',
                  example: 'on',
                },
                delay_seconds: {
                  type: 'number',
                  nullable: true,
                  description: 'Delay in seconds before this step executes after the previous one',
                  example: 30,
                },
              },
            },
          },
          time_pattern: {
            type: 'object',
            nullable: true,
            description: 'Detected time pattern for when this routine typically occurs',
            properties: {
              hour: {
                type: 'integer',
                description: 'Typical hour of day (0-23)',
                example: 7,
              },
              minute: {
                type: 'integer',
                description: 'Typical minute of hour (0-59)',
                example: 0,
              },
              days_of_week: {
                type: 'array',
                items: { type: 'string' },
                description: 'Days of the week when the routine typically occurs',
                example: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
              },
              variance_minutes: {
                type: 'number',
                description: 'Typical variance in minutes from the expected time',
                example: 15,
              },
            },
          },
          occurrence_count: {
            type: 'integer',
            description: 'Number of times this routine pattern has been observed',
            example: 14,
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the routine was first detected',
            example: '2026-02-21T14:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the routine was last updated',
            example: '2026-02-21T14:30:00Z',
          },
        },
      },
      HaAnomaly: {
        type: 'object',
        required: ['id', 'namespace', 'entity_id', 'domain', 'description', 'score', 'resolved', 'timestamp', 'created_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the anomaly',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          namespace: {
            type: 'string',
            description: 'Namespace this anomaly belongs to',
            example: 'my-workspace',
          },
          entity_id: {
            type: 'string',
            description: 'Home Assistant entity that exhibited anomalous behavior',
            example: 'light.living_room',
          },
          domain: {
            type: 'string',
            description: 'Home Assistant domain of the entity (e.g. light, switch, sensor)',
            example: 'light',
          },
          description: {
            type: 'string',
            description: 'Human-readable description of the anomaly',
            example: 'Living room light turned on at 3:00 AM, which is unusual',
          },
          score: {
            type: 'integer',
            minimum: 0,
            maximum: 10,
            description: 'Anomaly severity score from 0 (low) to 10 (critical)',
            example: 7,
          },
          resolved: {
            type: 'boolean',
            description: 'Whether the anomaly has been resolved or acknowledged',
            example: false,
          },
          context: {
            type: 'object',
            description: 'Additional context about the anomaly including notes and environmental data',
            properties: {
              expected_state: {
                type: 'string',
                description: 'The state that was expected based on patterns',
                example: 'off',
              },
              actual_state: {
                type: 'string',
                description: 'The actual state that was observed',
                example: 'on',
              },
              notes: {
                type: 'string',
                nullable: true,
                description: 'User-added notes about the anomaly',
                example: 'Cat triggered the motion sensor',
              },
              related_entities: {
                type: 'array',
                items: { type: 'string' },
                description: 'Other entities that may be related to this anomaly',
                example: ['binary_sensor.living_room_motion'],
              },
            },
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the anomalous event occurred',
            example: '2026-02-21T03:00:00Z',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the anomaly record was created',
            example: '2026-02-21T03:01:00Z',
          },
        },
      },
      HaObservation: {
        type: 'object',
        required: ['id', 'namespace', 'entity_id', 'domain', 'state', 'timestamp', 'created_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the observation',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          namespace: {
            type: 'string',
            description: 'Namespace this observation belongs to',
            example: 'my-workspace',
          },
          entity_id: {
            type: 'string',
            description: 'Home Assistant entity identifier that was observed',
            example: 'light.living_room',
          },
          domain: {
            type: 'string',
            description: 'Home Assistant domain of the entity',
            example: 'light',
          },
          state: {
            type: 'string',
            description: 'Observed state of the entity',
            example: 'on',
          },
          attributes: {
            type: 'object',
            description: 'Entity attributes at the time of observation',
            properties: {
              brightness: {
                type: 'number',
                description: 'Brightness level (0-255 for lights)',
                example: 200,
              },
              color_temp: {
                type: 'number',
                description: 'Color temperature in mireds',
                example: 370,
              },
              friendly_name: {
                type: 'string',
                description: 'Human-readable name of the entity',
                example: 'Living Room Light',
              },
            },
          },
          score: {
            type: 'integer',
            nullable: true,
            description: 'Significance score assigned to this observation (0-10)',
            example: 5,
          },
          scene_label: {
            type: 'string',
            nullable: true,
            description: 'Scene or context label assigned to this observation',
            example: 'evening_relax',
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the state change was observed',
            example: '2026-02-21T14:30:00Z',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the observation record was created',
            example: '2026-02-21T14:30:00Z',
          },
        },
      },
    },
    paths: {
      '/api/ha/routines': {
        get: {
          operationId: 'listHaRoutines',
          summary: 'List detected routines',
          description: 'Returns routines with optional filtering by status and minimum confidence. Ordered by confidence descending.',
          tags: ['HomeAutomation'],
          parameters: [
            {
              name: 'status',
              in: 'query',
              description: 'Filter by routine status',
              example: 'tentative',
              schema: { type: 'string', enum: ['tentative', 'confirmed', 'rejected', 'archived'] },
            },
            {
              name: 'min_confidence',
              in: 'query',
              description: 'Minimum confidence threshold (0-1)',
              example: 0.7,
              schema: { type: 'number', minimum: 0, maximum: 1 },
            },
            ...paginationParams(),
          ],
          responses: {
            '200': jsonResponse('Routines', {
              type: 'object',
              required: ['data', 'total', 'limit', 'offset'],
              properties: {
                data: {
                  type: 'array',
                  description: 'List of detected routines',
                  items: { $ref: '#/components/schemas/HaRoutine' },
                },
                total: {
                  type: 'integer',
                  description: 'Total number of routines matching the filter',
                  example: 42,
                },
                limit: {
                  type: 'integer',
                  description: 'Maximum number of results returned',
                  example: 50,
                },
                offset: {
                  type: 'integer',
                  description: 'Number of results skipped',
                  example: 0,
                },
              },
            }),
            ...errorResponses(400, 401, 403, 500),
          },
        },
      },
      '/api/ha/routines/{id}': {
        get: {
          operationId: 'getHaRoutine',
          summary: 'Get a routine',
          description: 'Returns a single routine by ID.',
          tags: ['HomeAutomation'],
          parameters: [uuidParam('id', 'Routine ID')],
          responses: {
            '200': jsonResponse('Routine', dataEnvelope({ $ref: '#/components/schemas/HaRoutine' })),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
        patch: {
          operationId: 'updateHaRoutine',
          summary: 'Update a routine',
          description: 'Updates the title or description of a routine. Requires member role.',
          tags: ['HomeAutomation'],
          parameters: [uuidParam('id', 'Routine ID')],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'New title for the routine',
                example: 'Morning lights and coffee',
              },
              description: {
                type: 'string',
                description: 'New description for the routine',
                example: 'Turns on lights and starts coffee maker at 7am',
              },
            },
          }, false),
          responses: {
            '200': jsonResponse('Updated routine', dataEnvelope({ $ref: '#/components/schemas/HaRoutine' })),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteHaRoutine',
          summary: 'Archive a routine',
          description: 'Soft-deletes a routine by setting status to "archived". Requires member role.',
          tags: ['HomeAutomation'],
          parameters: [uuidParam('id', 'Routine ID')],
          responses: {
            '204': { description: 'Routine archived' },
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },
      '/api/ha/routines/{id}/confirm': {
        post: {
          operationId: 'confirmHaRoutine',
          summary: 'Confirm a routine',
          description: 'Confirms a tentative routine. Cannot confirm an archived routine. Requires member role.',
          tags: ['HomeAutomation'],
          parameters: [uuidParam('id', 'Routine ID')],
          responses: {
            '200': jsonResponse('Confirmed routine', dataEnvelope({ $ref: '#/components/schemas/HaRoutine' })),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },
      '/api/ha/routines/{id}/reject': {
        post: {
          operationId: 'rejectHaRoutine',
          summary: 'Reject a routine',
          description: 'Rejects a tentative routine. Cannot reject an archived routine. Requires member role.',
          tags: ['HomeAutomation'],
          parameters: [uuidParam('id', 'Routine ID')],
          responses: {
            '200': jsonResponse('Rejected routine', dataEnvelope({ $ref: '#/components/schemas/HaRoutine' })),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },
      '/api/ha/routines/{id}/observations': {
        get: {
          operationId: 'getRoutineObservations',
          summary: 'Get observations matching a routine',
          description: 'Returns observations for entity IDs in the routine sequence, scoped to the routine namespace.',
          tags: ['HomeAutomation'],
          parameters: [
            uuidParam('id', 'Routine ID'),
            ...paginationParams(),
          ],
          responses: {
            '200': jsonResponse('Routine observations', {
              type: 'object',
              required: ['data', 'total', 'limit', 'offset'],
              properties: {
                data: {
                  type: 'array',
                  description: 'Observations matching the routine entities',
                  items: { $ref: '#/components/schemas/HaObservation' },
                },
                total: {
                  type: 'integer',
                  description: 'Total number of matching observations',
                  example: 42,
                },
                limit: {
                  type: 'integer',
                  description: 'Maximum number of results returned',
                  example: 50,
                },
                offset: {
                  type: 'integer',
                  description: 'Number of results skipped',
                  example: 0,
                },
              },
            }),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },
      '/api/ha/anomalies': {
        get: {
          operationId: 'listHaAnomalies',
          summary: 'List anomalies',
          description: 'Returns anomalies with optional filtering by resolved status and minimum score.',
          tags: ['HomeAutomation'],
          parameters: [
            {
              name: 'resolved',
              in: 'query',
              description: 'Filter by resolved status',
              example: 'false',
              schema: { type: 'string', enum: ['true', 'false'] },
            },
            {
              name: 'min_score',
              in: 'query',
              description: 'Minimum anomaly score (0-10)',
              example: 5,
              schema: { type: 'integer', minimum: 0, maximum: 10 },
            },
            ...paginationParams(),
          ],
          responses: {
            '200': jsonResponse('Anomalies', {
              type: 'object',
              required: ['data', 'total', 'limit', 'offset'],
              properties: {
                data: {
                  type: 'array',
                  description: 'List of anomalies',
                  items: { $ref: '#/components/schemas/HaAnomaly' },
                },
                total: {
                  type: 'integer',
                  description: 'Total number of anomalies matching the filter',
                  example: 42,
                },
                limit: {
                  type: 'integer',
                  description: 'Maximum number of results returned',
                  example: 50,
                },
                offset: {
                  type: 'integer',
                  description: 'Number of results skipped',
                  example: 0,
                },
              },
            }),
            ...errorResponses(400, 401, 403, 500),
          },
        },
      },
      '/api/ha/anomalies/{id}': {
        patch: {
          operationId: 'updateHaAnomaly',
          summary: 'Update an anomaly',
          description: 'Updates resolved status or adds notes to an anomaly. Notes are stored in the context JSONB field. Requires member role.',
          tags: ['HomeAutomation'],
          parameters: [uuidParam('id', 'Anomaly ID')],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              resolved: {
                type: 'boolean',
                description: 'Set resolved status of the anomaly',
                example: true,
              },
              notes: {
                type: 'string',
                description: 'Notes to add to the anomaly context',
                example: 'Cat triggered the motion sensor',
              },
            },
          }, false),
          responses: {
            '200': jsonResponse('Updated anomaly', dataEnvelope({ $ref: '#/components/schemas/HaAnomaly' })),
            ...errorResponses(400, 401, 403, 404, 500),
          },
        },
      },
      '/api/ha/observations': {
        get: {
          operationId: 'listHaObservations',
          summary: 'Query observations',
          description: 'Returns observations with optional filtering by entity_id, domain, min_score, scene_label, and time range.',
          tags: ['HomeAutomation'],
          parameters: [
            {
              name: 'entity_id',
              in: 'query',
              description: 'Filter by Home Assistant entity ID',
              example: 'light.living_room',
              schema: { type: 'string' },
            },
            {
              name: 'domain',
              in: 'query',
              description: 'Filter by Home Assistant domain',
              example: 'light',
              schema: { type: 'string' },
            },
            {
              name: 'min_score',
              in: 'query',
              description: 'Minimum significance score (0-10)',
              example: 5,
              schema: { type: 'integer', minimum: 0, maximum: 10 },
            },
            {
              name: 'scene_label',
              in: 'query',
              description: 'Filter by scene label',
              example: 'evening_relax',
              schema: { type: 'string' },
            },
            {
              name: 'from',
              in: 'query',
              description: 'Start of time range (ISO 8601)',
              example: '2026-02-20T00:00:00Z',
              schema: { type: 'string', format: 'date-time' },
            },
            {
              name: 'to',
              in: 'query',
              description: 'End of time range (ISO 8601)',
              example: '2026-02-21T23:59:59Z',
              schema: { type: 'string', format: 'date-time' },
            },
            ...paginationParams(),
          ],
          responses: {
            '200': jsonResponse('Observations', {
              type: 'object',
              required: ['data', 'total', 'limit', 'offset'],
              properties: {
                data: {
                  type: 'array',
                  description: 'List of observations',
                  items: { $ref: '#/components/schemas/HaObservation' },
                },
                total: {
                  type: 'integer',
                  description: 'Total number of observations matching the filter',
                  example: 42,
                },
                limit: {
                  type: 'integer',
                  description: 'Maximum number of results returned',
                  example: 50,
                },
                offset: {
                  type: 'integer',
                  description: 'Number of results skipped',
                  example: 0,
                },
              },
            }),
            ...errorResponses(400, 401, 403, 500),
          },
        },
      },
    },
  };
}
