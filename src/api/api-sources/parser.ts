/**
 * OpenAPI parser and decomposer.
 * Parses OpenAPI 2.0/3.0/3.1 specs, extracts operations, groups by tags,
 * and produces structured data ready for embedding text generation.
 * Part of API Onboarding feature (#1780).
 */

import SwaggerParser from '@apidevtools/swagger-parser';
import type { OpenAPI, OpenAPIV3, OpenAPIV2 } from 'openapi-types';
import {
  sanitizeOperationDescription,
  sanitizeParameterDescription,
  sanitizeApiDescription,
  sanitizeTagDescription,
} from './sanitizer.ts';
import { resolveOperationKey, deduplicateKeys, resolveTagGroupKey } from './operation-key.ts';
import type {
  ParsedApi,
  ParsedOperation,
  ParsedParameter,
  ParsedResponse,
  ParsedTagGroup,
  ParsedApiOverview,
  OperationSummary,
  TagGroupSummary,
} from './types.ts';

/** Maximum number of operations before we reject the spec. */
const MAX_OPERATIONS = 200;

/** Maximum depth for truncating JSON schemas in metadata. */
const MAX_SCHEMA_DEPTH = 3;

/**
 * Truncate a JSON schema to a maximum depth to prevent excessively large metadata.
 */
function truncateSchema(
  obj: Record<string, unknown> | null | undefined,
  depth: number = 0,
): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null;
  if (depth >= MAX_SCHEMA_DEPTH) {
    return { type: (obj as Record<string, unknown>).type ?? 'object', _truncated: true };
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === '$ref') continue; // Should be resolved already, skip any remnants
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = truncateSchema(value as Record<string, unknown>, depth + 1);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item && typeof item === 'object'
          ? truncateSchema(item as Record<string, unknown>, depth + 1)
          : item,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Check if a spec document is OpenAPI 3.x.
 */
function isOpenApi3(doc: OpenAPI.Document): doc is OpenAPIV3.Document {
  return 'openapi' in doc;
}

/**
 * Extract parameters from an OpenAPI 3.x operation.
 */
function extractParametersV3(
  params: OpenAPIV3.ParameterObject[] | undefined,
): ParsedParameter[] {
  if (!params) return [];
  return params.map((p) => {
    const descResult = p.description ? sanitizeParameterDescription(p.description) : null;
    return {
      name: p.name,
      in: p.in as ParsedParameter['in'],
      description: descResult?.text ?? null,
      required: p.required ?? false,
      schema: truncateSchema(p.schema as Record<string, unknown> | undefined),
    };
  });
}

/**
 * Extract parameters from a Swagger 2.0 operation.
 */
function extractParametersV2(
  params: OpenAPIV2.ParameterObject[] | undefined,
): ParsedParameter[] {
  if (!params) return [];
  return params.map((p) => {
    const descResult = p.description ? sanitizeParameterDescription(p.description) : null;
    return {
      name: p.name,
      in: p.in as ParsedParameter['in'],
      description: descResult?.text ?? null,
      required: p.required ?? false,
      schema: p.type ? { type: p.type } : null,
    };
  });
}

/**
 * Extract responses from an OpenAPI 3.x operation.
 */
function extractResponsesV3(
  responses: OpenAPIV3.ResponsesObject | undefined,
): Record<string, ParsedResponse> {
  if (!responses) return {};
  const result: Record<string, ParsedResponse> = {};
  for (const [code, resp] of Object.entries(responses)) {
    if (!resp || typeof resp !== 'object') continue;
    const response = resp as OpenAPIV3.ResponseObject;
    const schema = response.content?.['application/json']?.schema;
    result[code] = {
      description: response.description ?? '',
      ...(schema ? { schema: truncateSchema(schema as Record<string, unknown>) ?? undefined } : {}),
    };
  }
  return result;
}

/**
 * Extract responses from a Swagger 2.0 operation.
 */
function extractResponsesV2(
  responses: OpenAPIV2.ResponsesObject | undefined,
): Record<string, ParsedResponse> {
  if (!responses) return {};
  const result: Record<string, ParsedResponse> = {};
  for (const [code, resp] of Object.entries(responses)) {
    if (!resp || typeof resp !== 'object') continue;
    const response = resp as OpenAPIV2.ResponseObject;
    result[code] = {
      description: response.description ?? '',
      ...(response.schema
        ? { schema: truncateSchema(response.schema as Record<string, unknown>) ?? undefined }
        : {}),
    };
  }
  return result;
}

