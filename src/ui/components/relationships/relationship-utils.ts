/**
 * Utility functions for contact relationships
 * Issue #395: Implement contact relationship types
 */
import type { RelationshipType, RelationshipCategory, ProfessionalRelationType, BusinessRelationType, PersonalRelationType } from './types';

/** Relationship types grouped by category */
export const RELATIONSHIP_TYPES: Record<RelationshipCategory, RelationshipType[]> = {
  professional: ['colleague', 'manager', 'direct_report', 'mentor'],
  business: ['client', 'vendor', 'partner', 'investor', 'advisor'],
  personal: ['friend', 'family', 'acquaintance'],
};

/** All relationship types flat */
export const ALL_RELATIONSHIP_TYPES: RelationshipType[] = [...RELATIONSHIP_TYPES.professional, ...RELATIONSHIP_TYPES.business, ...RELATIONSHIP_TYPES.personal];

/** Human-readable labels for relationship types */
const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  colleague: 'Colleague',
  manager: 'Manager',
  direct_report: 'Direct Report',
  mentor: 'Mentor',
  client: 'Client',
  vendor: 'Vendor',
  partner: 'Partner',
  investor: 'Investor',
  advisor: 'Advisor',
  friend: 'Friend',
  family: 'Family',
  acquaintance: 'Acquaintance',
};

/** Human-readable labels for categories */
export const CATEGORY_LABELS: Record<RelationshipCategory, string> = {
  professional: 'Professional',
  business: 'Business',
  personal: 'Personal',
};

/** Get human-readable label for relationship type */
export function getRelationshipLabel(type: RelationshipType): string {
  return RELATIONSHIP_LABELS[type] || type;
}

/** Get category for relationship type */
export function getRelationshipCategory(type: RelationshipType): RelationshipCategory {
  if ((RELATIONSHIP_TYPES.professional as readonly string[]).includes(type)) {
    return 'professional';
  }
  if ((RELATIONSHIP_TYPES.business as readonly string[]).includes(type)) {
    return 'business';
  }
  return 'personal';
}

/** Color classes for categories */
export const CATEGORY_COLORS: Record<RelationshipCategory, string> = {
  professional: 'bg-blue-100 text-blue-800',
  business: 'bg-green-100 text-green-800',
  personal: 'bg-purple-100 text-purple-800',
};

/** Strength labels */
export const STRENGTH_LABELS: Record<string, string> = {
  strong: 'Strong',
  medium: 'Medium',
  weak: 'Weak',
};

/** Direction labels */
export const DIRECTION_LABELS: Record<string, string> = {
  bidirectional: 'Mutual',
  outgoing: 'Outgoing',
  incoming: 'Incoming',
};
