export interface Contact {
  id: string;
  name: string;
  email: string;
  company?: string;
  role?: string;
  avatar?: string;
  phone?: string;
  notes?: string;
  linkedItemCount: number;
  created_at: Date;
  updated_at: Date;
}

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

export interface ContactDetail extends Contact {
  linkedWorkItems: LinkedWorkItem[];
  linkedCommunications: LinkedCommunication[];
}

export interface ContactFilter {
  search?: string;
  company?: string;
  role?: string;
}
