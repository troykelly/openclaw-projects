/**
 * OpenAPI path definitions for geolocation endpoints.
 * Routes: POST /api/geolocation/providers, GET /api/geolocation/providers,
 *         GET /api/geolocation/providers/:id, PATCH /api/geolocation/providers/:id,
 *         DELETE /api/geolocation/providers/:id,
 *         POST /api/geolocation/providers/:id/verify,
 *         GET /api/geolocation/providers/:id/entities,
 *         GET /api/geolocation/subscriptions, PATCH /api/geolocation/subscriptions/:id,
 *         GET /api/geolocation/current, GET /api/geolocation/history
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonBody, jsonResponse, uuidParam } from '../helpers.ts';

export function geolocationPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Geolocation', description: 'Geolocation provider management, entity discovery, and location tracking' },
    ],
    schemas: {
      GeoProvider: {
        type: 'object',
        required: ['id', 'owner_email', 'provider_type', 'auth_type', 'label', 'is_shared', 'created_at', 'updated_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the geolocation provider',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          owner_email: {
            type: 'string',
            description: 'Email of the user who owns this provider',
            example: 'alice@example.com',
          },
          provider_type: {
            type: 'string',
            enum: ['home_assistant', 'mqtt', 'webhook'],
            description: 'Type of geolocation provider',
            example: 'home_assistant',
          },
          auth_type: {
            type: 'string',
            enum: ['oauth2', 'access_token', 'mqtt_credentials', 'webhook_token'],
            description: 'Authentication method used by the provider',
            example: 'access_token',
          },
          label: {
            type: 'string',
            description: 'Human-readable label for the provider',
            example: 'Home Assistant - Home',
          },
          config: {
            type: 'object',
            description: 'Provider-specific configuration settings',
            properties: {
              url: {
                type: 'string',
                description: 'Base URL of the provider API',
                example: 'https://ha.example.com',
              },
              entity_filter: {
                type: 'string',
                description: 'Filter pattern for which entities to track',
                example: 'device_tracker.*',
              },
            },
          },
          credentials: {
            type: 'string',
            nullable: true,
            description: 'Encrypted credentials (only returned to the owner)',
            example: null,
          },
          poll_interval_seconds: {
            type: 'number',
            nullable: true,
            description: 'How often to poll the provider for location updates, in seconds',
            example: 300,
          },
          max_age_seconds: {
            type: 'number',
            nullable: true,
            description: 'Maximum age of a location reading before it is considered stale, in seconds',
            example: 600,
          },
          is_shared: {
            type: 'boolean',
            description: 'Whether this provider is shared with other users in the namespace',
            example: false,
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the provider was created',
            example: '2026-02-21T14:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the provider was last updated',
            example: '2026-02-21T14:30:00Z',
          },
        },
      },
      GeoSubscription: {
        type: 'object',
        required: ['id', 'provider_id', 'user_email', 'priority', 'is_active', 'created_at', 'updated_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the subscription',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          provider_id: {
            type: 'string',
            format: 'uuid',
            description: 'ID of the geolocation provider being subscribed to',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          user_email: {
            type: 'string',
            description: 'Email of the subscribed user',
            example: 'alice@example.com',
          },
          priority: {
            type: 'integer',
            description: 'Priority of this subscription (higher values are preferred when resolving location)',
            example: 10,
          },
          is_active: {
            type: 'boolean',
            description: 'Whether this subscription is currently active',
            example: true,
          },
          entities: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of entity IDs being tracked through this subscription',
            example: ['device_tracker.phone', 'device_tracker.tablet'],
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the subscription was created',
            example: '2026-02-21T14:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the subscription was last updated',
            example: '2026-02-21T14:30:00Z',
          },
        },
      },
      GeoLocation: {
        type: 'object',
        required: ['latitude', 'longitude', 'timestamp'],
        properties: {
          latitude: {
            type: 'number',
            description: 'Latitude coordinate in decimal degrees',
            example: -33.8688,
          },
          longitude: {
            type: 'number',
            description: 'Longitude coordinate in decimal degrees',
            example: 151.2093,
          },
          accuracy: {
            type: 'number',
            nullable: true,
            description: 'Location accuracy radius in meters',
            example: 10.5,
          },
          source: {
            type: 'string',
            nullable: true,
            description: 'Source of the location reading (provider label or entity ID)',
            example: 'device_tracker.phone',
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the location was recorded',
            example: '2026-02-21T14:30:00Z',
          },
        },
      },
      GeoVerifyResult: {
        type: 'object',
        required: ['ok'],
        properties: {
          ok: {
            type: 'boolean',
            description: 'Whether the provider connection test was successful',
            example: true,
          },
          message: {
            type: 'string',
            nullable: true,
            description: 'Status message or error description',
            example: 'Connection successful, 3 trackable entities found',
          },
          entities_found: {
            type: 'integer',
            nullable: true,
            description: 'Number of trackable entities discovered during verification',
            example: 3,
          },
        },
      },
      GeoEntity: {
        type: 'object',
        required: ['entity_id'],
        properties: {
          entity_id: {
            type: 'string',
            description: 'Unique entity identifier from the provider',
            example: 'device_tracker.phone',
          },
          name: {
            type: 'string',
            nullable: true,
            description: 'Human-readable name of the entity',
            example: 'Alice\'s Phone',
          },
          type: {
            type: 'string',
            nullable: true,
            description: 'Type category of the entity (e.g. device_tracker, zone)',
            example: 'device_tracker',
          },
        },
      },
    },
    paths: {
      '/api/geolocation/providers': {
        post: {
          operationId: 'createGeoProvider',
          summary: 'Create a geolocation provider',
          description: 'Registers a new geolocation provider (Home Assistant, MQTT, or webhook). Validates config via registry plugin and auto-creates a subscription for the owner.',
          tags: ['Geolocation'],
          requestBody: jsonBody({
            type: 'object',
            required: ['provider_type', 'auth_type', 'label', 'config'],
            properties: {
              provider_type: {
                type: 'string',
                enum: ['home_assistant', 'mqtt', 'webhook'],
                description: 'Type of geolocation provider to register',
                example: 'home_assistant',
              },
              auth_type: {
                type: 'string',
                enum: ['oauth2', 'access_token', 'mqtt_credentials', 'webhook_token'],
                description: 'Authentication method used by the provider',
                example: 'access_token',
              },
              label: {
                type: 'string',
                description: 'Human-readable label for the provider',
                example: 'Home Assistant - Home',
              },
              config: {
                type: 'object',
                description: 'Provider-specific configuration (e.g. URL, entity filters)',
                properties: {
                  url: {
                    type: 'string',
                    description: 'Base URL of the provider API',
                    example: 'https://ha.example.com',
                  },
                  entity_filter: {
                    type: 'string',
                    description: 'Filter pattern for entities to track',
                    example: 'device_tracker.*',
                  },
                },
              },
              credentials: {
                type: 'string',
                description: 'Raw credentials (will be encrypted at rest)',
                example: 'ha_longlivedtoken_abc123',
              },
              poll_interval_seconds: {
                type: 'number',
                description: 'How often to poll for location updates, in seconds',
                example: 300,
              },
              max_age_seconds: {
                type: 'number',
                description: 'Maximum age of a location reading before considered stale',
                example: 600,
              },
              is_shared: {
                type: 'boolean',
                description: 'Whether to share this provider with other namespace members',
                example: false,
              },
            },
          }),
          responses: {
            '201': jsonResponse('Provider created', { $ref: '#/components/schemas/GeoProvider' }),
            ...errorResponses(400, 401, 429, 500),
          },
        },
        get: {
          operationId: 'listGeoProviders',
          summary: 'List geolocation providers',
          description: 'Returns all providers owned by or subscribed to by the authenticated user. Credentials and config are stripped for non-owners.',
          tags: ['Geolocation'],
          responses: {
            '200': jsonResponse('Provider list', {
              type: 'array',
              items: { $ref: '#/components/schemas/GeoProvider' },
            }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/api/geolocation/providers/{id}': {
        get: {
          operationId: 'getGeoProvider',
          summary: 'Get a geolocation provider',
          description: 'Returns details of a geolocation provider. Only accessible to owner or subscribers.',
          tags: ['Geolocation'],
          parameters: [uuidParam('id', 'Provider ID')],
          responses: {
            '200': jsonResponse('Provider details', { $ref: '#/components/schemas/GeoProvider' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        patch: {
          operationId: 'updateGeoProvider',
          summary: 'Update a geolocation provider',
          description: 'Updates provider settings. Only the owner can update. Sends a pg NOTIFY for worker config reload.',
          tags: ['Geolocation'],
          parameters: [uuidParam('id', 'Provider ID')],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              label: {
                type: 'string',
                description: 'New human-readable label for the provider',
                example: 'Home Assistant - Office',
              },
              config: {
                type: 'object',
                description: 'Updated provider-specific configuration',
                properties: {
                  url: {
                    type: 'string',
                    description: 'Base URL of the provider API',
                    example: 'https://ha.example.com',
                  },
                  entity_filter: {
                    type: 'string',
                    description: 'Filter pattern for entities to track',
                    example: 'device_tracker.*',
                  },
                },
              },
              credentials: {
                type: 'string',
                description: 'New raw credentials (will be encrypted)',
                example: 'ha_longlivedtoken_xyz789',
              },
              poll_interval_seconds: {
                type: 'number',
                description: 'Updated poll interval in seconds',
                example: 60,
              },
              max_age_seconds: {
                type: 'number',
                description: 'Updated maximum age for location readings',
                example: 300,
              },
              is_shared: {
                type: 'boolean',
                description: 'Whether to share this provider',
                example: true,
              },
            },
          }, false),
          responses: {
            '200': jsonResponse('Updated provider', { $ref: '#/components/schemas/GeoProvider' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteGeoProvider',
          summary: 'Soft-delete a geolocation provider',
          description: 'Soft-deletes a provider owned by the authenticated user. Fails with 409 if other subscribers exist.',
          tags: ['Geolocation'],
          parameters: [uuidParam('id', 'Provider ID')],
          responses: {
            '204': { description: 'Provider deleted' },
            ...errorResponses(400, 401, 404, 409, 500),
          },
        },
      },
      '/api/geolocation/providers/{id}/verify': {
        post: {
          operationId: 'verifyGeoProvider',
          summary: 'Test provider connection',
          description: 'Tests the connection to the geolocation provider using stored credentials.',
          tags: ['Geolocation'],
          parameters: [uuidParam('id', 'Provider ID')],
          responses: {
            '200': jsonResponse('Verification result', { $ref: '#/components/schemas/GeoVerifyResult' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
      '/api/geolocation/providers/ha/authorize': {
        post: {
          operationId: 'authorizeHaProvider',
          summary: 'Initiate Home Assistant OAuth flow',
          description: 'Creates a geo_provider in connecting state, generates OAuth state, and returns the HA authorization URL. Uses POST to prevent CSRF.',
          tags: ['Geolocation'],
          requestBody: jsonBody({
            type: 'object',
            required: ['instance_url', 'label'],
            properties: {
              instance_url: {
                type: 'string',
                description: 'Base URL of the Home Assistant instance',
                example: 'https://ha.example.com',
              },
              label: {
                type: 'string',
                description: 'Human-readable label for the provider',
                example: 'Home Assistant - Home',
              },
            },
          }),
          responses: {
            '200': jsonResponse('OAuth authorization URL and provider ID', {
              type: 'object',
              required: ['url', 'provider_id'],
              properties: {
                url: {
                  type: 'string',
                  description: 'HA OAuth authorization URL to redirect the user to',
                  example: 'https://ha.example.com/auth/authorize?client_id=...',
                },
                provider_id: {
                  type: 'string',
                  format: 'uuid',
                  description: 'ID of the newly created geo_provider',
                  example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
                },
              },
            }),
            ...errorResponses(400, 401, 409, 429, 500),
          },
        },
      },
      '/api/geolocation/providers/{id}/entities': {
        get: {
          operationId: 'discoverGeoEntities',
          summary: 'Discover trackable entities',
          description: 'Discovers trackable entities (devices, zones, etc.) from the geolocation provider.',
          tags: ['Geolocation'],
          parameters: [uuidParam('id', 'Provider ID')],
          responses: {
            '200': jsonResponse('Discovered entities', {
              type: 'array',
              items: { $ref: '#/components/schemas/GeoEntity' },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
      '/api/geolocation/subscriptions': {
        get: {
          operationId: 'listGeoSubscriptions',
          summary: 'List geolocation subscriptions',
          description: 'Returns all geolocation provider subscriptions for the authenticated user.',
          tags: ['Geolocation'],
          responses: {
            '200': jsonResponse('Subscriptions', {
              type: 'array',
              items: { $ref: '#/components/schemas/GeoSubscription' },
            }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/api/geolocation/subscriptions/{id}': {
        patch: {
          operationId: 'updateGeoSubscription',
          summary: 'Update a geolocation subscription',
          description: 'Updates priority, active status, or tracked entities for a subscription owned by the authenticated user.',
          tags: ['Geolocation'],
          parameters: [uuidParam('id', 'Subscription ID')],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              priority: {
                type: 'integer',
                minimum: 0,
                description: 'New priority for this subscription (higher = preferred)',
                example: 20,
              },
              is_active: {
                type: 'boolean',
                description: 'Whether to activate or deactivate the subscription',
                example: true,
              },
              entities: {
                type: 'array',
                items: { type: 'string' },
                description: 'Updated list of entity IDs to track',
                example: ['device_tracker.phone', 'device_tracker.watch'],
              },
            },
          }, false),
          responses: {
            '200': jsonResponse('Updated subscription', { $ref: '#/components/schemas/GeoSubscription' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
      '/api/geolocation/current': {
        get: {
          operationId: 'getCurrentLocation',
          summary: 'Get current location',
          description: 'Resolves the current location of the authenticated user from the highest-priority active provider.',
          tags: ['Geolocation'],
          responses: {
            '200': jsonResponse('Current location', { $ref: '#/components/schemas/GeoLocation' }),
            ...errorResponses(401, 404, 500),
          },
        },
      },
      '/api/geolocation/history': {
        get: {
          operationId: 'getLocationHistory',
          summary: 'Query location history',
          description: 'Returns location history for the authenticated user within a time range. Defaults to the last 24 hours.',
          tags: ['Geolocation'],
          parameters: [
            {
              name: 'from',
              in: 'query',
              description: 'Start of time range (ISO 8601, default: 24h ago)',
              example: '2026-02-20T14:30:00Z',
              schema: { type: 'string', format: 'date-time' },
            },
            {
              name: 'to',
              in: 'query',
              description: 'End of time range (ISO 8601, default: now)',
              example: '2026-02-21T14:30:00Z',
              schema: { type: 'string', format: 'date-time' },
            },
            {
              name: 'limit',
              in: 'query',
              description: 'Maximum results (max 1000)',
              example: 100,
              schema: { type: 'integer', default: 100, maximum: 1000 },
            },
          ],
          responses: {
            '200': jsonResponse('Location history', {
              type: 'object',
              required: ['locations', 'from', 'to', 'limit'],
              properties: {
                locations: {
                  type: 'array',
                  description: 'List of location readings in chronological order',
                  items: { $ref: '#/components/schemas/GeoLocation' },
                },
                from: {
                  type: 'string',
                  format: 'date-time',
                  description: 'Start of the returned time range',
                  example: '2026-02-20T14:30:00Z',
                },
                to: {
                  type: 'string',
                  format: 'date-time',
                  description: 'End of the returned time range',
                  example: '2026-02-21T14:30:00Z',
                },
                limit: {
                  type: 'integer',
                  description: 'Maximum number of results that were requested',
                  example: 100,
                },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },
    },
  };
}
