/**
 * Plugin configuration schema using Zod.
 * Validates configuration at runtime to ensure type safety.
 *
 * Supports flexible secret handling with three patterns:
 * 1. Direct value (e.g., apiKey: "sk-xxx")
 * 2. File reference (e.g., apiKeyFile: "~/.secrets/api_key")
 * 3. Command reference (e.g., apiKeyCommand: "op read op://...")
 */

import { z } from 'zod';
import { resolveSecret, resolveSecretSync, type SecretConfig } from './secrets.js';

/** User scoping strategies for memory isolation */
export const UserScopingSchema = z.enum(['agent', 'identity', 'session']);
export type UserScoping = z.infer<typeof UserScopingSchema>;

/**
 * Checks if running in production mode.
 */
function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Raw plugin configuration schema (before secret resolution).
 * Accepts direct values, file references, or command references for secrets.
 *
 * Configuration Property Names:
 * - apiUrl: Backend API URL (required)
 * - apiKey, apiKeyFile, apiKeyCommand: API authentication
 * - twilioAccountSid, twilioAccountSidFile, twilioAccountSidCommand: Twilio account SID
 * - twilioAuthToken, twilioAuthTokenFile, twilioAuthTokenCommand: Twilio auth token
 * - twilioPhoneNumber, twilioPhoneNumberFile, twilioPhoneNumberCommand: Twilio phone number
 * - postmarkToken, postmarkTokenFile, postmarkTokenCommand: Postmark API token
 * - postmarkFromEmail, postmarkFromEmailFile, postmarkFromEmailCommand: Postmark from address
 * - secretCommandTimeout: Timeout for secret command execution (ms)
 * - autoRecall: Automatically recall relevant memories (boolean)
 * - autoCapture: Automatically capture important information (boolean)
 * - userScoping: How to scope user memories ('agent' | 'identity' | 'session')
 * - maxRecallMemories: Maximum memories to inject (1-20)
 * - minRecallScore: Minimum relevance score for auto-recall (0-1)
 * - timeout: Request timeout in milliseconds (1000-60000)
 * - maxRetries: Maximum retries for failed requests (0-5)
 * - debug: Enable debug logging (boolean)
 * - baseUrl: Base URL for web app (for generating note/notebook URLs)
 *
 * Unknown properties are silently ignored to provide a better user experience.
 */