/**
 * Extract request body info from an OpenAPI 3.x operation.
 */
function extractRequestBodyV3(
  requestBody: OpenAPIV3.RequestBodyObject | undefined,
): Record<string, unknown> | null {
  if (!requestBody) return null;
  const schema = requestBody.content?.['application/json']?.schema;
  return schema ? truncateSchema(schema as Record<string, unknown>) : null;
}

/**
 * Summarize authentication requirements from a spec.
 */
function summarizeAuth(doc: OpenAPI.Document): string {
  if (isOpenApi3(doc)) {
    const schemes = doc.components?.securitySchemes;
    if (!schemes || Object.keys(schemes).length === 0) return 'none';
    const parts: string[] = [];
    for (const [name, scheme] of Object.entries(schemes)) {
      const s = scheme as OpenAPIV3.SecuritySchemeObject;
      if (s.type === 'apiKey') {
        parts.push(`API key (${s.name} in ${s.in})`);
      } else if (s.type === 'http') {
        parts.push(`HTTP ${s.scheme}`);
      } else if (s.type === 'oauth2') {
        parts.push(`OAuth 2.0 (${name})`);
      } else {
        parts.push(s.type);
      }
    }
    return parts.join(', ');
  }

  // Swagger 2.0
  const v2 = doc as OpenAPIV2.Document;
  const defs = v2.securityDefinitions;
  if (!defs || Object.keys(defs).length === 0) return 'none';
  const parts: string[] = [];
  for (const [name, def] of Object.entries(defs) as Array<
    [string, OpenAPIV2.SecuritySchemeObject]
  >) {
    if (def.type === 'apiKey') {
      parts.push(`API key (${def.name} in ${def.in})`);
    } else if (def.type === 'basic') {
      parts.push('HTTP basic');
    } else if (def.type === 'oauth2') {
      parts.push(`OAuth 2.0 (${name})`);
    }
  }
  return parts.join(', ');
}

/**
 * Extract server URLs from a spec.
 */
function extractServers(doc: OpenAPI.Document): Array<{ url: string }> {
  if (isOpenApi3(doc)) {
    return (doc.servers ?? []).map((s: OpenAPIV3.ServerObject) => ({ url: s.url }));
  }
  // Swagger 2.0
  const v2 = doc as OpenAPIV2.Document;
  if (v2.host) {
    const scheme = v2.schemes?.[0] ?? 'https';
    const basePath = v2.basePath ?? '';
    return [{ url: `${scheme}://${v2.host}${basePath}` }];
  }
  return [];
}

/**
 * Parse an OpenAPI spec (JSON string or object) and decompose into structured data.
 * Supports OpenAPI 2.0 (Swagger), 3.0, and 3.1.
 */
