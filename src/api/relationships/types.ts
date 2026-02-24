/**
 * All property names use snake_case to match the project-wide convention (Issue #1412).
 *
 * Types for the relationship service.
 * Part of Epic #486, Issue #491
 *
 * Relationships connect contacts via relationship types,
 * supporting directional, symmetric, and group membership semantics.
 */

import type { RelationshipTypeEntry } from '../relationship-types/types.ts';

/** Embedding status for relationship records */
export type RelationshipEmbeddingStatus = 'pending' | 'complete' | 'failed';

/**
 * A relationship between two contacts from the database.
 */
export interface RelationshipEntry {
  /** UUID primary key */
  id: string;
  /** The first contact in the relationship */
  contact_a_id: string;
  /** The second contact in the relationship */
  contact_b_id: string;
  /** The relationship type */
  relationship_type_id: string;
  /** Optional notes about this specific relationship */
  notes: string | null;
  /** Agent that created this relationship */
  created_by_agent: string | null;
  /** Embedding status for semantic search */
  embedding_status: RelationshipEmbeddingStatus;
  /** Timestamps */
  created_at: Date;
  updated_at: Date;
}

/**
 * A relationship with expanded contact and type details.
 */
export interface RelationshipWithDetails extends RelationshipEntry {
  /** Display name of contact A */
  contact_a_name: string;
  /** Display name of contact B */
  contact_b_name: string;
  /** The relationship type details */
  relationship_type: Pick<RelationshipTypeEntry, 'id' | 'name' | 'label' | 'is_directional'>;
}

/**
 * Input for creating a new relationship.
 */
export interface CreateRelationshipInput {
  /** UUID of the first contact */
  contact_a_id: string;
  /** UUID of the second contact */
  contact_b_id: string;
  /** UUID of the relationship type */
  relationship_type_id: string;
  /** Optional notes about this relationship */
  notes?: string;
  /** Agent that created this relationship */
  created_by_agent?: string;
  /** Namespace for data partitioning (Epic #1418) */
  namespace?: string;
}

/**
 * Input for updating an existing relationship.
 */
export interface UpdateRelationshipInput {
  /** Change the relationship type */
  relationship_type_id?: string;
  /** Update notes */
  notes?: string | null;
}

/**
 * Options for listing relationships.
 */
export interface ListRelationshipsOptions {
  /** Filter by contact (either side) */
  contact_id?: string;
  /** Filter by relationship type */
  relationship_type_id?: string;
  /** Filter by agent that created */
  created_by_agent?: string;
  /** Limit results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Filter by namespaces (Epic #1418) */
  queryNamespaces?: string[];
}

/**
 * Result of listing relationships.
 */
export interface ListRelationshipsResult {
  relationships: RelationshipWithDetails[];
  total: number;
}

/**
 * A traversal result: a related contact with the effective relationship type.
 * For directional types where the contact is on the B side, the inverse type is used.
 */
export interface RelatedContact {
  /** The related contact's ID */
  contact_id: string;
  /** The related contact's display name */
  contact_name: string;
  /** The related contact's kind (person, organisation, group, agent) */
  contact_kind: string;
  /** The relationship record ID */
  relationship_id: string;
  /** The effective relationship type name (inverse resolved for directional B-side) */
  relationship_type_name: string;
  /** The effective relationship type label */
  relationship_type_label: string;
  /** Whether the type is directional */
  is_directional: boolean;
  /** Optional notes */
  notes: string | null;
}

/**
 * Result of a graph traversal query for a contact.
 */
export interface GraphTraversalResult {
  /** The queried contact's ID */
  contact_id: string;
  /** The queried contact's display name */
  contact_name: string;
  /** All related contacts with effective relationship types */
  related_contacts: RelatedContact[];
}

/**
 * Input for the smart relationship_set operation.
 * Resolves contacts by name/ID and semantically matches the type.
 */
export interface RelationshipSetInput {
  /** Contact A identifier (name or UUID) */
  contact_a: string;
  /** Contact B identifier (name or UUID) */
  contact_b: string;
  /** Relationship type (name, label, or free text for semantic match) */
  relationship_type: string;
  /** Optional notes */
  notes?: string;
  /** Agent performing the operation */
  created_by_agent?: string;
  /** Namespace for data partitioning (Epic #1418) */
  namespace?: string;
  /** Namespaces to search when resolving contact names (Epic #1418) */
  queryNamespaces?: string[];
}

/**
 * Result of the smart relationship_set operation.
 */
export interface RelationshipSetResult {
  /** The created or existing relationship */
  relationship: RelationshipEntry;
  /** The resolved contact A */
  contact_a: { id: string; display_name: string };
  /** The resolved contact B */
  contact_b: { id: string; display_name: string };
  /** The resolved or created relationship type */
  relationship_type: Pick<RelationshipTypeEntry, 'id' | 'name' | 'label'>;
  /** Whether this was a new creation or existing relationship */
  created: boolean;
}

/**
 * Result of group membership queries.
 */
export interface GroupMembership {
  /** The group contact ID */
  group_id: string;
  /** The group display name */
  group_name: string;
  /** The member contact ID */
  member_id: string;
  /** The member display name */
  member_name: string;
  /** The relationship record ID */
  relationship_id: string;
}