export const RawPluginConfigSchema = z
  .object({
    /** Backend API URL (must be HTTPS in production) */
    apiUrl: z
      .string()
      .url('apiUrl must be a valid URL')
      .refine((url) => url.startsWith('https://') || !isProduction(), {
        message: 'apiUrl must use HTTPS in production',
      })
      .describe('Backend API URL'),

    // API Key - supports three patterns
    /** API authentication key (direct value) */
    apiKey: z.string().min(1).optional().describe('API key (direct value)'),
    /** Path to file containing API key */
    apiKeyFile: z.string().optional().describe('Path to API key file'),
    /** Command to execute to get API key */
    apiKeyCommand: z.string().optional().describe('Command to get API key'),

    // Twilio Account SID
    /** Twilio Account SID (direct value) */
    twilioAccountSid: z.string().optional().describe('Twilio Account SID'),
    /** Path to file containing Twilio Account SID */
    twilioAccountSidFile: z.string().optional().describe('Path to Twilio Account SID file'),
    /** Command to get Twilio Account SID */
    twilioAccountSidCommand: z.string().optional().describe('Command to get Twilio Account SID'),

    // Twilio Auth Token
    /** Twilio Auth Token (direct value) */
    twilioAuthToken: z.string().optional().describe('Twilio Auth Token'),
    /** Path to file containing Twilio Auth Token */
    twilioAuthTokenFile: z.string().optional().describe('Path to Twilio Auth Token file'),
    /** Command to get Twilio Auth Token */
    twilioAuthTokenCommand: z.string().optional().describe('Command to get Twilio Auth Token'),

    // Twilio Phone Number
    /** Twilio Phone Number (direct value) */
    twilioPhoneNumber: z.string().optional().describe('Twilio Phone Number'),
    /** Path to file containing Twilio Phone Number */
    twilioPhoneNumberFile: z.string().optional().describe('Path to Twilio Phone Number file'),
    /** Command to get Twilio Phone Number */
    twilioPhoneNumberCommand: z.string().optional().describe('Command to get Twilio Phone Number'),

    // Postmark Token
    /** Postmark API Token (direct value) */
    postmarkToken: z.string().optional().describe('Postmark Token'),
    /** Path to file containing Postmark Token */
    postmarkTokenFile: z.string().optional().describe('Path to Postmark Token file'),
    /** Command to get Postmark Token */
    postmarkTokenCommand: z.string().optional().describe('Command to get Postmark Token'),

    // Postmark From Email
    /** Postmark From Email address (direct value) */
    postmarkFromEmail: z.string().email().optional().describe('Postmark From Email'),
    /** Path to file containing Postmark From Email */
    postmarkFromEmailFile: z.string().optional().describe('Path to Postmark From Email file'),
    /** Command to get Postmark From Email */
    postmarkFromEmailCommand: z.string().optional().describe('Command to get Postmark From Email'),

    /** Timeout for secret command execution in milliseconds */
    secretCommandTimeout: z
      .number()
      .int()
      .min(1000, 'secretCommandTimeout must be at least 1000ms')
      .max(30000, 'secretCommandTimeout must be at most 30000ms')
      .default(5000)
      .describe('Secret command timeout in ms'),

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
    maxRetries: z.number().int().min(0, 'maxRetries must be at least 0').max(5, 'maxRetries must be at most 5').default(3).describe('Maximum retries'),

    /** Enable debug logging (never logs secrets) */
    debug: z.boolean().default(false).describe('Enable debug logging'),

    /** Base URL for web app (used for generating note/notebook URLs) */
    baseUrl: z.string().url().optional().describe('Web app base URL'),

    /** Nominatim reverse geocoding URL (e.g., http://nominatim:8080) */
    nominatimUrl: z.string().url().optional().describe('Nominatim reverse geocoding URL'),

    /** PromptGuard-2 classifier URL (e.g., http://prompt-guard:8190) */
    promptGuardUrl: z.string().url().optional().describe('PromptGuard classifier URL'),
  })
  .strip(); // Remove unknown properties instead of rejecting with error

export type RawPluginConfig = z.infer<typeof RawPluginConfigSchema>;

/**
 * Resolved plugin configuration (after secret resolution).
 * Contains the actual secret values ready for use.
 */
export const PluginConfigSchema = z.object({
  /** Backend API URL */
  apiUrl: z.string().url(),

  /** Resolved API authentication key (optional for auth-disabled backends) */
  apiKey: z.string().min(1).optional(),

  /** Resolved Twilio Account SID */
  twilioAccountSid: z.string().optional(),

  /** Resolved Twilio Auth Token */
  twilioAuthToken: z.string().optional(),

  /** Resolved Twilio Phone Number */
  twilioPhoneNumber: z.string().optional(),

  /** Resolved Postmark Token */
  postmarkToken: z.string().optional(),

  /** Resolved Postmark From Email */
  postmarkFromEmail: z.string().email().optional(),

  /** Secret command timeout */
  secretCommandTimeout: z.number().int().default(5000),

  /** Auto-recall memories */
  autoRecall: z.boolean().default(true),

  /** Auto-capture memories */
  autoCapture: z.boolean().default(true),

  /** User scoping strategy */
  userScoping: UserScopingSchema.default('agent'),

  /** Maximum memories to inject */
  maxRecallMemories: z.number().int().default(5),

  /** Minimum relevance score */
  minRecallScore: z.number().default(0.7),

  /** Request timeout in ms */
  timeout: z.number().int().default(30000),

  /** Maximum retries */
  maxRetries: z.number().int().default(3),

  /** Enable debug logging */
  debug: z.boolean().default(false),

  /** Base URL for web app */
  baseUrl: z.string().url().optional(),

  /** Nominatim reverse geocoding URL */
  nominatimUrl: z.string().url().optional(),

  /** PromptGuard-2 classifier URL */
  promptGuardUrl: z.string().url().optional(),
});

