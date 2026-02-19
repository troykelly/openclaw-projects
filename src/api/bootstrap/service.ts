/**
 * Agent context bootstrap service.
 * Part of Epic #199, Issue #219
 */

import type { Pool } from 'pg';
import type {
  BootstrapResponse,
  BootstrapOptions,
  BootstrapUser,
  BootstrapPreference,
  BootstrapProject,
  BootstrapReminder,
  BootstrapActivity,
  BootstrapContact,
  BootstrapStats,
  BootstrapSection,
} from './types.ts';
import { BOOTSTRAP_SECTIONS } from './types.ts';

/**
 * Determines which sections to include based on options.
 */
function getSectionsToFetch(options: BootstrapOptions): Set<BootstrapSection> {
  const sections = new Set<BootstrapSection>(BOOTSTRAP_SECTIONS);

  if (options.include && options.include.length > 0) {
    // If include is specified, only include those sections
    sections.clear();
    for (const section of options.include) {
      if (BOOTSTRAP_SECTIONS.includes(section as BootstrapSection)) {
        sections.add(section as BootstrapSection);
      }
    }
  }

  if (options.exclude) {
    for (const section of options.exclude) {
      sections.delete(section as BootstrapSection);
    }
  }

  return sections;
}

/**
 * Fetches user settings.
 */
async function fetchUser(pool: Pool, user_email: string): Promise<BootstrapUser | null> {
  const result = await pool.query(
    `SELECT theme, default_view, default_project_id::text,
            sidebar_collapsed, show_completed_items, items_per_page,
            email_notifications, email_digest_frequency, timezone
     FROM user_setting
     WHERE email = $1`,
    [user_email],
  );

  if (result.rows.length === 0) {
    return {
      email: user_email,
      settings: {},
    };
  }

  const row = result.rows[0] as Record<string, unknown>;
  const settings: Record<string, unknown> = {};

  // Map all available settings
  for (const [key, value] of Object.entries(row)) {
    if (value !== null) {
      settings[key] = value;
    }
  }

  return {
    email: user_email,
    timezone: row.timezone as string | undefined,
    settings,
  };
}

/**
 * Fetches user preferences (preference-type memories).
 * Phase 4 (Epic #1418): namespace scoping replaces user_email.
 */
async function fetchPreferences(pool: Pool, _user_email: string, limit: number, queryNamespaces: string[] = ['default']): Promise<BootstrapPreference[]> {
  const result = await pool.query(
    `SELECT id::text, memory_type as type, title, content, importance, created_at
     FROM memory
     WHERE memory_type IN ('preference', 'fact')
       AND (expires_at IS NULL OR expires_at > NOW())
       AND superseded_by IS NULL
       AND namespace = ANY($2::text[])
     ORDER BY importance DESC, created_at DESC
     LIMIT $1`,
    [limit, queryNamespaces],
  );

  return result.rows.map((row) => {
    const r = row as {
      id: string;
      type: string;
      title: string;
      content: string;
      importance: number;
      created_at: string;
    };
    return {
      id: r.id,
      type: r.type,
      title: r.title,
      content: r.content,
      importance: r.importance,
      created_at: new Date(r.created_at),
    };
  });
}

/**
 * Fetches active projects.
 */
async function fetchActiveProjects(pool: Pool, limit: number, queryNamespaces: string[] = ['default']): Promise<BootstrapProject[]> {
  const result = await pool.query(
    `SELECT id::text, title, status, work_item_kind::text as kind, updated_at
     FROM work_item
     WHERE work_item_kind::text IN ('project', 'epic', 'initiative')
       AND status NOT IN ('completed', 'cancelled', 'archived')
       AND namespace = ANY($2::text[])
     ORDER BY updated_at DESC
     LIMIT $1`,
    [limit, queryNamespaces],
  );

  return result.rows.map((row) => {
    const r = row as {
      id: string;
      title: string;
      status: string;
      kind: string;
      updated_at: string;
    };
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      kind: r.kind,
      updated_at: new Date(r.updated_at),
    };
  });
}

