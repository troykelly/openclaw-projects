/**
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
  contactAId: string;
  /** The second contact in the relationship */
  contactBId: string;
  /** The relationship type */
  relationshipTypeId: string;
  /** Optional notes about this specific relationship */
  notes: string | null;
  /** Agent that created this relationship */
  createdByAgent: string | null;
  /** Embedding status for semantic search */
  embeddingStatus: RelationshipEmbeddingStatus;
  /** Timestamps */
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A relationship with expanded contact and type details.
 */
export interface RelationshipWithDetails extends RelationshipEntry {
  /** Display name of contact A */
  contactAName: string;
  /** Display name of contact B */
  contactBName: string;
  /** The relationship type details */
  relationshipType: Pick<RelationshipTypeEntry, 'id' | 'name' | 'label' | 'isDirectional'>;
}

/**
 * Input for creating a new relationship.
 */
export interface CreateRelationshipInput {
  /** UUID of the first contact */
  contactAId: string;
  /** UUID of the second contact */
  contactBId: string;
  /** UUID of the relationship type */
  relationshipTypeId: string;
  /** Optional notes about this relationship */
  notes?: string;
  /** Agent that created this relationship */
  createdByAgent?: string;
}

/**
 * Input for updating an existing relationship.
 */
export interface UpdateRelationshipInput {
  /** Change the relationship type */
  relationshipTypeId?: string;
  /** Update notes */
  notes?: string | null;
}

/**
 * Options for listing relationships.
 */
export interface ListRelationshipsOptions {
  /** Filter by contact (either side) */
  contactId?: string;
  /** Filter by relationship type */
  relationshipTypeId?: string;
  /** Filter by agent that created */
  createdByAgent?: string;
  /** Limit results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
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
  contactId: string;
  /** The related contact's display name */
  contactName: string;
  /** The related contact's kind (person, organisation, group, agent) */
  contactKind: string;
  /** The relationship record ID */
  relationshipId: string;
  /** The effective relationship type name (inverse resolved for directional B-side) */
  relationshipTypeName: string;
  /** The effective relationship type label */
  relationshipTypeLabel: string;
  /** Whether the type is directional */
  isDirectional: boolean;
  /** Optional notes */
  notes: string | null;
}

/**
 * Result of a graph traversal query for a contact.
 */
export interface GraphTraversalResult {
  /** The queried contact's ID */
  contactId: string;
  /** The queried contact's display name */
  contactName: string;
  /** All related contacts with effective relationship types */
  relatedContacts: RelatedContact[];
}

/**
 * Input for the smart relationship_set operation.
 * Resolves contacts by name/ID and semantically matches the type.
 */
export interface RelationshipSetInput {
  /** Contact A identifier (name or UUID) */
  contactA: string;
  /** Contact B identifier (name or UUID) */
  contactB: string;
  /** Relationship type (name, label, or free text for semantic match) */
  relationshipType: string;
  /** Optional notes */
  notes?: string;
  /** Agent performing the operation */
  createdByAgent?: string;
}

/**
 * Result of the smart relationship_set operation.
 */
export interface RelationshipSetResult {
  /** The created or existing relationship */
  relationship: RelationshipEntry;
  /** The resolved contact A */
  contactA: { id: string; displayName: string };
  /** The resolved contact B */
  contactB: { id: string; displayName: string };
  /** The resolved or created relationship type */
  relationshipType: Pick<RelationshipTypeEntry, 'id' | 'name' | 'label'>;
  /** Whether this was a new creation or existing relationship */
  created: boolean;
}

/**
 * Result of group membership queries.
 */
export interface GroupMembership {
  /** The group contact ID */
  groupId: string;
  /** The group display name */
  groupName: string;
  /** The member contact ID */
  memberId: string;
  /** The member display name */
  memberName: string;
  /** The relationship record ID */
  relationshipId: string;
}