export type PluginConfig = z.infer<typeof PluginConfigSchema>;

/**
 * Validates raw plugin configuration (before secret resolution).
 * Use this for initial config validation before resolving secrets.
 * Throws a ZodError if validation fails.
 */
export function validateRawConfig(config: unknown): RawPluginConfig {
  return RawPluginConfigSchema.parse(config);
}

/**
 * Safely validates raw configuration without throwing.
 * Returns a result object with either the validated config or errors.
 */
export function safeValidateRawConfig(config: unknown): { success: true; data: RawPluginConfig } | { success: false; errors: z.ZodIssue[] } {
  const result = RawPluginConfigSchema.safeParse(config);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error.issues };
}

/**
 * Validates resolved plugin configuration (after secret resolution).
 * Throws a ZodError if validation fails.
 */
export function validateConfig(config: unknown): PluginConfig {
  return PluginConfigSchema.parse(config);
}

/**
 * Safely validates resolved configuration without throwing.
 * Returns a result object with either the validated config or errors.
 *
 * Note: This validates raw config for backwards compatibility.
 * Use safeValidateRawConfig for explicit raw config validation.
 */
export function safeValidateConfig(config: unknown): { success: true; data: RawPluginConfig } | { success: false; errors: z.ZodIssue[] } {
  return safeValidateRawConfig(config);
}

/** Secret fields that should be redacted in logs */
const SECRET_FIELDS = ['apiKey', 'twilioAccountSid', 'twilioAuthToken', 'twilioPhoneNumber', 'postmarkToken'] as const;

/**
 * Create a safe-to-log version of config with secrets redacted.
 */
export function redactConfig(config: PluginConfig): PluginConfig {
  const redacted = { ...config };
  for (const field of SECRET_FIELDS) {
    if (redacted[field]) {
      // Type assertion needed because we're setting string fields to '[REDACTED]'
      (redacted as unknown as Record<string, string>)[field] = '[REDACTED]';
    }
  }
  return redacted;
}

/**
 * Builds a SecretConfig from the raw config for a given secret name.
 */
function buildSecretConfig(rawConfig: RawPluginConfig, secretName: keyof RawPluginConfig, timeout: number): SecretConfig {
  const direct = rawConfig[secretName] as string | undefined;
  const file = rawConfig[`${secretName}File` as keyof RawPluginConfig] as string | undefined;
  const command = rawConfig[`${secretName}Command` as keyof RawPluginConfig] as string | undefined;

  return {
    direct,
    file,
    command,
    commandTimeout: timeout,
  };
}

/**
 * Resolves all secrets in a raw config to produce a resolved config.
 *
 * @param rawConfig - The raw plugin configuration with secret references
 * @returns The resolved plugin configuration with actual secret values
 * @throws If required secrets cannot be resolved
 */
