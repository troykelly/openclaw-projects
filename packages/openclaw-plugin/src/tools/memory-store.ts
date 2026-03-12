/**
 * memory_store tool implementation.
 * Persists important information to long-term memory.
 *
 * Issues addressed:
 * - #492:  Tags support
 * - #493:  Relationship scope
 * - #2434: Ephemeral TTL shorthand (ttl parameter → expires_at)
 * - #2437: Namespace header on all API calls
 * - #2438: Hardened credential filtering — blocks by default, allow_sensitive opt-in
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { MemoryCategory } from './memory-recall.js';
import { sanitizeText, sanitizeErrorMessage, truncateForPreview } from '../utils/sanitize.js';
import { reverseGeocode } from '../utils/nominatim.js';
import { resolveTtl } from '../utils/temporal.js';

/** Location schema for geo-aware memory storage */
export const MemoryLocationSchema = z.object({
  lat: z.number().min(-90, 'Latitude must be >= -90').max(90, 'Latitude must be <= 90'),
  lng: z.number().min(-180, 'Longitude must be >= -180').max(180, 'Longitude must be <= 180'),
  address: z.string().max(500, 'Address must be 500 characters or less').optional(),
  place_label: z.string().max(200, 'Place label must be 200 characters or less').optional(),
});

/**
 * Parameters for memory_store tool — matches OpenClaw gateway:
 * 'text' is primary, 'content' alias for backward compat.
 *
 * New in #2434: ttl shorthand (e.g. "24h", "7d") converted to expires_at.
 * New in #2438: allow_sensitive opt-in for intentional secret storage.
 */
export const MemoryStoreParamsSchema = z.object({
  text: z.string().min(1, 'Text cannot be empty').max(10000, 'Text must be 10000 characters or less').optional(),
  content: z.string().min(1, 'Content cannot be empty').max(10000, 'Content must be 10000 characters or less').optional(),
  category: MemoryCategory.optional(),
  importance: z.number().min(0).max(1).optional(),
  tags: z.array(z.string().min(1).max(100)).max(20, 'Maximum 20 tags per memory').optional(),
  relationship_id: z.string().uuid('relationship_id must be a valid UUID').optional(),
  location: MemoryLocationSchema.optional(),
  pinned: z.boolean().optional().describe('When true, this memory is always included in context injection regardless of semantic similarity'),
  /**
   * Convenience TTL shorthand for ephemeral working memories (Issue #2434).
   * Supported: "1h", "6h", "24h", "3d", "7d", "30d" (max 365d).
   * Mutually exclusive with expires_at.
   * When provided, automatically adds "ephemeral" tag.
   */
  ttl: z.string().optional().describe('TTL shorthand for ephemeral memories (e.g. "24h", "7d"). Converted to expires_at. Auto-adds "ephemeral" tag.'),
  /**
   * Absolute expiry timestamp (ISO 8601 with timezone).
   * Mutually exclusive with ttl (Issue #2434).
   */
  expires_at: z.string().optional().describe('Absolute expiry timestamp (ISO 8601 with timezone). Mutually exclusive with ttl.'),
  /**
   * Explicit opt-in to store content that may contain secrets (Issue #2438).
   * When false (default), content matching credential patterns is BLOCKED.
   * When true, storage proceeds with an audit log entry.
   * This is intentionally verbose to discourage casual use.
   */
  allow_sensitive: z.boolean().optional().describe('Set to true to intentionally store content containing secrets or credentials. Generates an audit log entry.'),
}).refine((data) => data.text || data.content, {
  message: 'Either text or content is required',
}).refine((data) => !(data.ttl && data.expires_at), {
  message: 'ttl and expires_at are mutually exclusive — use one or the other',
  path: ['ttl'],
});
export type MemoryStoreParams = z.infer<typeof MemoryStoreParamsSchema>;

/** Stored memory response from API */
export interface StoredMemory {
  id: string;
  content: string;
  category?: string;
  importance?: number;
  tags?: string[];
  created_at?: string;
}

/** Successful tool result */
export interface MemoryStoreSuccess {
  success: true;
  data: {
    content: string;
    details: {
      id: string;
      category: string;
      importance: number;
      tags: string[];
      user_id: string;
      expires_at?: string;
    };
  };
}

