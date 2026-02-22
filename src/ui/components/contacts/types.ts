/**
 * Component-level contact types (#1593).
 *
 * Re-exports from api-types for backward compatibility.
 * Components should import from here or directly from api-types.
 */
export type {
  Contact,
  ContactEndpoint,
  ContactAddress,
  ContactDate,
  ContactRelationship,
  ContactKind,
  CustomField,
  CommChannel,
  CreateContactBody,
  UpdateContactBody,
  TagCount,
  ImportResult,
  MergeResult,
} from '@/ui/lib/api-types.ts';

export interface LinkedWorkItem {
  id: string;
  title: string;
  kind: 'project' | 'initiative' | 'epic' | 'issue';
  status: string;
  relationship: 'owner' | 'assignee' | 'stakeholder' | 'reviewer';
}

export interface LinkedCommunication {
  id: string;
  type: 'email' | 'calendar';
  subject: string;
  date: Date;
  direction?: 'sent' | 'received';
}

export interface ContactFilter {
  search?: string;
  tags?: string[];
  contact_kind?: string[];
  namespace?: string;
}
