/**
 * Contact relationship components
 * Issue #395: Implement contact relationship types
 */
export { RelationshipBadge } from './relationship-badge';
export type { RelationshipBadgeProps } from './relationship-badge';
export { RelationshipCard } from './relationship-card';
export type { RelationshipCardProps } from './relationship-card';
export { AddRelationshipDialog } from './add-relationship-dialog';
export type { AddRelationshipDialogProps } from './add-relationship-dialog';
export { RelationshipFilter } from './relationship-filter';
export type { RelationshipFilterProps } from './relationship-filter';
export { ContactRelationshipSection } from './contact-relationship-section';
export type { ContactRelationshipSectionProps } from './contact-relationship-section';
export type {
  RelationshipType,
  RelationshipCategory,
  RelationshipStrength,
  RelationshipDirection,
  ContactRelationship,
  Contact,
  NewRelationshipData,
} from './types';
export {
  RELATIONSHIP_TYPES,
  ALL_RELATIONSHIP_TYPES,
  CATEGORY_LABELS,
  getRelationshipLabel,
  getRelationshipCategory,
  CATEGORY_COLORS,
  STRENGTH_LABELS,
  DIRECTION_LABELS,
} from './relationship-utils';