/** Failed tool result */
export interface MemoryStoreFailure {
  success: false;
  error: string;
}

/** Tool result type */
export type MemoryStoreResult = MemoryStoreSuccess | MemoryStoreFailure;

/** Tool configuration */
export interface MemoryStoreToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
  /** Namespace to scope storage to (Issue #2437 — always send X-Namespace header) */
  namespace?: string;
}

/** Tool definition */
export interface MemoryStoreTool {
  name: string;
  description: string;
  parameters: typeof MemoryStoreParamsSchema;
  execute: (params: MemoryStoreParams) => Promise<MemoryStoreResult>;
}

/**
 * Credential patterns for secret detection (Issue #2438).
 * Covers common formats and basic evasion attempts.
 *
 * Detection is necessarily heuristic — use allow_sensitive for intentional storage.
 */
const CREDENTIAL_PATTERNS: RegExp[] = [
  // OpenAI-style API keys
  /sk-[a-zA-Z0-9]{20,}/i,
  // Anthropic API keys
  /sk-ant-[a-zA-Z0-9]{20,}/i,
  // AWS access key format (AKIA... 20-char alphanumeric)
  /AKIA[0-9A-Z]{16}/,
  // Generic "api_key: <value>" or "apikey: <value>" patterns
  /api[_-]?key[:\s=]+[a-zA-Z0-9+/=_-]{16,}/i,
  // Password patterns
  /password[:\s=]+\S{8,}/i,
  // Secret key patterns
  /secret[_-]?key[:\s=]+[a-zA-Z0-9+/=_-]{16,}/i,
  // Bearer token patterns
  /bearer\s+[a-zA-Z0-9._-]{20,}/i,
  // Private key PEM headers
  /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/i,
  // Base64-encoded OpenAI key pattern (sk-<base64>)
  /c2stW2EtekEtWjAtOV17MjB9/i,
  // GitHub personal access token format
  /gh[pousr]_[a-zA-Z0-9]{36}/i,
  // Slack bot/app tokens
  /xox[baprs]-[0-9A-Z]+-[0-9A-Z]+-[0-9A-Z]+/i,
];

/**
 * Check if text may contain credentials or sensitive secrets.
 * Returns true if any pattern matches.
 */
