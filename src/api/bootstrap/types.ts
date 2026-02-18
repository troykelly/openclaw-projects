/**
 * Types for the agent context bootstrap API.
 * Part of Epic #199, Issue #219
 */

/** User information for bootstrap context */
export interface BootstrapUser {
  email: string;
  timezone?: string;
  settings: Record<string, unknown>;
}

/** User preference memory */
export interface BootstrapPreference {
  id: string;
  type: string;
  title: string;
  content: string;
  importance: number;
  created_at: Date;
}

/** Active project summary */
export interface BootstrapProject {
  id: string;
  title: string;
  status: string;
  kind: string;
  updated_at: Date;
}

/** Pending reminder */
export interface BootstrapReminder {
  id: string;
  title: string;
  description?: string;
  not_before: Date;
  kind: string;
}

/** Recent activity entry */
export interface BootstrapActivity {
  type: string;
  entity_id: string;
  entity_title?: string;
  timestamp: Date;
}

/** Key contact summary */
export interface BootstrapContact {
  id: string;
  display_name: string;
  last_contact?: Date;
  endpoint_count: number;
}

/** Bootstrap statistics */
export interface BootstrapStats {
  open_items: number;
  due_today: number;
  overdue: number;
  total_projects: number;
  total_memories: number;
  total_contacts: number;
}

/** Full bootstrap response */
export interface BootstrapResponse {
  user: BootstrapUser | null;
  preferences: BootstrapPreference[];
  active_projects: BootstrapProject[];
  pending_reminders: BootstrapReminder[];
  recent_activity: BootstrapActivity[];
  unread_messages: number;
  key_contacts: BootstrapContact[];
  stats: BootstrapStats;
  generated_at: Date;
  next_refresh_hint: Date;
}

/** Options for bootstrap request */
export interface BootstrapOptions {
  user_email?: string;
  include?: string[];
  exclude?: string[];
  limit?: {
    preferences?: number;
    projects?: number;
    reminders?: number;
    activity?: number;
    contacts?: number;
  };
}

/** Available bootstrap sections */
export const BOOTSTRAP_SECTIONS = ['user', 'preferences', 'projects', 'reminders', 'activity', 'messages', 'contacts', 'stats'] as const;

export type BootstrapSection = (typeof BOOTSTRAP_SECTIONS)[number];
