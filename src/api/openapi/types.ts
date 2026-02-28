/**
 * TypeScript interfaces for OpenAPI 3.0.3 constructs.
 * Used by all domain path modules and the spec assembler.
 */

export interface SchemaObject {
  type?: string;
  format?: string;
  enum?: readonly string[];
  properties?: Record<string, SchemaObject>;
  required?: readonly string[];
  items?: SchemaObject;
  nullable?: boolean;
  description?: string;
  example?: unknown;
  $ref?: string;
  allOf?: readonly SchemaObject[];
  oneOf?: readonly SchemaObject[];
  anyOf?: readonly SchemaObject[];
  additionalProperties?: boolean | SchemaObject;
  minimum?: number;
  maximum?: number;
  default?: unknown;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  readOnly?: boolean;
  writeOnly?: boolean;
}

export interface ParameterObject {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema: SchemaObject;
  example?: unknown;
  deprecated?: boolean;
}

export interface RequestBodyObject {
  required?: boolean;
  description?: string;
  content: Record<string, MediaTypeObject>;
}

export interface MediaTypeObject {
  schema: SchemaObject;
  example?: unknown;
  examples?: Record<string, { summary?: string; value: unknown }>;
}

export interface ResponseObject {
  description: string;
  content?: Record<string, MediaTypeObject>;
  headers?: Record<string, { schema: SchemaObject; description?: string }>;
}

export interface OperationObject {
  operationId: string;
  summary: string;
  description?: string;
  tags: readonly string[];
  security?: ReadonlyArray<Record<string, readonly string[]>>;
  parameters?: readonly ParameterObject[];
  requestBody?: RequestBodyObject;
  responses: Record<string, ResponseObject>;
  deprecated?: boolean;
}

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type PathItemObject = Partial<Record<HttpMethod, OperationObject>> & {
  parameters?: readonly ParameterObject[];
};

/** What each domain path module exports */
export interface OpenApiDomainModule {
  /** Path definitions for this domain */
  paths: Record<string, PathItemObject>;
  /** Domain-specific schemas to merge into components.schemas */
  schemas?: Record<string, SchemaObject>;
  /** Tags used by this domain */
  tags?: ReadonlyArray<{ name: string; description: string }>;
}