/**
 * Fetches pending reminders (work items with not_before in the future).
 */
async function fetchPendingReminders(pool: Pool, limit: number, queryNamespaces: string[] = ['default']): Promise<BootstrapReminder[]> {
  const result = await pool.query(
    `SELECT id::text, title, description, not_before, work_item_kind::text as kind
     FROM work_item
     WHERE not_before IS NOT NULL
       AND not_before > NOW()
       AND status NOT IN ('completed', 'cancelled', 'archived')
       AND namespace = ANY($2::text[])
     ORDER BY not_before ASC
     LIMIT $1`,
    [limit, queryNamespaces],
  );

  return result.rows.map((row) => {
    const r = row as {
      id: string;
      title: string;
      description: string | null;
      not_before: string;
      kind: string;
    };
    return {
      id: r.id,
      title: r.title,
      description: r.description ?? undefined,
      not_before: new Date(r.not_before),
      kind: r.kind,
    };
  });
}

/**
 * Fetches recent activity.
 */
async function fetchRecentActivity(pool: Pool, limit: number, queryNamespaces: string[] = ['default']): Promise<BootstrapActivity[]> {
  // Activity is tracked in the activity table if it exists
  // For now, we'll use work_item changes as a proxy
  const result = await pool.query(
    `SELECT
       'work_item:updated' as type,
       id::text as entity_id,
       title as entity_title,
       updated_at as timestamp
     FROM work_item
     WHERE updated_at > NOW() - INTERVAL '7 days'
       AND namespace = ANY($2::text[])
     ORDER BY updated_at DESC
     LIMIT $1`,
    [limit, queryNamespaces],
  );

  return result.rows.map((row) => {
    const r = row as {
      type: string;
      entity_id: string;
      entity_title: string;
      timestamp: string;
    };
    return {
      type: r.type,
      entity_id: r.entity_id,
      entity_title: r.entity_title,
      timestamp: new Date(r.timestamp),
    };
  });
}

/**
 * Fetches unread message count.
 *
 * For now, we count inbound messages from the last 24 hours as "unread".
 * A proper read/unread tracking system would require a new column or table.
 */
async function fetchUnreadMessages(pool: Pool): Promise<number> {
  // Count recent inbound messages that don't have a work_item_communication entry
  // (i.e., haven't been acted upon)
  const result = await pool.query(
    `SELECT COUNT(*) as count
     FROM external_message em
     WHERE em.direction = 'inbound'
       AND em.received_at > NOW() - INTERVAL '24 hours'
       AND NOT EXISTS (
         SELECT 1 FROM work_item_communication wic
         WHERE wic.message_id = em.id
       )`,
  );

  return parseInt((result.rows[0] as { count: string }).count, 10);
}

/**
 * Fetches key contacts.
 */
async function fetchKeyContacts(pool: Pool, limit: number, queryNamespaces: string[] = ['default']): Promise<BootstrapContact[]> {
  const result = await pool.query(
    `SELECT
       c.id::text,
       c.display_name,
       (SELECT MAX(em.received_at)
        FROM external_message em
        JOIN external_thread et ON et.id = em.thread_id
        JOIN contact_endpoint ce ON ce.id = et.endpoint_id
        WHERE ce.contact_id = c.id
       ) as last_contact,
       (SELECT COUNT(*) FROM contact_endpoint WHERE contact_id = c.id) as endpoint_count
     FROM contact c
     WHERE c.namespace = ANY($2::text[])
     ORDER BY last_contact DESC NULLS LAST
     LIMIT $1`,
    [limit, queryNamespaces],
  );

  return result.rows.map((row) => {
    const r = row as {
      id: string;
      display_name: string;
      last_contact: string | null;
      endpoint_count: string;
    };
    return {
      id: r.id,
      display_name: r.display_name,
      last_contact: r.last_contact ? new Date(r.last_contact) : undefined,
      endpoint_count: parseInt(r.endpoint_count, 10),
    };
  });
}

