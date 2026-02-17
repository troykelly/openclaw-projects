/**
 * Relationship management tools implementation.
 * Provides relationship_set and relationship_query tools for OpenClaw agents.
 * Part of Epic #486, Issue #494
 *
 * These tools give agents a simple interface to manage the relationship graph
 * without needing to understand types, directionality, or inverses.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import type { Logger } from '../logger.js';
import type { PluginConfig } from '../config.js';
import { sanitizeText, sanitizeErrorMessage } from '../utils/sanitize.js';

// ==================== Shared utilities ====================

/**
 * Strip HTML tags from a string.
 * Also removes content inside script and style tags for security.
 */
function stripHtml(text: string): string {
  return text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

// ==================== relationship_set ====================

/** Parameters for relationship_set tool */
export const RelationshipSetParamsSchema = z.object({
  contact_a: z.string().min(1, 'First contact name or ID is required').max(200, 'Contact reference must be 200 characters or less'),
  contact_b: z.string().min(1, 'Second contact name or ID is required').max(200, 'Contact reference must be 200 characters or less'),
  relationship: z.string().min(1, 'Relationship description is required').max(200, 'Relationship description must be 200 characters or less'),
  notes: z.string().max(2000, 'Notes must be 2000 characters or less').optional(),
});
export type RelationshipSetParams = z.infer<typeof RelationshipSetParamsSchema>;

/** API response shape for relationship set */
interface RelationshipSetApiResponse {
  relationship: { id: string };
  contact_a: { id: string; display_name: string };
  contact_b: { id: string; display_name: string };
  relationship_type: { id: string; name: string; label: string };
  created: boolean;
}

/** Successful set result */
export interface RelationshipSetSuccess {
  success: true;
  data: {
    content: string;
    details: {
      relationship_id: string;
      created: boolean;
      contact_a: { id: string; display_name: string };
      contact_b: { id: string; display_name: string };
      relationship_type: { id: string; name: string; label: string };
      user_id: string;
    };
  };
}

/** Failed result */
export interface RelationshipFailure {
  success: false;
  error: string;
}

export type RelationshipSetResult = RelationshipSetSuccess | RelationshipFailure;

/** Tool configuration */
export interface RelationshipToolOptions {
  client: ApiClient;
  logger: Logger;
  config: PluginConfig;
  user_id: string;
}

/** Tool definition */
export interface RelationshipSetTool {
  name: string;
  description: string;
  parameters: typeof RelationshipSetParamsSchema;
  execute: (params: RelationshipSetParams) => Promise<RelationshipSetResult>;
}

/**
 * Creates the relationship_set tool.
 * Records a relationship between two people, groups, or organisations.
 * The system handles directionality and type matching automatically.
 */
export function createRelationshipSetTool(options: RelationshipToolOptions): RelationshipSetTool {
  const { client, logger, user_id } = options;

  return {
    name: 'relationship_set',
    description:
      "Record a relationship between two people, groups, or organisations. Examples: 'Troy is Alex\\'s partner', 'Sam is a member of The Kelly Household', 'Troy works for Acme Corp'. The system handles directionality and type matching automatically.",
    parameters: RelationshipSetParamsSchema,

    async execute(params: RelationshipSetParams): Promise<RelationshipSetResult> {
      // Validate parameters
      const parseResult = RelationshipSetParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { contact_a, contact_b, relationship, notes } = parseResult.data;

      // Sanitize inputs
      const sanitizedContactA = stripHtml(sanitizeText(contact_a));
      const sanitizedContactB = stripHtml(sanitizeText(contact_b));
      const sanitizedRelationship = stripHtml(sanitizeText(relationship));
      const sanitizedNotes = notes ? sanitizeText(notes) : undefined;

      if (sanitizedContactA.length === 0) {
        return { success: false, error: 'First contact reference cannot be empty after sanitization' };
      }
      if (sanitizedContactB.length === 0) {
        return { success: false, error: 'Second contact reference cannot be empty after sanitization' };
      }
      if (sanitizedRelationship.length === 0) {
        return { success: false, error: 'Relationship description cannot be empty after sanitization' };
      }

      // Log without PII
      logger.info('relationship_set invoked', {
        user_id,
        contactALength: sanitizedContactA.length,
        contactBLength: sanitizedContactB.length,
        relationshipLength: sanitizedRelationship.length,
        hasNotes: !!sanitizedNotes,
      });

      try {
        const body: Record<string, unknown> = {
          contact_a: sanitizedContactA,
          contact_b: sanitizedContactB,
          relationship_type: sanitizedRelationship,
        };
        if (sanitizedNotes) {
          body.notes = sanitizedNotes;
        }

        const response = await client.post<RelationshipSetApiResponse>('/api/relationships/set', body, { user_id });

        if (!response.success) {
          logger.error('relationship_set API error', {
            user_id,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to set relationship',
          };
        }

        const { relationship: rel, contact_a: resolvedA, contact_b: resolvedB, relationship_type, created } = response.data;

        const content = created
          ? `Recorded: ${resolvedA.display_name} [${relationship_type.label}] ${resolvedB.display_name}`
          : `Relationship already exists: ${resolvedA.display_name} [${relationship_type.label}] ${resolvedB.display_name}`;

        logger.debug('relationship_set completed', {
          user_id,
          relationship_id: rel.id,
          created,
        });

        return {
          success: true,
          data: {
            content,
            details: {
              relationship_id: rel.id,
              created,
              contact_a: resolvedA,
              contact_b: resolvedB,
              relationship_type,
              user_id,
            },
          },
        };
      } catch (error) {
        logger.error('relationship_set failed', {
          user_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}

// ==================== relationship_query ====================

/** Parameters for relationship_query tool */
export const RelationshipQueryParamsSchema = z.object({
  contact: z.string().min(1, 'Contact name or ID is required').max(200, 'Contact reference must be 200 characters or less'),
  type_filter: z.string().max(200, 'Type filter must be 200 characters or less').optional(),
});
export type RelationshipQueryParams = z.infer<typeof RelationshipQueryParamsSchema>;

/** Related contact entry from API */
export interface RelatedContact {
  contact_id: string;
  contact_name: string;
  contact_kind: string;
  relationship_id: string;
  relationship_type_name: string;
  relationship_type_label: string;
  is_directional: boolean;
  notes: string | null;
}

/** API response shape for relationship query */
interface RelationshipQueryApiResponse {
  contact_id: string;
  contact_name: string;
  related_contacts: RelatedContact[];
}

/** Successful query result */
export interface RelationshipQuerySuccess {
  success: true;
  data: {
    content: string;
    details: {
      contact_id: string;
      contact_name: string;
      related_contacts: RelatedContact[];
      user_id: string;
    };
  };
}

export type RelationshipQueryResult = RelationshipQuerySuccess | RelationshipFailure;

/** Tool definition */
export interface RelationshipQueryTool {
  name: string;
  description: string;
  parameters: typeof RelationshipQueryParamsSchema;
  execute: (params: RelationshipQueryParams) => Promise<RelationshipQueryResult>;
}

/**
 * Creates the relationship_query tool.
 * Queries a contact's relationships, returning all connections
 * including family, partners, group memberships, and professional links.
 * Handles directional relationships automatically.
 */
export function createRelationshipQueryTool(options: RelationshipToolOptions): RelationshipQueryTool {
  const { client, logger, user_id } = options;

  return {
    name: 'relationship_query',
    description:
      "Query a contact's relationships. Returns all relationships including family, partners, group memberships, professional connections, etc. Handles directional relationships automatically.",
    parameters: RelationshipQueryParamsSchema,

    async execute(params: RelationshipQueryParams): Promise<RelationshipQueryResult> {
      // Validate parameters
      const parseResult = RelationshipQueryParamsSchema.safeParse(params);
      if (!parseResult.success) {
        const errorMessage = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: errorMessage };
      }

      const { contact, type_filter } = parseResult.data;

      // Sanitize input
      const sanitizedContact = stripHtml(sanitizeText(contact));

      if (sanitizedContact.length === 0) {
        return { success: false, error: 'Contact reference cannot be empty after sanitization' };
      }

      // Log without PII
      logger.info('relationship_query invoked', {
        user_id,
        contactLength: sanitizedContact.length,
        hasTypeFilter: !!type_filter,
      });

      try {
        const queryParams = new URLSearchParams({
          contact: sanitizedContact,
        });
        if (type_filter) {
          queryParams.set('type_filter', type_filter);
        }

        const response = await client.get<RelationshipQueryApiResponse>(`/api/relationships?${queryParams.toString()}`, { user_id });

        if (!response.success) {
          if (response.error.code === 'NOT_FOUND') {
            return { success: false, error: 'Contact not found.' };
          }
          logger.error('relationship_query API error', {
            user_id,
            status: response.error.status,
            code: response.error.code,
          });
          return {
            success: false,
            error: response.error.message || 'Failed to query relationships',
          };
        }

        const { contact_id, contact_name, related_contacts } = response.data;

        if (related_contacts.length === 0) {
          return {
            success: true,
            data: {
              content: `No relationships found for ${contact_name}.`,
              details: {
                contact_id,
                contact_name,
                related_contacts: [],
                user_id,
              },
            },
          };
        }

        // Format relationships as a readable list
        const lines = [`Relationships for ${contact_name}:`];
        for (const rel of related_contacts) {
          const kindTag = rel.contact_kind !== 'person' ? ` [${rel.contact_kind}]` : '';
          const notesTag = rel.notes ? ` -- ${rel.notes}` : '';
          lines.push(`- ${rel.relationship_type_label}: ${rel.contact_name}${kindTag}${notesTag}`);
        }

        const content = lines.join('\n');

        logger.debug('relationship_query completed', {
          user_id,
          contact_id,
          relatedCount: related_contacts.length,
        });

        return {
          success: true,
          data: {
            content,
            details: {
              contact_id,
              contact_name,
              related_contacts,
              user_id,
            },
          },
        };
      } catch (error) {
        logger.error('relationship_query failed', {
          user_id,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: sanitizeErrorMessage(error) };
      }
    },
  };
}
