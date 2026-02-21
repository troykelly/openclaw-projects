/**
 * Shared OpenAPI schemas used across multiple domain modules.
 */
import type { SchemaObject } from '../types.ts';

export function commonSchemas(): Record<string, SchemaObject> {
  return {
    Error: {
      type: 'object',
      properties: {
        error: { type: 'string', description: 'Human-readable error message' },
      },
      required: ['error'],
    },
    SuccessMessage: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
    },
    DeletedResponse: {
      type: 'object',
      properties: {
        deleted: { type: 'boolean' },
      },
    },
    CountResponse: {
      type: 'object',
      properties: {
        count: { type: 'integer' },
      },
    },
  };
}
