/**
 * OpenAPI path definitions for shared list endpoints.
 * Routes: POST /api/lists, GET /api/lists, GET /api/lists/:id,
 *         PATCH /api/lists/:id, DELETE /api/lists/:id,
 *         POST /api/lists/:id/items, PATCH /api/lists/:list_id/items/:item_id,
 *         DELETE /api/lists/:list_id/items/:item_id,
 *         POST /api/lists/:id/items/check, POST /api/lists/:id/items/uncheck,
 *         POST /api/lists/:id/reset, POST /api/lists/:id/merge
 */
import type { OpenApiDomainModule } from '../types.ts';
import { errorResponses, jsonBody, jsonResponse, paginationParams, uuidParam } from '../helpers.ts';

export function listsPaths(): OpenApiDomainModule {
  return {
    tags: [
      { name: 'Lists', description: 'Shared lists (shopping, todo, etc.) with items, check/uncheck, reset, and merge' },
    ],
    schemas: {
      List: {
        type: 'object',
        required: ['id', 'name', 'list_type', 'is_shared', 'created_at', 'updated_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the list',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          name: {
            type: 'string',
            description: 'Display name of the list',
            example: 'Grocery Shopping List',
          },
          list_type: {
            type: 'string',
            description: 'Type of list (e.g., shopping, todo, packing)',
            example: 'shopping',
          },
          is_shared: {
            type: 'boolean',
            description: 'Whether the list is shared with other users in the namespace',
            example: true,
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the list was created',
            example: '2026-02-21T14:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the list was last updated',
            example: '2026-02-21T15:00:00Z',
          },
        },
      },
      ListItem: {
        type: 'object',
        required: ['id', 'list_id', 'name', 'is_checked', 'is_recurring', 'sort_order', 'created_at', 'updated_at'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Unique identifier for the list item',
            example: 'b1c2d3e4-5f6a-7b8c-9d0e-f1a2b3c4d5e6',
          },
          list_id: {
            type: 'string',
            format: 'uuid',
            description: 'ID of the list this item belongs to',
            example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
          },
          name: {
            type: 'string',
            description: 'Name of the list item',
            example: 'Whole milk',
          },
          quantity: {
            type: 'string',
            nullable: true,
            description: 'Quantity or amount needed',
            example: '2 litres',
          },
          category: {
            type: 'string',
            nullable: true,
            description: 'Category for grouping items (e.g., dairy, produce)',
            example: 'dairy',
          },
          is_checked: {
            type: 'boolean',
            description: 'Whether the item has been checked off',
            example: false,
          },
          is_recurring: {
            type: 'boolean',
            description: 'Whether the item reappears after a list reset',
            example: true,
          },
          checked_at: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            description: 'Timestamp when the item was checked off',
            example: '2026-02-21T16:00:00Z',
          },
          checked_by: {
            type: 'string',
            nullable: true,
            description: 'Email or identifier of who checked the item',
            example: 'user@example.com',
          },
          source_type: {
            type: 'string',
            nullable: true,
            description: 'Origin type of the item (e.g., recipe, manual, agent)',
            example: 'recipe',
          },
          source_id: {
            type: 'string',
            format: 'uuid',
            nullable: true,
            description: 'ID of the source entity that added this item (e.g., recipe ID)',
            example: 'c3d4e5f6-7a8b-9c0d-e1f2-a3b4c5d6e7f8',
          },
          sort_order: {
            type: 'integer',
            description: 'Sort position within the list (lower values first)',
            example: 0,
          },
          notes: {
            type: 'string',
            nullable: true,
            description: 'Additional notes or context for the item',
            example: 'Get the organic brand if available',
          },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the item was created',
            example: '2026-02-21T14:30:00Z',
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Timestamp when the item was last updated',
            example: '2026-02-21T14:30:00Z',
          },
        },
      },
    },
    paths: {
      '/api/lists': {
        post: {
          operationId: 'createList',
          summary: 'Create a list',
          description: 'Creates a new shared list. Defaults to type "shopping" and shared=true.',
          tags: ['Lists'],
          requestBody: jsonBody({
            type: 'object',
            required: ['name'],
            properties: {
              name: {
                type: 'string',
                description: 'Display name of the list',
                example: 'Grocery Shopping List',
              },
              list_type: {
                type: 'string',
                default: 'shopping',
                description: 'Type of list',
                example: 'shopping',
              },
              is_shared: {
                type: 'boolean',
                default: true,
                description: 'Whether the list is shared with other users',
                example: true,
              },
            },
          }),
          responses: {
            '201': jsonResponse('List created', { $ref: '#/components/schemas/List' }),
            ...errorResponses(400, 401, 500),
          },
        },
        get: {
          operationId: 'listLists',
          summary: 'List all lists',
          description: 'Returns all lists with optional filtering by type and pagination.',
          tags: ['Lists'],
          parameters: [
            {
              name: 'list_type',
              in: 'query',
              description: 'Filter by list type (e.g., shopping, todo)',
              schema: { type: 'string' },
              example: 'shopping',
            },
            ...paginationParams(),
          ],
          responses: {
            '200': jsonResponse('Lists', {
              type: 'object',
              required: ['total', 'limit', 'offset', 'items'],
              properties: {
                total: {
                  type: 'integer',
                  description: 'Total number of lists matching the filter',
                  example: 5,
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
                items: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/List' },
                  description: 'Array of lists',
                },
              },
            }),
            ...errorResponses(401, 500),
          },
        },
      },
      '/api/lists/{id}': {
        get: {
          operationId: 'getList',
          summary: 'Get a list with items',
          description: 'Returns a list and all its items, ordered by sort_order then creation date.',
          tags: ['Lists'],
          parameters: [uuidParam('id', 'List ID')],
          responses: {
            '200': jsonResponse('List with items', {
              type: 'object',
              required: ['id', 'name', 'list_type', 'is_shared', 'created_at', 'updated_at', 'items'],
              properties: {
                id: {
                  type: 'string',
                  format: 'uuid',
                  description: 'Unique identifier for the list',
                  example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
                },
                name: {
                  type: 'string',
                  description: 'Display name of the list',
                  example: 'Grocery Shopping List',
                },
                list_type: {
                  type: 'string',
                  description: 'Type of list',
                  example: 'shopping',
                },
                is_shared: {
                  type: 'boolean',
                  description: 'Whether the list is shared',
                  example: true,
                },
                created_at: {
                  type: 'string',
                  format: 'date-time',
                  description: 'Timestamp when the list was created',
                  example: '2026-02-21T14:30:00Z',
                },
                updated_at: {
                  type: 'string',
                  format: 'date-time',
                  description: 'Timestamp when the list was last updated',
                  example: '2026-02-21T15:00:00Z',
                },
                items: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/ListItem' },
                  description: 'All items in the list, ordered by sort_order then created_at',
                },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
        patch: {
          operationId: 'updateList',
          summary: 'Update a list',
          description: 'Updates the name, type, or shared status of a list.',
          tags: ['Lists'],
          parameters: [uuidParam('id', 'List ID')],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Updated display name',
                example: 'Weekly Grocery List',
              },
              list_type: {
                type: 'string',
                description: 'Updated list type',
                example: 'todo',
              },
              is_shared: {
                type: 'boolean',
                description: 'Updated shared status',
                example: false,
              },
            },
          }, false),
          responses: {
            '200': jsonResponse('Updated list', { $ref: '#/components/schemas/List' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteList',
          summary: 'Delete a list',
          description: 'Deletes a list and all its items (cascade).',
          tags: ['Lists'],
          parameters: [uuidParam('id', 'List ID')],
          responses: {
            '204': { description: 'List deleted' },
            ...errorResponses(401, 404, 500),
          },
        },
      },
      '/api/lists/{id}/items': {
        post: {
          operationId: 'addListItem',
          summary: 'Add an item to a list',
          description: 'Adds a new item to a list with optional quantity, category, and sorting.',
          tags: ['Lists'],
          parameters: [uuidParam('id', 'List ID')],
          requestBody: jsonBody({
            type: 'object',
            required: ['name'],
            properties: {
              name: {
                type: 'string',
                description: 'Name of the item to add',
                example: 'Whole milk',
              },
              quantity: {
                type: 'string',
                description: 'Quantity or amount needed',
                example: '2 litres',
              },
              category: {
                type: 'string',
                description: 'Category for grouping (e.g., dairy, produce)',
                example: 'dairy',
              },
              is_recurring: {
                type: 'boolean',
                default: false,
                description: 'Whether the item should reappear after list reset',
                example: true,
              },
              sort_order: {
                type: 'integer',
                default: 0,
                description: 'Sort position within the list',
                example: 0,
              },
              notes: {
                type: 'string',
                description: 'Additional notes for the item',
                example: 'Get the organic brand',
              },
              source_type: {
                type: 'string',
                description: 'Origin type (e.g., recipe, manual, agent)',
                example: 'manual',
              },
              source_id: {
                type: 'string',
                format: 'uuid',
                description: 'ID of the source entity',
                example: 'c3d4e5f6-7a8b-9c0d-e1f2-a3b4c5d6e7f8',
              },
            },
          }),
          responses: {
            '201': jsonResponse('Item added', { $ref: '#/components/schemas/ListItem' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
      '/api/lists/{list_id}/items/{item_id}': {
        patch: {
          operationId: 'updateListItem',
          summary: 'Update a list item',
          description: 'Updates name, quantity, category, recurring status, sort order, or notes of a list item.',
          tags: ['Lists'],
          parameters: [
            uuidParam('list_id', 'List ID'),
            uuidParam('item_id', 'Item ID'),
          ],
          requestBody: jsonBody({
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Updated item name',
                example: 'Semi-skimmed milk',
              },
              quantity: {
                type: 'string',
                nullable: true,
                description: 'Updated quantity (set to null to clear)',
                example: '1 litre',
              },
              category: {
                type: 'string',
                nullable: true,
                description: 'Updated category (set to null to clear)',
                example: 'dairy',
              },
              is_recurring: {
                type: 'boolean',
                description: 'Whether the item should reappear after list reset',
                example: false,
              },
              sort_order: {
                type: 'integer',
                description: 'Updated sort position',
                example: 5,
              },
              notes: {
                type: 'string',
                nullable: true,
                description: 'Updated notes (set to null to clear)',
                example: 'Changed brand preference',
              },
            },
          }, false),
          responses: {
            '200': jsonResponse('Updated item', { $ref: '#/components/schemas/ListItem' }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
        delete: {
          operationId: 'deleteListItem',
          summary: 'Remove a list item',
          description: 'Deletes a specific item from a list.',
          tags: ['Lists'],
          parameters: [
            uuidParam('list_id', 'List ID'),
            uuidParam('item_id', 'Item ID'),
          ],
          responses: {
            '204': { description: 'Item deleted' },
            ...errorResponses(401, 404, 500),
          },
        },
      },
      '/api/lists/{id}/items/check': {
        post: {
          operationId: 'checkListItems',
          summary: 'Check off list items',
          description: 'Marks the specified items as checked with a timestamp and optional checked_by.',
          tags: ['Lists'],
          parameters: [uuidParam('id', 'List ID')],
          requestBody: jsonBody({
            type: 'object',
            required: ['item_ids'],
            properties: {
              item_ids: {
                type: 'array',
                items: { type: 'string', format: 'uuid' },
                description: 'Array of item IDs to check off',
                example: ['b1c2d3e4-5f6a-7b8c-9d0e-f1a2b3c4d5e6'],
              },
              checked_by: {
                type: 'string',
                description: 'Email or identifier of who is checking the items',
                example: 'user@example.com',
              },
            },
          }),
          responses: {
            '200': jsonResponse('Check result', {
              type: 'object',
              required: ['checked'],
              properties: {
                checked: {
                  type: 'integer',
                  description: 'Number of items successfully checked',
                  example: 3,
                },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },
      '/api/lists/{id}/items/uncheck': {
        post: {
          operationId: 'uncheckListItems',
          summary: 'Uncheck list items',
          description: 'Clears the checked status from the specified items.',
          tags: ['Lists'],
          parameters: [uuidParam('id', 'List ID')],
          requestBody: jsonBody({
            type: 'object',
            required: ['item_ids'],
            properties: {
              item_ids: {
                type: 'array',
                items: { type: 'string', format: 'uuid' },
                description: 'Array of item IDs to uncheck',
                example: ['b1c2d3e4-5f6a-7b8c-9d0e-f1a2b3c4d5e6'],
              },
            },
          }),
          responses: {
            '200': jsonResponse('Uncheck result', {
              type: 'object',
              required: ['unchecked'],
              properties: {
                unchecked: {
                  type: 'integer',
                  description: 'Number of items successfully unchecked',
                  example: 2,
                },
              },
            }),
            ...errorResponses(400, 401, 500),
          },
        },
      },
      '/api/lists/{id}/reset': {
        post: {
          operationId: 'resetList',
          summary: 'Reset a list after shopping',
          description: 'Removes checked non-recurring items and unchecks checked recurring items. Useful after completing a shopping trip.',
          tags: ['Lists'],
          parameters: [uuidParam('id', 'List ID')],
          responses: {
            '200': jsonResponse('Reset result', {
              type: 'object',
              required: ['removed', 'unchecked'],
              properties: {
                removed: {
                  type: 'integer',
                  description: 'Number of checked non-recurring items removed',
                  example: 8,
                },
                unchecked: {
                  type: 'integer',
                  description: 'Number of checked recurring items unchecked (kept in list)',
                  example: 3,
                },
              },
            }),
            ...errorResponses(401, 404, 500),
          },
        },
      },
      '/api/lists/{id}/merge': {
        post: {
          operationId: 'mergeListItems',
          summary: 'Merge items into a list',
          description: 'Adds new items and updates existing items matched by name (case-insensitive). Useful for batch updates from an agent.',
          tags: ['Lists'],
          parameters: [uuidParam('id', 'List ID')],
          requestBody: jsonBody({
            type: 'object',
            required: ['items'],
            properties: {
              items: {
                type: 'array',
                description: 'Array of items to merge into the list',
                items: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: {
                      type: 'string',
                      description: 'Item name (matched case-insensitively for updates)',
                      example: 'Whole milk',
                    },
                    quantity: {
                      type: 'string',
                      description: 'Quantity or amount',
                      example: '2 litres',
                    },
                    category: {
                      type: 'string',
                      description: 'Category for grouping',
                      example: 'dairy',
                    },
                  },
                },
              },
            },
          }),
          responses: {
            '200': jsonResponse('Merge result', {
              type: 'object',
              required: ['added', 'updated'],
              properties: {
                added: {
                  type: 'integer',
                  description: 'Number of new items added to the list',
                  example: 4,
                },
                updated: {
                  type: 'integer',
                  description: 'Number of existing items updated by name match',
                  example: 2,
                },
              },
            }),
            ...errorResponses(400, 401, 404, 500),
          },
        },
      },
    },
  };
}
