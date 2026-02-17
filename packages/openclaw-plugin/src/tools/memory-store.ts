/**
 * memory_store tool implementation.
 * Persists important information to long-term memory.
 * Tags support added in Issue #492.
 * Relationship scope added in Issue #493.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { MemoryCategory } from './memory-recall.js';
import { sanitizeText, sanitizeErrorMessage, truncateForPreview } from '../utils/sanitize.js';
import { reverseGeocode } from '../utils/nominatim.js';

/** Location schema for geo-aware memory storage */
export const MemoryLocationSchema = z.object({
  lat: z.number().min(-90, 'Latitude must be >= -90').max(90, 'Latitude must be <= 90'),
  lng: z.number().min(-180, 'Longitude must be >= -180').max(180, 'Longitude must be <= 180'),
  address: z.string().max(500, 'Address must be 500 characters or less').optional(),
  place_label: z.string().max(200, 'Place label must be 200 characters or less').optional(),
});

/** Parameters for memory_store tool — matches OpenClaw gateway: 'text' is primary, 'content' alias for compat */
export const MemoryStoreParamsSchema = z.object({
  text: z.string().min(1, 'Text cannot be empty').max(10000, 'Text must be 10000 characters or less').optional(),
  content: z.string().min(1, 'Content cannot be empty').max(10000, 'Content must be 10000 characters or less').optional(),
  category: MemoryCategory.optional(),
  importance: z.number().min(0).max(1).optional(),
  tags: z.array(z.string().min(1).max(100)).max(20, 'Maximum 20 tags per memory').optional(),
  relationship_id: z.string().uuid('relationship_id must be a valid UUID').optional(),
  location: MemoryLocationSchema.optional(),
}).refine((data) => data.text || data.content, {
  message: 'Either text or content is required',
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
}

/** Tool definition */
export interface MemoryStoreTool {
  name: string;
  description: string;
  parameters: typeof MemoryStoreParamsSchema;
  execute: (params: MemoryStoreParams) => Promise<MemoryStoreResult>;
}

/** Patterns that may indicate credentials */
const CREDENTIAL_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/i, // OpenAI-style API keys
  /api[_-]?key[:\s]*[a-zA-Z0-9]{16,}/i, // Generic API keys
  /password[:\s]*\S{8,}/i, // Passwords
  /secret[_-]?key[:\s]*[a-zA-Z0-9]{16,}/i, // Secret keys
  /bearer\s+[a-zA-Z0-9._-]{20,}/i, // Bearer tokens
];

/**
 * Check if text may contain credentials.
 */
function mayContainCredentials(text: string): boolean {
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Creates the memory_store tool.
 */
export function createMemoryStoreTool(options: MemoryStoreToolOptions): MemoryStoreTool {
  const { client, logger, config, user_id } = options;

  return {
    name: 'memory_store',
    description:
      'Save important information to long-term memory. Use for preferences, facts, decisions, or any information worth remembering. Optionally tag memories for structured retrieval (e.g., ["music", "work", "food"]). Use relationship_id to scope memories to a specific relationship between contacts (e.g., anniversaries, shared preferences).',
    parameters: MemoryStoreParamsSchema,

    async execute(params: MemoryStoreParams): Promise<MemoryStoreResult> {
      // Validate parameters
      const parseResult = MemoryStoreParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { text, content: contentAlias, category = 'other', importance = 0.7, tags = [], relationship_id, location } = parseResult.data;

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

      // Check for potential credentials (warn but don't block)
      if (mayContainCredentials(sanitizedText)) {
        logger.warn('Potential credential detected in memory_store', {
          user_id,
          contentLength: sanitizedText.length,
        });
      }

      // Log invocation (without content for privacy)
      logger.info('memory_store invoked', {
        user_id,
        category,
        importance,
        tags,
        contentLength: sanitizedText.length,
      });

      try {
        // Store memory via API
        // Map plugin category to API memory_type ('other' has no API equivalent, use 'note')
        const memory_type = category === 'other' ? 'note' : category;

        const payload: Record<string, unknown> = {
          content: sanitizedText,
          memory_type: memory_type,
          importance,
          tags,
        };
        if (relationship_id) {
          payload.relationship_id = relationship_id;
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

        const response = await client.post<StoredMemory>('/api/memories/unified', payload, { user_id });

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
        const tagSuffix = tags.length > 0 ? ` (tags: ${tags.join(', ')})` : '';
        const content = `Stored memory [${category}]: "${preview}"${tagSuffix}`;

        logger.debug('memory_store completed', {
          user_id,
          memory_id: stored.id,
        });

        return {
          success: true,
          data: {
            content,
            details: {
              id: stored.id,
              category,
              importance,
              tags,
              user_id,
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
