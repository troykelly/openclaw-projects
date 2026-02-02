/**
 * Plugin configuration schema using Zod.
 * Validates configuration at runtime to ensure type safety.
 */

import { z } from 'zod'

/** User scoping strategies for memory isolation */
export const UserScopingSchema = z.enum(['agent', 'identity', 'session'])
export type UserScoping = z.infer<typeof UserScopingSchema>

/**
 * Checks if running in production mode.
 */
function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

/** Plugin configuration schema */
export const PluginConfigSchema = z.object({
  /** Backend API URL (must be HTTPS in production) */
  apiUrl: z
    .string()
    .url('apiUrl must be a valid URL')
    .refine(
      (url) => url.startsWith('https://') || !isProduction(),
      { message: 'apiUrl must use HTTPS in production' }
    )
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

  /** Maximum memories to inject in auto-recall */
  maxRecallMemories: z
    .number()
    .int()
    .min(1, 'maxRecallMemories must be at least 1')
    .max(20, 'maxRecallMemories must be at most 20')
    .default(5)
    .describe('Maximum memories to inject'),

  /** Minimum relevance score for auto-recall (0-1) */
  minRecallScore: z
    .number()
    .min(0, 'minRecallScore must be at least 0')
    .max(1, 'minRecallScore must be at most 1')
    .default(0.7)
    .describe('Minimum relevance score'),

  /** Request timeout in milliseconds */
  timeout: z
    .number()
    .int()
    .min(1000, 'timeout must be at least 1000ms')
    .max(60000, 'timeout must be at most 60000ms')
    .default(30000)
    .describe('Request timeout in ms'),

  /** Maximum retries for failed requests */
  maxRetries: z
    .number()
    .int()
    .min(0, 'maxRetries must be at least 0')
    .max(5, 'maxRetries must be at most 5')
    .default(3)
    .describe('Maximum retries'),

  /** Enable debug logging (never logs secrets) */
  debug: z.boolean().default(false).describe('Enable debug logging'),
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

/**
 * Create a safe-to-log version of config (apiKey redacted).
 */
export function redactConfig(
  config: PluginConfig
): Omit<PluginConfig, 'apiKey'> & { apiKey: string } {
  return { ...config, apiKey: '[REDACTED]' }
}
