/**
 * OpenAPI path definitions for pantry inventory endpoints.
 * Routes: POST /api/pantry, GET /api/pantry, GET /api/pantry/expiring,
 *         GET /api/pantry/:id, PATCH /api/pantry/:id,
 *         POST /api/pantry/:id/deplete, DELETE /api/pantry/:id
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonBody, jsonResponse, paginationParams, uuidParam } from '../helpers.ts';

export function pantryPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Pantry', description: 'Pantry inventory tracking with expiry alerts, leftover management, and depletion' },
    ],
    schemas: {
      PantryItem: {
        type: 'object',
        required: ['id', 'name', 'location', 'is_leftover', 'added_date', 'use_soon', 'is_depleted', 'created_at', 'updated_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the pantry item',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          name: {
            type: 'string',
            description: 'Name of the pantry item',
            example: 'Olive oil',
          },
          location: {
            type: 'string',
            description: 'Storage location (e.g., fridge, pantry, freezer)',
            example: 'pantry',
          },
          quantity: {
            type: 'string',
            nullable: true,
            description: 'Quantity description with optional unit',
            example: '500ml',
          },
          category: {
            type: 'string',
            nullable: true,
            description: 'Category for grouping items',
            example: 'oils-and-condiments',
          },
          is_leftover: {
            type: 'boolean',
            description: 'Whether this item is a leftover from a cooked meal',
            example: false,
          },
          leftover_dish: {
            type: 'string',
            nullable: true,
            description: 'Name of the dish this leftover came from',
            example: 'Chicken Parmesan',
          },
          leftover_portions: {
            type: 'integer',
            nullable: true,
            description: 'Number of remaining leftover portions',
            example: 3,
          },
          meal_log_id: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description: 'Reference to the meal log entry that produced this leftover',
            example: 'a1b2c3d4-5e6f-7a8b-9c0d-e1f2a3b4c5d6',
          },
          added_date: {
            type: 'string',
            format: 'date',
            description: 'Date the item was added to the pantry',
            example: '2026-02-21',
          },
          use_by_date: {
            type: 'string',
            format: 'date',
            nullable: true,
            description: 'Date by which the item should be used',
            example: '2026-03-15',
          },
          use_soon: {
            type: 'boolean',
            description: 'Whether the item should be used soon (manually flagged or approaching expiry)',
            example: false,
          },
          notes: {
            type: 'string',
            nullable: true,
            description: 'Additional notes about the item',
            example: 'Extra virgin, imported from Italy',
          },
          is_depleted: {
            type: 'boolean',
            description: 'Whether the item has been fully consumed',
            example: false,
          },
          depleted_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Timestamp when the item was marked as depleted',
            example: '2026-02-25T10:00:00Z',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the pantry record was created',
            example: '2026-02-21T14:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the pantry record was last updated',
            example: '2026-02-21T14:30:00Z',
          },
        },
      },
    },
    paths: {
      '/api/pantry': {
        post: {
          operationId: 'createPantryItem',
          summary: 'Add a pantry item',
          description: 'Adds a new item to the pantry inventory. Name and location are required.',
          tags: ['Pantry'],
          requestBody: jsonBody({
            type: 'object',
            required: ['name', 'location'],
            properties: {
              name: {
                type: 'string',
                description: 'Name of the pantry item',
                example: 'Olive oil',
              },
              location: {
                type: 'string',
                description: 'Storage location (e.g., fridge, pantry, freezer)',
                example: 'pantry',
              },
              quantity: {
                type: 'string',
                description: 'Quantity description with optional unit',
                example: '500ml',
              },
              category: {
                type: 'string',
                description: 'Category for grouping items',
                example: 'oils-and-condiments',
              },
              is_leftover: {
                type: 'boolean',
                default: false,
                description: 'Whether this item is a leftover from a cooked meal',
                example: false,
              },
              leftover_dish: {
                type: 'string',
                description: 'Name of the dish this leftover came from',
                example: 'Chicken Parmesan',
              },
              leftover_portions: {
                type: 'integer',
                description: 'Number of leftover portions available',
                example: 3,
              },
              meal_log_id: {
                type: 'string',
                format: 'uuid',
                description: 'Reference to the meal log entry that produced this leftover',
                example: 'a1b2c3d4-5e6f-7a8b-9c0d-e1f2a3b4c5d6',
              },
              use_by_date: {
                type: 'string',
                format: 'date',
                description: 'Date by which the item should be used',
                example: '2026-03-15',
              },
              use_soon: {
                type: 'boolean',
                default: false,
                description: 'Flag to indicate the item should be used soon',
                example: false,
              },
              notes: {
                type: 'string',
                description: 'Additional notes about the item',
                example: 'Extra virgin, imported from Italy',
              },
            },
          }),
          responses: {
            '201': jsonResponse('Pantry item created', { $ref: '#/components/schemas/PantryItem' }),
            ...errorResponses(400, 401, 500),
          },
        },
        get: {
          operationId: 'listPantryItems',
          summary: 'List pantry items',
          description: 'Returns pantry items with optional filtering by location, category, leftovers, and use-soon status. Depleted items are excluded by default.',
          tags: ['Pantry'],
          parameters: [
            {
              name: 'location',
              in: 'query',
              description: 'Filter by storage location (e.g., fridge, pantry, freezer)',
              schema: { type: 'string' },
              example: 'fridge',
            },
            {
              name: 'category',
              in: 'query',
              description: 'Filter by item category',
              schema: { type: 'string' },
              example: 'dairy',
            },
            {
              name: 'leftovers_only',
              in: 'query',
              description: 'When true, only return leftover items',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'false',
            },
            {
              name: 'use_soon_only',
              in: 'query',
              description: 'When true, only return items flagged as use-soon',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'false',
            },
            {
              name: 'include_depleted',
              in: 'query',
              description: 'When true, include items that have been marked as depleted',
              schema: { type: 'string', enum: ['true', 'false'] },
              example: 'false',
            },
            ...paginationParams(),
          ],
          responses: {
            '200': jsonResponse('Pantry items', {
              type: 'object',
              required: ['items', 'total'],
              properties: {
                items: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/PantryItem' },
                  description: 'Array of pantry items matching the filters',
                },
                total: {
                  type: 'integer',
                  description: 'Total number of matching pantry items',
                  example: 24,
                },
              },
            }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/api/pantry/expiring': {
        get: {
          operationId: 'getExpiringPantryItems',
          summary: 'Get items expiring soon',
          description: 'Returns non-depleted pantry items with a use_by_date within the specified number of days (default 7).',
          tags: ['Pantry'],
          parameters: [
            {
              name: 'days',
              in: 'query',
              description: 'Number of days to look ahead for expiring items',
              schema: { type: 'integer', default: 7 },
              example: 7,
            },
          ],
          responses: {
            '200': jsonResponse('Expiring items', {
              type: 'object',
              required: ['items', 'total'],
              properties: {
                items: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/PantryItem' },
                  description: 'Array of pantry items expiring within the specified window',
                },
                total: {
                  type: 'integer',
                  description: 'Total number of items expiring soon',
                  example: 3,
                },
              },
            }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/api/pantry/{id}': {
        get: {
          operationId: 'getPantryItem',
          summary: 'Get a pantry item',
          description: 'Returns a single pantry item by ID.',
          tags: ['Pantry'],
          parameters: [uuidParam('id', 'Pantry item ID')],
          responses: {
            '200': jsonResponse('Pantry item', { $ref: '#/components/schemas/PantryItem' }),
            ...errorResponses(401, 404, 500),
          },
        },
        patch: {
          operationId: 'updatePantryItem',
          summary: 'Update a pantry item',
          description: 'Updates any writable fields of a pantry item.',
          tags: ['Pantry'],
          parameters: [uuidParam('id', 'Pantry item ID')],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Updated name of the pantry item',
                example: 'Extra virgin olive oil',
              },
              location: {
                type: 'string',
                description: 'Updated storage location',
                example: 'fridge',
              },
              quantity: {
                type: 'string',
                description: 'Updated quantity description',
                example: '250ml',
              },
              category: {
                type: 'string',
                description: 'Updated category',
                example: 'oils-and-condiments',
              },
              is_leftover: {
                type: 'boolean',
                description: 'Whether this item is a leftover',
                example: false,
              },
              leftover_dish: {
                type: 'string',
                description: 'Name of the dish this leftover came from',
                example: 'Pasta Bolognese',
              },
              leftover_portions: {
                type: 'integer',
                description: 'Updated number of leftover portions',
                example: 2,
              },
              meal_log_id: {
                type: 'string',
                format: 'uuid',
                description: 'Reference to the meal log entry that produced this leftover',
                example: 'a1b2c3d4-5e6f-7a8b-9c0d-e1f2a3b4c5d6',
              },
              use_by_date: {
                type: 'string',
                format: 'date',
                description: 'Updated use-by date',
                example: '2026-03-20',
              },
              use_soon: {
                type: 'boolean',
                description: 'Flag to indicate the item should be used soon',
                example: true,
              },
              notes: {
                type: 'string',
                description: 'Updated notes about the item',
                example: 'Almost empty, add to shopping list',
              },
            },
          }, false),
          responses: {
            '200': jsonResponse('Updated pantry item', { $ref: '#/components/schemas/PantryItem' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        delete: {
          operationId: 'deletePantryItem',
          summary: 'Delete a pantry item',
          description: 'Hard-deletes a pantry item.',
          tags: ['Pantry'],
          parameters: [uuidParam('id', 'Pantry item ID')],
          responses: {
            '204': { description: 'Pantry item deleted' },
            ...errorResponses(401, 404, 500),
          },
        },
      },
      '/api/pantry/{id}/deplete': {
        post: {
          operationId: 'depletePantryItem',
          summary: 'Mark a pantry item as depleted',
          description: 'Sets is_depleted=true and records the depletion timestamp.',
          tags: ['Pantry'],
          parameters: [uuidParam('id', 'Pantry item ID')],
          responses: {
            '200': jsonResponse('Depleted pantry item', { $ref: '#/components/schemas/PantryItem' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
    },
  };
}
