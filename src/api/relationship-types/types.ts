/**
 * Types for the relationship type system.
 * Part of Epic #486, Issue #490
 *
 * Relationship types define how contacts relate to each other.
 * They can be symmetric (friend_of) or directional (parent_of/child_of).
 */

/** Embedding status for relationship type records */
export type RelationshipTypeEmbeddingStatus = 'pending' | 'complete' | 'failed';

/**
 * A relationship type from the database.
 * Represents how two contacts relate to each other.
 */
export interface RelationshipTypeEntry {
  /** UUID primary key */
  id: string;
  /** snake_case canonical name, e.g. 'partner_of' */
  name: string;
  /** Human-readable label, e.g. 'Partner of' */
  label: string;
  /** Whether the relationship is directional (parent_of -> child_of) */
  isDirectional: boolean;
  /** For directional types, the ID of the inverse type */
  inverseTypeId: string | null;
  /** Description of the relationship type */
  description: string | null;
  /** Agent that created this type (null = pre-seeded) */
  createdByAgent: string | null;
  /** Embedding status for semantic matching */
  embeddingStatus: RelationshipTypeEmbeddingStatus;
  /** Timestamps */
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A relationship type with its inverse type populated.
 */
export interface RelationshipTypeWithInverse extends RelationshipTypeEntry {
  /** The inverse relationship type (if directional) */
  inverseType: Pick<RelationshipTypeEntry, 'id' | 'name' | 'label'> | null;
}

/**
 * Input for creating a new relationship type.
 */
export interface CreateRelationshipTypeInput {
  /** snake_case canonical name */
  name: string;
  /** Human-readable label */
  label: string;
  /** Whether the relationship is directional */
  isDirectional?: boolean;
  /** For directional types, the name of the inverse type to link */
  inverseTypeName?: string;
  /** Description of the relationship type */
  description?: string;
  /** Agent that created this type */
  createdByAgent?: string;
}

/**
 * Input for updating a relationship type.
 */
export interface UpdateRelationshipTypeInput {
  /** Human-readable label */
  label?: string;
  /** Description of the relationship type */
  description?: string;
}

/**
 * Options for listing relationship types.
 */
export interface ListRelationshipTypesOptions {
  /** Filter by directional or symmetric */
  isDirectional?: boolean;
  /** Filter by agent-created vs pre-seeded */
  createdByAgent?: string;
  /** Only pre-seeded types (created_by_agent IS NULL) */
  preSeededOnly?: boolean;
  /** Limit results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Result of listing relationship types.
 */
export interface ListRelationshipTypesResult {
  types: RelationshipTypeWithInverse[];
  total: number;
}

/**
 * Result of semantic matching for relationship types.
 */
export interface SemanticMatchResult {
  /** The matched relationship type */
  type: RelationshipTypeEntry;
  /** Similarity score (0-1, higher is better) */
  similarity: number;
}