function mayContainCredentials(text: string): boolean {
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Creates the memory_store tool.
 *
 * Security hardening (Issue #2438):
 * - Content matching credential patterns is BLOCKED by default
 * - Set allow_sensitive=true to bypass with audit log
 *
 * Ephemeral TTL (Issue #2434):
 * - Pass ttl="24h" to automatically set expires_at and add "ephemeral" tag
 *
 * Namespace header (Issue #2437):
 * - Namespace is always sent via X-Namespace header on API call
 */
export function createMemoryStoreTool(options: MemoryStoreToolOptions): MemoryStoreTool {
  const { client, logger, config, user_id, namespace } = options;

  return {
    name: 'memory_store',
    description:
      'Save important information to long-term memory. Use for preferences, facts, decisions, or any information worth remembering. ' +
      'Optionally tag memories for structured retrieval (e.g., ["music", "work", "food"]). ' +
      'Use relationship_id to scope memories to a specific relationship between contacts (e.g., anniversaries, shared preferences). ' +
      'For ephemeral working notes, pass ttl="24h" to auto-expire after 24 hours — this also adds the "ephemeral" tag for easy filtering during consolidation.',
    parameters: MemoryStoreParamsSchema,

    async execute(params: MemoryStoreParams): Promise<MemoryStoreResult> {
      // Validate parameters
      const parseResult = MemoryStoreParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { text, content: contentAlias, category = 'other', importance = 0.7, tags = [], relationship_id, location, pinned, ttl, expires_at, allow_sensitive } = parseResult.data;

      // Accept 'text' (OpenClaw native) or 'content' (backwards compat)
      const rawText = text || contentAlias;
      if (!rawText) {
        return { success: false, error: 'text is required' };
      }

      // Sanitize content
      const sanitizedText = sanitizeText(rawText);
      if (sanitizedText.length === 0) {
        return { success: false, error: 'Content cannot be empty after sanitization' };
      }

      // Resolve TTL shorthand to absolute expires_at (Issue #2434)
      let resolvedExpiresAt: string | undefined = expires_at;
      let effectiveTags = [...tags];

      if (ttl) {
        const expiryDate = resolveTtl(ttl);
        if (!expiryDate) {
          return {
            success: false,
            error: `Invalid TTL format: "${ttl}". Supported formats: 1h, 6h, 24h, 3d, 7d, 30d (max 365 days).`,
          };
        }
        resolvedExpiresAt = expiryDate.toISOString();

        // Auto-add "ephemeral" tag when TTL is set and not already present (Issue #2434)
        if (!effectiveTags.includes('ephemeral')) {
          effectiveTags = [...effectiveTags, 'ephemeral'];
        }
      }

      // Credential check: BLOCK by default (Issue #2438)
      if (mayContainCredentials(sanitizedText)) {
        if (!allow_sensitive) {
          // Block the storage and log the attempt (without content)
          logger.warn('memory_store blocked: credential pattern detected in content', {
            user_id,
            contentLength: sanitizedText.length,
            category,
          });
          return {
            success: false,
            error:
              'Content appears to contain credentials or API keys. Memory storage blocked for security. ' +
              'If you intentionally want to store sensitive content, pass allow_sensitive=true. ' +
              'This will be logged for audit purposes.',
          };
        }

        // allow_sensitive=true: log audit entry but proceed
        logger.warn('memory_store audit: sensitive content stored with allow_sensitive=true', {
          user_id,
          contentLength: sanitizedText.length,
          category,
          allow_sensitive: true,
        });
      }

      // Log invocation (without content for privacy)
      logger.info('memory_store invoked', {
        user_id,
        category,
        importance,
        tags: effectiveTags,
        contentLength: sanitizedText.length,
        hasTtl: !!ttl,
        hasExpiresAt: !!resolvedExpiresAt,
      });

      try {
        // Store memory via API
        // Categories now aligned across all layers (#2446, #2450)
        const payload: Record<string, unknown> = {
          content: sanitizedText,
          memory_type: category,
          importance,
          tags: effectiveTags,
        };
        if (relationship_id) {
          payload.relationship_id = relationship_id;
        }
        if (pinned !== undefined) {
          payload.pinned = pinned;
        }
        if (resolvedExpiresAt) {
          payload.expires_at = resolvedExpiresAt;
        }
        if (location) {
          payload.lat = location.lat;
          payload.lng = location.lng;

          // Reverse geocode if address is missing and Nominatim is configured
          if (!location.address && config.nominatimUrl) {
            const geocoded = await reverseGeocode(location.lat, location.lng, config.nominatimUrl);
            if (geocoded) {
              payload.address = geocoded.address;
              if (!location.place_label && geocoded.place_label) {
                payload.place_label = geocoded.place_label;
              }
            }
          }

          if (location.address) payload.address = location.address;
          if (location.place_label) payload.place_label = location.place_label;
        }

        // Always send namespace header (Issue #2437)
        const response = await client.post<StoredMemory>('/memories/unified', payload, { user_id, namespace });

        if (!response.success) {
          logger.error('memory_store API error', {
            user_id,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to store memory',
          };
        }

        const stored = response.data;

        // Format response
        const preview = truncateForPreview(sanitizedText);
        const tagSuffix = effectiveTags.length > 0 ? ` (tags: ${effectiveTags.join(', ')})` : '';
        const ttlSuffix = resolvedExpiresAt ? ' [ephemeral]' : '';
        const contentMsg = `Stored memory [${category}]: "${preview}"${tagSuffix}${ttlSuffix}`;

        logger.debug('memory_store completed', {
          user_id,
          memory_id: stored.id,
          hasTtl: !!resolvedExpiresAt,
        });

        return {
          success: true,
          data: {
            content: contentMsg,
            details: {
              id: stored.id,
              category,
              importance,
              tags: effectiveTags,
              user_id,
              ...(resolvedExpiresAt ? { expires_at: resolvedExpiresAt } : {}),
            },
          },
        };
      } catch (error) {
        logger.error('memory_store failed', {
          user_id,
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          success: false,
          error: sanitizeErrorMessage(error),
        };
      }
    },
  };
}
