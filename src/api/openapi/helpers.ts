/**
 * Reusable OpenAPI spec builders for common patterns.
 */
import type { ParameterObject, ResponseObject, SchemaObject } from './types.ts';

/** Create a $ref to a component schema */
export function ref(schemaName: string): SchemaObject {
  return { $ref: `#/components/schemas/${schemaName}` };
}

/** Standard UUID path parameter */
export function uuidParam(name = 'id', description = 'Resource UUID'): ParameterObject {
  return {
    name,
    in: 'path',
    required: true,
    description,
    schema: { type: 'string', format: 'uuid' },
  };
}

/** Standard pagination query parameters */
export function paginationParams(): ParameterObject[] {
  return [
    {
      name: 'limit',
      in: 'query',
      description: 'Maximum number of results to return',
      schema: { type: 'integer', default: 50, minimum: 1, maximum: 500 },
    },
    {
      name: 'offset',
      in: 'query',
      description: 'Number of results to skip',
      schema: { type: 'integer', default: 0, minimum: 0 },
    },
  ];
}

/** Namespace header parameter (X-Namespace) */
export function namespaceParam(): ParameterObject {
  return {
    name: 'X-Namespace',
    in: 'header',
    description: 'Target namespace for the request',
    schema: { type: 'string' },
  };
}

/** Standard error response map for given status codes */
export function errorResponses(...codes: number[]): Record<string, ResponseObject> {
  const map: Record<number, string> = {
    400: 'Bad request — invalid parameters or body',
    401: 'Unauthorized — missing or invalid bearer token',
    403: 'Forbidden — insufficient permissions or namespace access denied',
    404: 'Not found',
    409: 'Conflict — resource already exists or version mismatch',
    422: 'Unprocessable entity — validation failed',
    429: 'Too many requests — rate limit exceeded',
    500: 'Internal server error',
    503: 'Service unavailable',
  };
  const result: Record<string, ResponseObject> = {};
  for (const code of codes) {
    result[String(code)] = {
      description: map[code] ?? `Error ${code}`,
      content: { 'application/json': { schema: ref('Error') } },
    };
  }
  return result;
}

/** JSON request body helper */
export function jsonBody(schema: SchemaObject, required = true): {
  required: boolean;
  content: { 'application/json': { schema: SchemaObject } };
} {
  return {
    required,
    content: { 'application/json': { schema } },
  };
}

/** JSON response helper */
export function jsonResponse(
  description: string,
  schema: SchemaObject,
): ResponseObject {
  return {
    description,
    content: { 'application/json': { schema } },
  };
}

/** Wrap a schema in a { data: T } envelope */
export function dataEnvelope(itemSchema: SchemaObject): SchemaObject {
  return {
    type: 'object',
    properties: {
      data: itemSchema,
    },
  };
}

/** Wrap a schema in a { data: T[] } list envelope */
export function listEnvelope(itemSchema: SchemaObject): SchemaObject {
  return {
    type: 'object',
    properties: {
      data: { type: 'array', items: itemSchema },
    },
  };
}

/** Search/filter query parameter */
export function searchParam(description = 'Full-text search query'): ParameterObject {
  return {
    name: 'search',
    in: 'query',
    description,
    schema: { type: 'string' },
  };
}
