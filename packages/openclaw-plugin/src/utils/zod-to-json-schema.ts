/**
 * Zod to JSON Schema conversion utilities.
 *
 * Converts Zod schemas to JSON Schema format for OpenClaw tool registration.
 *
 * Updated for zod v4 API compatibility:
 * - Check metadata is accessed via check._zod.def instead of check.kind/check.value
 * - ZodEnum values accessed via schema.options (public API)
 * - ZodArray element accessed via schema._def.element (was schema._def.type in v3)
 * - ZodObject shape is now a plain object (was a function in v3)
 * - ZodDefault defaultValue is the value directly (was a function in v3)
 */

import { z, type ZodTypeAny } from 'zod';
import type { JSONSchema, JSONSchemaProperty } from '../types/openclaw-api.js';

/**
 * Convert a Zod schema to JSON Schema.
 *
 * Note: This is a simplified converter that handles common cases.
 * For complex schemas, consider using zodToJsonSchema library.
 */
export function zodToJsonSchema(schema: ZodTypeAny): JSONSchema {
  return convertZodType(schema) as JSONSchema;
}

function convertZodType(schema: ZodTypeAny): JSONSchemaProperty | JSONSchema {
  // Unwrap optional/nullable
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return convertZodType(schema.unwrap() as ZodTypeAny);
  }

  // Unwrap default
  if (schema instanceof z.ZodDefault) {
    const inner = convertZodType(schema._def.innerType as ZodTypeAny);
    // In zod v4, defaultValue is the value directly (not a function as in v3)
    return { ...inner, default: schema._def.defaultValue as unknown };
  }

  // String
  if (schema instanceof z.ZodString) {
    const result: JSONSchemaProperty = { type: 'string' };
    const checks = (schema._def.checks as unknown[]) ?? [];
    for (const check of checks) {
      // In zod v4, check metadata lives on check._zod.def
      const def = (check as { _zod?: { def?: Record<string, unknown> } })?._zod?.def;
      if (!def) continue;

      const checkKind = def['check'] as string | undefined;
      if (checkKind === 'min_length') {
        result.minLength = def['minimum'] as number;
      } else if (checkKind === 'max_length') {
        result.maxLength = def['maximum'] as number;
      } else if (checkKind === 'string_format') {
        const format = def['format'] as string | undefined;
        if (format === 'regex') {
          const pattern = def['pattern'];
          if (pattern instanceof RegExp) {
            result.pattern = pattern.source;
          }
        } else if (format === 'email') {
          result.format = 'email';
        } else if (format === 'uuid') {
          result.format = 'uuid';
        } else if (format === 'url') {
          result.format = 'uri';
        }
      }
    }
    if (schema.description) result.description = schema.description;
    return result;
  }

  // Number
  if (schema instanceof z.ZodNumber) {
    const checks = (schema._def.checks as unknown[]) ?? [];
    let isInt = false;
    const result: JSONSchemaProperty = { type: 'number' };
    for (const check of checks) {
      const def = (check as { _zod?: { def?: Record<string, unknown> } })?._zod?.def;
      if (!def) continue;

      const checkKind = def['check'] as string | undefined;
      if (checkKind === 'number_format') {
        const format = def['format'] as string | undefined;
        if (format === 'safeint' || format === 'int') {
          isInt = true;
        }
      } else if (checkKind === 'greater_than') {
        result.minimum = def['value'] as number;
      } else if (checkKind === 'less_than') {
        result.maximum = def['value'] as number;
      }
    }
    if (isInt) result.type = 'integer';
    if (schema.description) result.description = schema.description;
    return result;
  }

  // Boolean
  if (schema instanceof z.ZodBoolean) {
    const result: JSONSchemaProperty = { type: 'boolean' };
    if (schema.description) result.description = schema.description;
    return result;
  }

  // Enum — use public .options API (array of values); v3 used schema._def.values
  if (schema instanceof z.ZodEnum) {
    const result: JSONSchemaProperty = {
      type: 'string',
      enum: schema.options as string[],
    };
    if (schema.description) result.description = schema.description;
    return result;
  }

  // Array — element is at schema._def.element in zod v4 (was schema._def.type in v3)
  if (schema instanceof z.ZodArray) {
    const element = (schema._def as unknown as { element: ZodTypeAny }).element;
    const result: JSONSchemaProperty = {
      type: 'array',
      items: convertZodType(element),
    };
    if (schema.description) result.description = schema.description;
    return result;
  }

  // Object — shape is a plain object in zod v4 (was a function in v3)
  if (schema instanceof z.ZodObject) {
    const shape = schema._def.shape as Record<string, ZodTypeAny>;
    const properties: Record<string, JSONSchemaProperty> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = convertZodType(value) as JSONSchemaProperty;
      // Check if field is required (not optional)
      if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault)) {
        required.push(key);
      }
    }

    const result: JSONSchema = {
      type: 'object',
      properties,
    };

    if (required.length > 0) {
      result.required = required;
    }

    if (schema.description) {
      result.description = schema.description;
    }

    return result;
  }

  // Fallback for unknown types
  return { type: 'object' };
}

/**
 * Add descriptions to JSON Schema properties from a map.
 */
export function addDescriptions(schema: JSONSchema, descriptions: Record<string, string>): JSONSchema {
  const result = { ...schema };
  if (result.properties) {
    result.properties = { ...result.properties };
    for (const [key, desc] of Object.entries(descriptions)) {
      if (result.properties[key]) {
        result.properties[key] = { ...result.properties[key], description: desc };
      }
    }
  }
  return result;
}