/**
 * Fetches statistics.
 */
async function fetchStats(pool: Pool): Promise<BootstrapStats> {
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM work_item WHERE status NOT IN ('completed', 'cancelled', 'archived')) as open_items,
      (SELECT COUNT(*) FROM work_item
       WHERE not_after IS NOT NULL
         AND not_after::date = CURRENT_DATE
         AND status NOT IN ('completed', 'cancelled', 'archived')) as due_today,
      (SELECT COUNT(*) FROM work_item
       WHERE not_after IS NOT NULL
         AND not_after < NOW()
         AND status NOT IN ('completed', 'cancelled', 'archived')) as overdue,
      (SELECT COUNT(*) FROM work_item WHERE work_item_kind::text = 'project') as total_projects,
      (SELECT COUNT(*) FROM memory) as total_memories,
      (SELECT COUNT(*) FROM contact) as total_contacts
  `);

  const row = result.rows[0] as {
    open_items: string;
    due_today: string;
    overdue: string;
    total_projects: string;
    total_memories: string;
    total_contacts: string;
  };

  return {
    open_items: parseInt(row.open_items, 10),
    due_today: parseInt(row.due_today, 10),
    overdue: parseInt(row.overdue, 10),
    total_projects: parseInt(row.total_projects, 10),
    total_memories: parseInt(row.total_memories, 10),
    total_contacts: parseInt(row.total_contacts, 10),
  };
}

/**
 * Fetches the bootstrap context for an agent session.
 */
export async function getBootstrapContext(pool: Pool, options: BootstrapOptions = {}): Promise<BootstrapResponse> {
  const sections = getSectionsToFetch(options);
  const limits = {
    preferences: options.limit?.preferences ?? 10,
    projects: options.limit?.projects ?? 5,
    reminders: options.limit?.reminders ?? 10,
    activity: options.limit?.activity ?? 20,
    contacts: options.limit?.contacts ?? 10,
  };

  const user_email = options.user_email ?? '';
  const nsScope = options.queryNamespaces ?? ['default'];

  // Execute queries in parallel for performance
  const [user, preferences, active_projects, pending_reminders, recent_activity, unread_messages, key_contacts, stats] = await Promise.all([
    sections.has('user') && user_email ? fetchUser(pool, user_email) : Promise.resolve(null),
    sections.has('preferences') && user_email ? fetchPreferences(pool, user_email, limits.preferences, nsScope) : Promise.resolve([]),
    sections.has('projects') ? fetchActiveProjects(pool, limits.projects, nsScope) : Promise.resolve([]),
    sections.has('reminders') ? fetchPendingReminders(pool, limits.reminders, nsScope) : Promise.resolve([]),
    sections.has('activity') ? fetchRecentActivity(pool, limits.activity, nsScope) : Promise.resolve([]),
    sections.has('messages') ? fetchUnreadMessages(pool) : Promise.resolve(0),
    sections.has('contacts') ? fetchKeyContacts(pool, limits.contacts, nsScope) : Promise.resolve([]),
    sections.has('stats')
      ? fetchStats(pool)
      : Promise.resolve({
          open_items: 0,
          due_today: 0,
          overdue: 0,
          total_projects: 0,
          total_memories: 0,
          total_contacts: 0,
        }),
  ]);

  const generated_at = new Date();
  // Suggest refresh in 5 minutes
  const next_refresh_hint = new Date(generated_at.getTime() + 5 * 60 * 1000);

  return {
    user,
    preferences,
    active_projects,
    pending_reminders,
    recent_activity,
    unread_messages,
    key_contacts,
    stats,
    generated_at,
    next_refresh_hint,
  };
}
