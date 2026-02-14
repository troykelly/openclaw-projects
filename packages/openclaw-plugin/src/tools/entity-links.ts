/**
 * Entity linking tools for OpenClaw plugin (Issue #1220).
 *
 * Provides bidirectional linking between entities (memories, todos, projects,
 * contacts) and external references (GitHub issues, URLs). Links are stored
 * as skill_store items in the `entity_links` collection.
 *
 * Tools:
 * - links_set: Create a bidirectional link between two entities
 * - links_query: Query all links for a given entity
 * - links_remove: Remove a bidirectional link
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

// ==================== Constants ====================

/** Skill ID used for entity link storage in the skill store. */
const SKILL_ID = 'entity-links';

/** Collection name for entity links. */
const COLLECTION = 'entity_links';

/** Internal entity types (must have UUID IDs). */
const INTERNAL_ENTITY_TYPES = ['memory', 'todo', 'project', 'contact'] as const;

/** All entity types including external references. */
const ALL_ENTITY_TYPES = [...INTERNAL_ENTITY_TYPES, 'github_issue', 'url'] as const;

// ==================== Helpers ====================

/** UUID regex for validation */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Check whether a target_type is internal (requires UUID). */
function isInternalType(type: string): boolean {
  return (INTERNAL_ENTITY_TYPES as readonly string[]).includes(type);
}

/**
 * Build a composite key for a link: `source_type:source_ref:target_type:target_ref`
 */
function buildLinkKey(sourceType: string, sourceRef: string, targetType: string, targetRef: string): string {
  return `${sourceType}:${sourceRef}:${targetType}:${targetRef}`;
}

/**
 * Build a tag for source-entity lookup: `src:type:id`
 */
function buildSourceTag(entityType: string, entityRef: string): string {
  return `src:${entityType}:${entityRef}`;
}

// ==================== Schemas ====================

/** Parameters for links_set tool */
export const LinksSetParamsSchema = z.object({
  source_type: z.enum(INTERNAL_ENTITY_TYPES),
  source_id: z.string().uuid('source_id must be a valid UUID'),
  target_type: z.enum(ALL_ENTITY_TYPES),
  target_ref: z.string().min(1, 'target_ref cannot be empty'),
  label: z.string().max(100, 'label must be 100 characters or less').optional(),
}).superRefine((data, ctx) => {
  if (isInternalType(data.target_type) && !UUID_RE.test(data.target_ref)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['target_ref'],
      message: `target_ref must be a valid UUID for internal type '${data.target_type}'`,
    });
  }
});
export type LinksSetParams = z.infer<typeof LinksSetParamsSchema>;

/** Parameters for links_query tool */
export const LinksQueryParamsSchema = z.object({
  entity_type: z.enum(INTERNAL_ENTITY_TYPES),
  entity_id: z.string().uuid('entity_id must be a valid UUID'),
  link_types: z.array(z.enum(ALL_ENTITY_TYPES)).optional(),
});
export type LinksQueryParams = z.infer<typeof LinksQueryParamsSchema>;

/** Parameters for links_remove tool */
export const LinksRemoveParamsSchema = z.object({
  source_type: z.enum(INTERNAL_ENTITY_TYPES),
  source_id: z.string().uuid('source_id must be a valid UUID'),
  target_type: z.enum(ALL_ENTITY_TYPES),
  target_ref: z.string().min(1, 'target_ref cannot be empty'),
}).superRefine((data, ctx) => {
  if (isInternalType(data.target_type) && !UUID_RE.test(data.target_ref)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['target_ref'],
      message: `target_ref must be a valid UUID for internal type '${data.target_type}'`,
    });
  }
});
export type LinksRemoveParams = z.infer<typeof LinksRemoveParamsSchema>;

// ==================== Result types ====================

/** Successful tool result */
export interface EntityLinkToolSuccess {
  success: true;
  data: {
    content: string;
    details: Record<string, unknown>;
  };
}

/** Failed tool result */
export interface EntityLinkToolFailure {
  success: false;
  error: string;
}

