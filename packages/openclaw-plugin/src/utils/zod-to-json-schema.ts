/**
 * Zod to JSON Schema conversion utilities.
 *
 * Converts Zod schemas to JSON Schema format for OpenClaw tool registration.
 */

import { z, type ZodTypeAny } from 'zod'
import type { JSONSchema, JSONSchemaProperty } from '../types/openclaw-api.js'

/**
 * Convert a Zod schema to JSON Schema.
 *
 * Note: This is a simplified converter that handles common cases.
 * For complex schemas, consider using zodToJsonSchema library.
 */
export function zodToJsonSchema(schema: ZodTypeAny): JSONSchema {
  return convertZodType(schema) as JSONSchema
}

function convertZodType(schema: ZodTypeAny): JSONSchemaProperty | JSONSchema {
  // Unwrap optional/nullable
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return convertZodType(schema.unwrap())
  }

  // Unwrap default
  if (schema instanceof z.ZodDefault) {
    const inner = convertZodType(schema._def.innerType)
    return { ...inner, default: schema._def.defaultValue() }
  }

  // String
  if (schema instanceof z.ZodString) {
    const result: JSONSchemaProperty = { type: 'string' }
    const checks = schema._def.checks ?? []
    for (const check of checks) {
      if (check.kind === 'min') result.minLength = check.value
      if (check.kind === 'max') result.maxLength = check.value
      if (check.kind === 'regex') result.pattern = check.regex.source
      if (check.kind === 'email') result.format = 'email'
      if (check.kind === 'uuid') result.format = 'uuid'
      if (check.kind === 'url') result.format = 'uri'
    }
    if (schema.description) result.description = schema.description
    return result
  }

  // Number
  if (schema instanceof z.ZodNumber) {
    const checks = schema._def.checks ?? []
    const isInt = checks.some((c) => c.kind === 'int')
    const result: JSONSchemaProperty = { type: isInt ? 'integer' : 'number' }
    for (const check of checks) {
      if (check.kind === 'min') result.minimum = check.value
      if (check.kind === 'max') result.maximum = check.value
    }
    if (schema.description) result.description = schema.description
    return result
  }

  // Boolean
  if (schema instanceof z.ZodBoolean) {
    const result: JSONSchemaProperty = { type: 'boolean' }
    if (schema.description) result.description = schema.description
    return result
  }

  // Enum
  if (schema instanceof z.ZodEnum) {
    const result: JSONSchemaProperty = {
      type: 'string',
      enum: schema._def.values,
    }
    if (schema.description) result.description = schema.description
    return result
  }

  // Array
  if (schema instanceof z.ZodArray) {
    const result: JSONSchemaProperty = {
      type: 'array',
      items: convertZodType(schema._def.type),
    }
    if (schema.description) result.description = schema.description
    return result
  }

  // Object
  if (schema instanceof z.ZodObject) {
    const shape = schema._def.shape() as Record<string, ZodTypeAny>
    const properties: Record<string, JSONSchemaProperty> = {}
    const required: string[] = []

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = convertZodType(value) as JSONSchemaProperty
      // Check if field is required (not optional)
      if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault)) {
        required.push(key)
      }
    }

    const result: JSONSchema = {
      type: 'object',
      properties,
    }

    if (required.length > 0) {
      result.required = required
    }

    if (schema.description) {
      result.description = schema.description
    }

    return result
  }

  // Fallback for unknown types
  return { type: 'object' }
}

/**
 * Add descriptions to JSON Schema properties from a map.
 */
export function addDescriptions(
  schema: JSONSchema,
  descriptions: Record<string, string>
): JSONSchema {
  const result = { ...schema }
  if (result.properties) {
    result.properties = { ...result.properties }
    for (const [key, desc] of Object.entries(descriptions)) {
      if (result.properties[key]) {
        result.properties[key] = { ...result.properties[key], description: desc }
      }
    }
  }
  return result
}
