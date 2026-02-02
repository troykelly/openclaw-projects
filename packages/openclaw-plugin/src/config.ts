/**
 * Plugin configuration schema using Zod.
 * Validates configuration at runtime to ensure type safety.
 */

import { z } from 'zod'

/** User scoping strategies for memory isolation */
export const UserScopingSchema = z.enum(['agent', 'identity', 'session'])
export type UserScoping = z.infer<typeof UserScopingSchema>

/** Plugin configuration schema */
export const PluginConfigSchema = z.object({
  /** Backend API URL */
  apiUrl: z
    .string()
    .url('apiUrl must be a valid URL')
    .describe('Backend API URL'),

  /** API authentication key */
  apiKey: z
    .string()
    .min(1, 'apiKey is required')
    .describe('API authentication key'),

  /** Automatically recall relevant memories on conversation start */
  autoRecall: z.boolean().default(true).describe('Auto-recall memories'),

  /** Automatically capture important information as memories */
  autoCapture: z.boolean().default(true).describe('Auto-capture memories'),

  /** How to scope user memories */
  userScoping: UserScopingSchema.default('agent').describe('User scoping strategy'),
})

export type PluginConfig = z.infer<typeof PluginConfigSchema>

/**
 * Validates plugin configuration.
 * Throws a ZodError if validation fails.
 */
export function validateConfig(config: unknown): PluginConfig {
  return PluginConfigSchema.parse(config)
}

/**
 * Safely validates configuration without throwing.
 * Returns a result object with either the validated config or errors.
 */
export function safeValidateConfig(
  config: unknown
): { success: true; data: PluginConfig } | { success: false; errors: z.ZodIssue[] } {
  const result = PluginConfigSchema.safeParse(config)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, errors: result.error.issues }
}
