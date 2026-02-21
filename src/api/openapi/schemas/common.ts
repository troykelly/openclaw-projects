/**
 * Shared OpenAPI schemas used across multiple domain modules.
 */
import type { SchemaObject } from '../types.ts';

export function commonSchemas(): Record<string, SchemaObject> {
  return {
    Error: {
      type: 'object',
      description: 'Standard error response returned by the API when a request fails',
      properties: {
        error: {
          type: 'string',
          description: 'Human-readable error message describing what went wrong',
          example: 'Resource not found',
        },
      },
      required: ['error'],
    },
    SuccessMessage: {
      type: 'object',
      description: 'Generic success response with a human-readable message',
      properties: {
        message: {
          type: 'string',
          description: 'Human-readable success message',
          example: 'Operation completed successfully',
        },
      },
      required: ['message'],
    },
    DeletedResponse: {
      type: 'object',
      description: 'Response confirming a resource was deleted',
      properties: {
        deleted: {
          type: 'boolean',
          description: 'Whether the resource was successfully deleted',
          example: true,
        },
      },
      required: ['deleted'],
    },
    CountResponse: {
      type: 'object',
      description: 'Response containing a count of matching resources',
      properties: {
        count: {
          type: 'integer',
          description: 'Number of matching resources',
          example: 42,
        },
      },
      required: ['count'],
    },
  };
}