export async function parseOpenApiSpec(specContent: string | object): Promise<ParsedApi> {
  // Parse JSON if string
  let specObj: unknown;
  if (typeof specContent === 'string') {
    try {
      specObj = JSON.parse(specContent);
    } catch {
      throw new Error('Invalid JSON: could not parse spec content');
    }
  } else {
    specObj = specContent;
  }

  // Validate structure
  const validated = await SwaggerParser.validate(structuredClone(specObj) as OpenAPI.Document);

  // Dereference all $refs
  const dereferenced = await SwaggerParser.dereference(
    structuredClone(specObj) as OpenAPI.Document,
  );

  // Extract spec info
  const info = dereferenced.info;
  const isV3 = isOpenApi3(dereferenced);

  // Pass 1: Extract all operations
  const rawOperations: Array<{
    method: string;
    path: string;
    operationId?: string;
    summary: string | null;
    description: string | null;
    tags: string[];
    parameters: ParsedParameter[];
    requestBody: Record<string, unknown> | null;
    responses: Record<string, ParsedResponse>;
  }> = [];

  const paths = dereferenced.paths ?? {};
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;
    for (const method of methods) {
      const operation = (pathItem as Record<string, unknown>)[method];
      if (!operation || typeof operation !== 'object') continue;

      const op = operation as Record<string, unknown>;
      const opId = op.operationId as string | undefined;

      // Sanitize text fields
      const summaryRaw = (op.summary as string) ?? null;
      const descRaw = (op.description as string) ?? null;
      const summaryResult = summaryRaw ? sanitizeOperationDescription(summaryRaw) : null;
      const descResult = descRaw ? sanitizeOperationDescription(descRaw) : null;

      const tags = Array.isArray(op.tags) ? (op.tags as string[]) : [];

      let parameters: ParsedParameter[];
      let requestBody: Record<string, unknown> | null = null;
      let responses: Record<string, ParsedResponse>;

      if (isV3) {
        parameters = extractParametersV3(
          op.parameters as OpenAPIV3.ParameterObject[] | undefined,
        );
        requestBody = extractRequestBodyV3(
          op.requestBody as OpenAPIV3.RequestBodyObject | undefined,
        );
        responses = extractResponsesV3(op.responses as OpenAPIV3.ResponsesObject | undefined);
      } else {
        parameters = extractParametersV2(
          op.parameters as OpenAPIV2.ParameterObject[] | undefined,
        );
        responses = extractResponsesV2(op.responses as OpenAPIV2.ResponsesObject | undefined);
      }

      rawOperations.push({
        method: method.toUpperCase(),
        path,
        operationId: opId,
        summary: summaryResult?.text ?? null,
        description: descResult?.text ?? null,
        tags,
        parameters,
        requestBody,
        responses,
      });
    }
  }

  // Check operation count limit
  if (rawOperations.length > MAX_OPERATIONS) {
    throw new Error(
      `Spec contains ${rawOperations.length} operations, exceeding the maximum of ${MAX_OPERATIONS}`,
    );
  }

  // Generate operation keys (with dedup)
  const rawKeys = rawOperations.map((op) =>
    resolveOperationKey(op.method, op.path, op.operationId),
  );
  const dedupedKeys = deduplicateKeys(rawKeys);

  // Build ParsedOperation array
  const operations: ParsedOperation[] = rawOperations.map((raw, i) => ({
    operationKey: dedupedKeys[i],
    method: raw.method,
    path: raw.path,
    summary: raw.summary,
    description: raw.description,
    tags: raw.tags,
    parameters: raw.parameters,
    requestBody: raw.requestBody,
    responses: raw.responses,
  }));

  // Pass 2: Group operations by tag
  const tagMap = new Map<string, OperationSummary[]>();
  for (const op of operations) {
    const tags = op.tags.length > 0 ? op.tags : ['_untagged'];
    for (const tag of tags) {
      const existing = tagMap.get(tag) ?? [];
      existing.push({
        operationKey: op.operationKey,
        method: op.method,
        path: op.path,
        summary: op.summary,
      });
      tagMap.set(tag, existing);
    }
  }

  // Build tag groups with optional descriptions from spec-level tags
  const specTags = isV3
    ? ((dereferenced as OpenAPIV3.Document).tags ?? [])
    : ((dereferenced as OpenAPIV2.Document).tags ?? []);
  const specTagDescs = new Map<string, string | null>();
  for (const t of specTags) {
    const descResult = t.description ? sanitizeTagDescription(t.description) : null;
    specTagDescs.set(t.name, descResult?.text ?? null);
  }

  const tagGroups: ParsedTagGroup[] = [];
  for (const [tag, ops] of tagMap) {
    tagGroups.push({
      tag,
      description: specTagDescs.get(tag) ?? null,
      operations: ops,
    });
  }

  // Sort tag groups: named tags first (alphabetical), _untagged last
  tagGroups.sort((a, b) => {
    if (a.tag === '_untagged') return 1;
    if (b.tag === '_untagged') return -1;
    return a.tag.localeCompare(b.tag);
  });

  // Build overview
  const descResult = info.description ? sanitizeApiDescription(info.description) : null;
  const authSummary = summarizeAuth(validated);
  const servers = extractServers(dereferenced);

  const tagGroupSummaries: TagGroupSummary[] = tagGroups.map((tg) => ({
    tag: tg.tag,
    operationCount: tg.operations.length,
  }));

  const overview: ParsedApiOverview = {
    name: info.title,
    description: descResult?.text ?? null,
    version: info.version ?? null,
    servers,
    authSummary,
    tagGroups: tagGroupSummaries,
    totalOperations: operations.length,
  };

  return {
    overview,
    tagGroups,
    operations,
  };
}
