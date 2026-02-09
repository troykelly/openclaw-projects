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
  createdAt: Date;
}

/** Active project summary */
export interface BootstrapProject {
  id: string;
  title: string;
  status: string;
  kind: string;
  updatedAt: Date;
}

/** Pending reminder */
export interface BootstrapReminder {
  id: string;
  title: string;
  description?: string;
  notBefore: Date;
  kind: string;
}

/** Recent activity entry */
export interface BootstrapActivity {
  type: string;
  entityId: string;
  entityTitle?: string;
  timestamp: Date;
}

/** Key contact summary */
export interface BootstrapContact {
  id: string;
  displayName: string;
  lastContact?: Date;
  endpointCount: number;
}

/** Bootstrap statistics */
export interface BootstrapStats {
  openItems: number;
  dueToday: number;
  overdue: number;
  totalProjects: number;
  totalMemories: number;
  totalContacts: number;
}

/** Full bootstrap response */
export interface BootstrapResponse {
  user: BootstrapUser | null;
  preferences: BootstrapPreference[];
  activeProjects: BootstrapProject[];
  pendingReminders: BootstrapReminder[];
  recentActivity: BootstrapActivity[];
  unreadMessages: number;
  keyContacts: BootstrapContact[];
  stats: BootstrapStats;
  generatedAt: Date;
  nextRefreshHint: Date;
}

/** Options for bootstrap request */
export interface BootstrapOptions {
  userEmail?: string;
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
