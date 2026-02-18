/**
 * Types for contact relationships
 * Issue #395: Implement contact relationship types
 */

/** Professional relationship types */
export type ProfessionalRelationType = 'colleague' | 'manager' | 'direct_report' | 'mentor';

/** Business relationship types */
export type BusinessRelationType = 'client' | 'vendor' | 'partner' | 'investor' | 'advisor';

/** Personal relationship types */
export type PersonalRelationType = 'friend' | 'family' | 'acquaintance';

/** All relationship types */
export type RelationshipType = ProfessionalRelationType | BusinessRelationType | PersonalRelationType;

/** Relationship category */
export type RelationshipCategory = 'professional' | 'business' | 'personal';

/** Relationship strength */
export type RelationshipStrength = 'strong' | 'medium' | 'weak';

/** Relationship direction */
export type RelationshipDirection = 'bidirectional' | 'outgoing' | 'incoming';

/** A relationship between contacts */
export interface ContactRelationship {
  id: string;
  contact_id: string;
  relatedContactId: string;
  type: RelationshipType;
  strength?: RelationshipStrength;
  direction: RelationshipDirection;
  notes?: string;
  lastInteraction?: string;
  created_at?: string;
  updated_at?: string;
}

/** A contact for relationship display */
export interface Contact {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  avatar?: string;
  organizationId?: string;
  organizationName?: string;
}

/** New relationship data for creation */
export interface NewRelationshipData {
  contact_id: string;
  relatedContactId: string;
  type: RelationshipType;
  strength?: RelationshipStrength;
  direction: RelationshipDirection;
  notes?: string;
}