export type EntityLinkToolResult = EntityLinkToolSuccess | EntityLinkToolFailure;

// ==================== Tool options ====================

/** Tool configuration */
export interface EntityLinkToolOptions {
  client: ApiClient;
  logger: Logger;
  config?: PluginConfig;
  userId: string;
}

/** Tool definition interface */
export interface EntityLinkTool {
  name: string;
  description: string;
  parameters: z.ZodType;
  execute: (params: Record<string, unknown>) => Promise<EntityLinkToolResult>;
}

// ==================== Skill store item shape ====================

/** Shape returned by the skill store API */
interface SkillStoreItem {
  id: string;
  skill_id: string;
  collection: string;
  key: string | null;
  data: Record<string, unknown>;
  tags: string[];
  status: string;
  [key: string]: unknown;
}

// ==================== links_set ====================

/**
 * Create the links_set tool.
 * Creates a bidirectional link between two entities by storing two skill_store
 * items: one for the forward direction (A->B) and one for the reverse (B->A).
 */
export function createLinksSetTool(options: EntityLinkToolOptions): EntityLinkTool {
  const { client, logger, userId } = options;

  return {
    name: 'links_set',
    description:
      'Create a link between two entities (memory, todo, project, contact, GitHub issue, or URL). ' +
      'Links are bidirectional and can be traversed from either end. Use to connect related items ' +
      'for cross-reference and context discovery.',
    parameters: LinksSetParamsSchema,

    async execute(params: Record<string, unknown>): Promise<EntityLinkToolResult> {
      const parseResult = LinksSetParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { source_type, source_id, target_type, target_ref, label } = parseResult.data;
      const now = new Date().toISOString();

      logger.info('links_set invoked', {
        userId,
        source_type,
        target_type,
        hasLabel: !!label,
      });

      try {
        // Build keys for forward and reverse links
        const forwardKey = buildLinkKey(source_type, source_id, target_type, target_ref);
        const reverseKey = buildLinkKey(target_type, target_ref, source_type, source_id);

        // Forward link data
        const forwardData = {
          source_type,
          source_id,
          target_type,
          target_ref,
          label: label ?? null,
          created_at: now,
        };

        // Reverse link data (swap source and target)
        const reverseData = {
          source_type: target_type,
          source_id: target_ref,
          target_type: source_type,
          target_ref: source_id,
          label: label ?? null,
          created_at: now,
        };

        // Create forward link
        const forwardResponse = await client.post<SkillStoreItem>(
          '/api/skill-store/items',
          {
            skill_id: SKILL_ID,
            collection: COLLECTION,
            key: forwardKey,
            data: forwardData,
            tags: [buildSourceTag(source_type, source_id)],
          },
          { userId },
        );

        if (!forwardResponse.success) {
          logger.error('links_set forward link API error', {
            userId,
            status: forwardResponse.error.status,
            code: forwardResponse.error.code,
          });
          return {
            success: false,
            error: forwardResponse.error.message || 'Failed to create forward link',
          };
        }

        // Create reverse link
        const reverseResponse = await client.post<SkillStoreItem>(
          '/api/skill-store/items',
          {
            skill_id: SKILL_ID,
            collection: COLLECTION,
            key: reverseKey,
            data: reverseData,
            tags: [buildSourceTag(target_type, target_ref)],
          },
          { userId },
        );

        if (!reverseResponse.success) {
          logger.error('links_set reverse link API error', {
            userId,
            status: reverseResponse.error.status,
            code: reverseResponse.error.code,
          });

          // Rollback: delete the orphaned forward link
          const rollback = await client.delete(
            `/api/skill-store/items/${forwardResponse.data.id}`,
            { userId },
          );

          if (!rollback.success) {
            logger.error('links_set rollback failed — partial state', {
              userId,
              forwardId: forwardResponse.data.id,
            });
            return {
              success: false,
              error: `Failed to create reverse link and rollback left partial state (orphan: ${forwardResponse.data.id})`,
            };
          }

          return {
            success: false,
            error: reverseResponse.error.message || 'Failed to create reverse link',
          };
        }

        const labelStr = label ? ` (${label})` : '';
        const content = `Linked ${source_type}:${source_id} -> ${target_type}:${target_ref}${labelStr}`;

        logger.debug('links_set completed', {
          userId,
          forwardId: forwardResponse.data.id,
          reverseId: reverseResponse.data.id,
        });

        return {
          success: true,
          data: {
            content,
            details: {
              source_type,
              source_id,
              target_type,
              target_ref,
              label: label ?? null,
              forwardId: forwardResponse.data.id,
              reverseId: reverseResponse.data.id,
              userId,
            },
          },
        };
      } catch (error) {
        logger.error('links_set failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== links_query ====================

/** Parsed link from a skill_store item's data field */
interface ParsedLink {
  target_type: string;
  target_ref: string;
  label: string | null;
  created_at: string;
}

/**
 * Create the links_query tool.
 * Queries all links for a given entity by listing skill_store items
 * in the `entity_links` collection filtered by a source tag.
 */
export function createLinksQueryTool(options: EntityLinkToolOptions): EntityLinkTool {
  const { client, logger, userId } = options;

  return {
    name: 'links_query',
    description:
      'Query all links for an entity (memory, todo, project, or contact). Returns connected entities ' +
      'including other items, GitHub issues, and URLs. Optionally filter by link target types.',
    parameters: LinksQueryParamsSchema,

    async execute(params: Record<string, unknown>): Promise<EntityLinkToolResult> {
      const parseResult = LinksQueryParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { entity_type, entity_id, link_types } = parseResult.data;

      logger.info('links_query invoked', {
        userId,
        entity_type,
        hasLinkTypes: !!link_types,
      });

      try {
        const tag = buildSourceTag(entity_type, entity_id);
        const queryParams = new URLSearchParams({
          skill_id: SKILL_ID,
          collection: COLLECTION,
          tags: tag,
          limit: '200',
        });

        const response = await client.get<{
          items: SkillStoreItem[];
          total: number;
          has_more: boolean;
        }>(`/api/skill-store/items?${queryParams.toString()}`, { userId });

        if (!response.success) {
          logger.error('links_query API error', {
            userId,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to query links',
          };
        }

        const { items } = response.data;

        // Parse link data from skill_store items
        let links: ParsedLink[] = items.map((item) => ({
          target_type: String(item.data.target_type ?? ''),
          target_ref: String(item.data.target_ref ?? ''),
          label: item.data.label != null ? String(item.data.label) : null,
          created_at: String(item.data.created_at ?? item.created_at ?? ''),
        }));

        // Filter by link_types if specified
        if (link_types && link_types.length > 0) {
          const allowedTypes = new Set(link_types);
          links = links.filter((link) => allowedTypes.has(link.target_type as (typeof ALL_ENTITY_TYPES)[number]));
        }

        if (links.length === 0) {
          return {
            success: true,
            data: {
              content: `No links found for ${entity_type}:${entity_id}.`,
              details: { links: [], entity_type, entity_id, userId },
            },
          };
        }

        // Format as readable list
        const lines = [`Links for ${entity_type}:${entity_id}:`];
        for (const link of links) {
          const labelStr = link.label ? ` (${link.label})` : '';
          lines.push(`- ${link.target_type}:${link.target_ref}${labelStr}`);
        }

        const content = lines.join('\n');

        logger.debug('links_query completed', {
          userId,
          entity_type,
          linkCount: links.length,
        });

        return {
          success: true,
          data: {
            content,
            details: {
              links,
              entity_type,
              entity_id,
              total: links.length,
              userId,
            },
          },
        };
      } catch (error) {
        logger.error('links_query failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== links_remove ====================

/**
 * Create the links_remove tool.
 * Removes a bidirectional link by deleting both the forward (A->B) and
 * reverse (B->A) skill_store items.
 */
export function createLinksRemoveTool(options: EntityLinkToolOptions): EntityLinkTool {
  const { client, logger, userId } = options;

  return {
    name: 'links_remove',
    description:
      'Remove a link between two entities. Deletes both directions of the link. ' +
      'Use when a connection is no longer relevant or was created in error.',
    parameters: LinksRemoveParamsSchema,

    async execute(params: Record<string, unknown>): Promise<EntityLinkToolResult> {
      const parseResult = LinksRemoveParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { source_type, source_id, target_type, target_ref } = parseResult.data;

      logger.info('links_remove invoked', {
        userId,
        source_type,
        target_type,
      });

      try {
        const forwardKey = buildLinkKey(source_type, source_id, target_type, target_ref);
        const reverseKey = buildLinkKey(target_type, target_ref, source_type, source_id);

        // Look up forward item by key
        const forwardLookupParams = new URLSearchParams({
          skill_id: SKILL_ID,
          key: forwardKey,
          collection: COLLECTION,
        });
        const forwardLookup = await client.get<SkillStoreItem>(
          `/api/skill-store/items/by-key?${forwardLookupParams.toString()}`,
          { userId },
        );

        // Look up reverse item by key
        const reverseLookupParams = new URLSearchParams({
          skill_id: SKILL_ID,
          key: reverseKey,
          collection: COLLECTION,
        });
        const reverseLookup = await client.get<SkillStoreItem>(
          `/api/skill-store/items/by-key?${reverseLookupParams.toString()}`,
          { userId },
        );

        // Check if both lookups failed
        if (!forwardLookup.success && !reverseLookup.success) {
          // Differentiate 404 (not found) from other errors
          const fwdIs404 = !forwardLookup.success && forwardLookup.error.status === 404;
          const revIs404 = !reverseLookup.success && reverseLookup.error.status === 404;

          if (fwdIs404 && revIs404) {
            return {
              success: false,
              error: `Link not found between ${source_type}:${source_id} and ${target_type}:${target_ref}`,
            };
          }

          // At least one was a non-404 error — report the actual error
          const errorMessages: string[] = [];
          if (!fwdIs404) errorMessages.push(forwardLookup.error.message || 'Forward lookup failed');
          if (!revIs404) errorMessages.push(reverseLookup.error.message || 'Reverse lookup failed');
          return {
            success: false,
            error: errorMessages.join('; '),
          };
        }

        let deletedCount = 0;
        let expectedCount = 0;
        const deleteErrors: string[] = [];

        // Delete forward link if found
        if (forwardLookup.success) {
          expectedCount++;
          const deleteResult = await client.delete(
            `/api/skill-store/items/${forwardLookup.data.id}`,
            { userId },
          );
          if (deleteResult.success) {
            deletedCount++;
          } else {
            deleteErrors.push(`forward (${forwardLookup.data.id})`);
          }
        }

        // Delete reverse link if found
        if (reverseLookup.success) {
          expectedCount++;
          const deleteResult = await client.delete(
            `/api/skill-store/items/${reverseLookup.data.id}`,
            { userId },
          );
          if (deleteResult.success) {
            deletedCount++;
          } else {
            deleteErrors.push(`reverse (${reverseLookup.data.id})`);
          }
        }

        // If any deletes failed, report partial failure
        if (deletedCount < expectedCount) {
          logger.error('links_remove partial delete', {
            userId,
            deletedCount,
            expectedCount,
            deleteErrors,
          });
          return {
            success: false,
            error: `Removal partial: deleted ${deletedCount}/${expectedCount} records. Failed to delete: ${deleteErrors.join(', ')}`,
          };
        }

        const content = `Removed link between ${source_type}:${source_id} and ${target_type}:${target_ref} (${deletedCount} record${deletedCount !== 1 ? 's' : ''} deleted)`;

        logger.debug('links_remove completed', {
          userId,
          deletedCount,
        });

        return {
          success: true,
          data: {
            content,
            details: {
              source_type,
              source_id,
              target_type,
              target_ref,
              deletedCount,
              userId,
            },
          },
        };
      } catch (error) {
        logger.error('links_remove failed', {
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}
