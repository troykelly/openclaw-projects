/**
 * Types for organizations and contact groups
 * Issue #394: Implement contact groups and organization hierarchy
 */

/**
 * An organization (company, team, department)
 */
export interface Organization {
  id: string;
  name: string;
  domain?: string;
  logo?: string;
  description?: string;
  parentId?: string;
  contactCount: number;
}

/**
 * A user-defined group of contacts
 */
export interface ContactGroup {
  id: string;
  name: string;
  color: string;
  description?: string;
  memberCount: number;
}

/**
 * Relationship between two contacts
 */
export interface ContactRelationship {
  id: string;
  fromContactId: string;
  toContactId: string;
  type: RelationshipType;
}

/**
 * Types of relationships between contacts
 */
export type RelationshipType = 'manager' | 'reports_to' | 'colleague' | 'assistant' | 'mentor' | 'mentee' | 'partner';

/**
 * Contact with organization and group info
 */
export interface ContactWithOrg {
  id: string;
  name: string;
  email?: string;
  organizationId?: string;
  organizationName?: string;
  groupIds: string[];
}