export async function resolveConfigSecrets(rawConfig: RawPluginConfig): Promise<PluginConfig> {
  const timeout = rawConfig.secretCommandTimeout;

  // Resolve API key (optional — omitted for auth-disabled backends)
  const apiKey = (await resolveSecret(buildSecretConfig(rawConfig, 'apiKey', timeout), 'apiKey')) || undefined;

  // Resolve optional secrets in parallel
  const [twilioAccountSid, twilioAuthToken, twilioPhoneNumber, postmarkToken, postmarkFromEmail] = await Promise.all([
    resolveSecret(buildSecretConfig(rawConfig, 'twilioAccountSid', timeout), 'twilioAccountSid'),
    resolveSecret(buildSecretConfig(rawConfig, 'twilioAuthToken', timeout), 'twilioAuthToken'),
    resolveSecret(buildSecretConfig(rawConfig, 'twilioPhoneNumber', timeout), 'twilioPhoneNumber'),
    resolveSecret(buildSecretConfig(rawConfig, 'postmarkToken', timeout), 'postmarkToken'),
    resolveSecret(buildSecretConfig(rawConfig, 'postmarkFromEmail', timeout), 'postmarkFromEmail'),
  ]);

  // Build the resolved config
  const resolvedConfig: PluginConfig = {
    apiUrl: rawConfig.apiUrl,
    apiKey,
    twilioAccountSid,
    twilioAuthToken,
    twilioPhoneNumber,
    postmarkToken,
    postmarkFromEmail,
    secretCommandTimeout: timeout,
    autoRecall: rawConfig.autoRecall,
    autoCapture: rawConfig.autoCapture,
    userScoping: rawConfig.userScoping,
    maxRecallMemories: rawConfig.maxRecallMemories,
    minRecallScore: rawConfig.minRecallScore,
    timeout: rawConfig.timeout,
    maxRetries: rawConfig.maxRetries,
    debug: rawConfig.debug,
    baseUrl: rawConfig.baseUrl,
    nominatimUrl: rawConfig.nominatimUrl,
    promptGuardUrl: rawConfig.promptGuardUrl,
  };

  // Validate the resolved config
  return validateConfig(resolvedConfig);
}

/**
 * Resolves all secrets synchronously to produce a resolved config.
 *
 * Used during plugin registration where blocking I/O is acceptable.
 * OpenClaw's loader does not await the register function, so all
 * config resolution must complete synchronously.
 *
 * @param rawConfig - The raw plugin configuration with secret references
 * @returns The resolved plugin configuration with actual secret values
 * @throws If required secrets cannot be resolved
 */
export function resolveConfigSecretsSync(rawConfig: RawPluginConfig): PluginConfig {
  const timeout = rawConfig.secretCommandTimeout;

  // Resolve API key (optional — omitted for auth-disabled backends)
  const apiKey = resolveSecretSync(buildSecretConfig(rawConfig, 'apiKey', timeout), 'apiKey') || undefined;

  // Resolve optional secrets
  const twilioAccountSid = resolveSecretSync(buildSecretConfig(rawConfig, 'twilioAccountSid', timeout), 'twilioAccountSid');
  const twilioAuthToken = resolveSecretSync(buildSecretConfig(rawConfig, 'twilioAuthToken', timeout), 'twilioAuthToken');
  const twilioPhoneNumber = resolveSecretSync(buildSecretConfig(rawConfig, 'twilioPhoneNumber', timeout), 'twilioPhoneNumber');
  const postmarkToken = resolveSecretSync(buildSecretConfig(rawConfig, 'postmarkToken', timeout), 'postmarkToken');
  const postmarkFromEmail = resolveSecretSync(buildSecretConfig(rawConfig, 'postmarkFromEmail', timeout), 'postmarkFromEmail');

  // Build the resolved config
  const resolvedConfig: PluginConfig = {
    apiUrl: rawConfig.apiUrl,
    apiKey,
    twilioAccountSid,
    twilioAuthToken,
    twilioPhoneNumber,
    postmarkToken,
    postmarkFromEmail,
    secretCommandTimeout: timeout,
    autoRecall: rawConfig.autoRecall,
    autoCapture: rawConfig.autoCapture,
    userScoping: rawConfig.userScoping,
    maxRecallMemories: rawConfig.maxRecallMemories,
    minRecallScore: rawConfig.minRecallScore,
    timeout: rawConfig.timeout,
    maxRetries: rawConfig.maxRetries,
    debug: rawConfig.debug,
    baseUrl: rawConfig.baseUrl,
    nominatimUrl: rawConfig.nominatimUrl,
  };

  // Validate the resolved config
  return validateConfig(resolvedConfig);
}
