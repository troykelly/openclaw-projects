/**
 * Seed development data for project management features.
 *
 * Creates:
 * - 2 projects with full hierarchy (Home Renovation, App Development)
 * - 2 lists with todos (Weekly Groceries, Packing List)
 * - 3 standalone triage issues
 * - Sample comments on 2 issues
 *
 * Idempotent: uses fixed UUIDs so re-running is safe (INSERT ... ON CONFLICT DO NOTHING).
 * All data is created in the 'default' namespace (shared dev dataset).
 *
 * Usage:
 *   node --experimental-transform-types scripts/seed-dev-data.ts [email]
 *
 * The optional email argument specifies the user to grant access to the
 * seeded data (defaults to test@example.com). Multiple users can be
 * granted access by running the script multiple times with different emails.
 */
import { Pool } from 'pg';
import { existsSync } from 'node:fs';

const defaultHost = existsSync('/.dockerenv') ? 'postgres' : 'localhost';
const pool = new Pool({
  host: process.env.PGHOST || defaultHost,
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'openclaw',
  password: process.env.PGPASSWORD || 'openclaw',
  database: process.env.PGDATABASE || 'openclaw',
});

// ── Fixed UUIDs for idempotency ────────────────────────────────────────

// Project 1: Home Renovation
const RENO_PROJECT    = '10000000-0001-4000-a000-000000000001';
const RENO_INIT_1     = '10000000-0001-4000-a000-000000000010';
const RENO_EPIC_PLUMB = '10000000-0001-4000-a000-000000000100';
const RENO_EPIC_ELEC  = '10000000-0001-4000-a000-000000000101';
const RENO_INIT_2     = '10000000-0001-4000-a000-000000000020';
const RENO_EPIC_PAINT = '10000000-0001-4000-a000-000000000200';
const RENO_ISS_QUOTE  = '10000000-0001-4000-a000-000000001001';
const RENO_ISS_SCHED  = '10000000-0001-4000-a000-000000001002';
const RENO_ISS_BUY    = '10000000-0001-4000-a000-000000001003';
const RENO_ISS_HIRE   = '10000000-0001-4000-a000-000000001004';
const RENO_ISS_PAINT  = '10000000-0001-4000-a000-000000001005';

// Project 2: App Development
const APP_PROJECT     = '10000000-0002-4000-a000-000000000001';
const APP_INIT_AUTH   = '10000000-0002-4000-a000-000000000010';
const APP_EPIC_OAUTH  = '10000000-0002-4000-a000-000000000100';
const APP_INIT_API    = '10000000-0002-4000-a000-000000000020';
const APP_EPIC_RATE   = '10000000-0002-4000-a000-000000000200';
const APP_ISS_GOOGLE  = '10000000-0002-4000-a000-000000001001';
const APP_ISS_GITHUB  = '10000000-0002-4000-a000-000000001002';
const APP_ISS_THROT   = '10000000-0002-4000-a000-000000001003';

// List 1: Weekly Groceries
const LIST_GROCERY    = '10000000-0003-4000-a000-000000000001';
const TODO_ASPARAGUS  = '10000000-0003-4000-a000-000000010001';
const TODO_MILK       = '10000000-0003-4000-a000-000000010002';
const TODO_BREAD      = '10000000-0003-4000-a000-000000010003';
const TODO_EGGS       = '10000000-0003-4000-a000-000000010004';
const TODO_CHICKEN    = '10000000-0003-4000-a000-000000010005';

// List 2: Packing List
const LIST_PACKING    = '10000000-0004-4000-a000-000000000001';
const TODO_PASSPORT   = '10000000-0004-4000-a000-000000010001';
const TODO_CHARGER    = '10000000-0004-4000-a000-000000010002';
const TODO_CLOTHES    = '10000000-0004-4000-a000-000000010003';
const TODO_TOILETRIES = '10000000-0004-4000-a000-000000010004';
const TODO_SNACKS     = '10000000-0004-4000-a000-000000010005';

// Standalone triage issues
const TRIAGE_DENTIST  = '10000000-0005-4000-a000-000000000001';
const TRIAGE_EMAIL    = '10000000-0005-4000-a000-000000000002';
const TRIAGE_TAP      = '10000000-0005-4000-a000-000000000003';

// Comments
const COMMENT_1       = '10000000-0006-4000-a000-000000000001';
const COMMENT_2       = '10000000-0006-4000-a000-000000000002';

// ── Helpers ────────────────────────────────────────────────────────────

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

async function insertWorkItem(
  id: string,
  title: string,
  kind: string,
  namespace: string,
  opts: {
    parent_id?: string | null;
    status?: string;
    priority?: string;
    description?: string | null;
    not_before?: string | null;
    not_after?: string | null;
    estimate_minutes?: number | null;
  } = {},
) {
  await pool.query(
    `INSERT INTO work_item (id, title, work_item_kind, namespace, parent_work_item_id, status, priority, description, not_before, not_after, estimate_minutes)
     VALUES ($1, $2, $3::work_item_kind, $4, $5, $6, $7::work_item_priority, $8, $9, $10, $11)
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      title,
      kind,
      namespace,
      opts.parent_id ?? null,
      opts.status ?? 'not_started',
      opts.priority ?? 'P2',
      opts.description ?? null,
      opts.not_before ?? null,
      opts.not_after ?? null,
      opts.estimate_minutes ?? null,
    ],
  );
}

async function insertTodo(
  id: string,
  workItemId: string,
  text: string,
  sortOrder: number,
  opts: {
    completed?: boolean;
    priority?: string;
    not_before?: string | null;
    not_after?: string | null;
  } = {},
) {
  const completed = opts.completed ?? false;
  // Table: work_item_todo. Namespace is auto-set by sync_todo_namespace trigger.
  await pool.query(
    `INSERT INTO work_item_todo (id, work_item_id, text, sort_order, completed, completed_at, priority, not_before, not_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7::work_item_priority, $8, $9)
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      workItemId,
      text,
      sortOrder,
      completed,
      completed ? new Date().toISOString() : null,
      opts.priority ?? 'P2',
      opts.not_before ?? null,
      opts.not_after ?? null,
    ],
  );
}

async function insertComment(
  id: string,
  workItemId: string,
  content: string,
  userEmail: string,
) {
  await pool.query(
    `INSERT INTO work_item_comment (id, work_item_id, content, user_email)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [id, workItemId, content, userEmail],
  );
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const email = process.argv[2] || 'test@example.com';

  // Use 'default' namespace (same as test helpers)
  const namespace = 'default';

  console.log(`Seeding development data for ${email} in namespace: ${namespace}`);

  // Ensure user_setting and namespace_grant exist
  await pool.query(
    `INSERT INTO user_setting (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email`,
    [email],
  );
  await pool.query(
    `INSERT INTO namespace_grant (email, namespace, access, is_home)
     VALUES ($1, $2, 'readwrite', true)
     ON CONFLICT (email, namespace) DO NOTHING`,
    [email, namespace],
  );

  // ── Project 1: Home Renovation ──────────────────────────────────────
  console.log('  Creating Home Renovation project...');
  await insertWorkItem(RENO_PROJECT, 'Home Renovation', 'project', namespace, {
    description: 'Complete home renovation project with plumbing, electrical, and interior work.',
  });

  await insertWorkItem(RENO_INIT_1, 'Phase 1 - Foundation', 'initiative', namespace, {
    parent_id: RENO_PROJECT,
  });

  await insertWorkItem(RENO_EPIC_PLUMB, 'Plumbing', 'epic', namespace, {
    parent_id: RENO_INIT_1,
  });

  await insertWorkItem(RENO_ISS_QUOTE, 'Get plumber quote', 'issue', namespace, {
    parent_id: RENO_EPIC_PLUMB,
    status: 'not_started',
    priority: 'P2',
    not_after: daysFromNow(7),
  });

  await insertWorkItem(RENO_ISS_SCHED, 'Schedule plumber visit', 'issue', namespace, {
    parent_id: RENO_EPIC_PLUMB,
    status: 'not_started',
    priority: 'P1',
  });

  await insertWorkItem(RENO_ISS_BUY, 'Buy plumbing supplies', 'issue', namespace, {
    parent_id: RENO_EPIC_PLUMB,
    status: 'done',
    priority: 'P2',
  });

  await insertWorkItem(RENO_EPIC_ELEC, 'Electrical', 'epic', namespace, {
    parent_id: RENO_INIT_1,
  });

  await insertWorkItem(RENO_ISS_HIRE, 'Hire electrician', 'issue', namespace, {
    parent_id: RENO_EPIC_ELEC,
    status: 'not_started',
    priority: 'P2',
  });

  await insertWorkItem(RENO_INIT_2, 'Phase 2 - Interior', 'initiative', namespace, {
    parent_id: RENO_PROJECT,
  });

  await insertWorkItem(RENO_EPIC_PAINT, 'Painting', 'epic', namespace, {
    parent_id: RENO_INIT_2,
  });

  await insertWorkItem(RENO_ISS_PAINT, 'Choose paint colours', 'issue', namespace, {
    parent_id: RENO_EPIC_PAINT,
    status: 'in_progress',
    priority: 'P3',
  });

  // ── Project 2: App Development ──────────────────────────────────────
  console.log('  Creating App Development project...');
  await insertWorkItem(APP_PROJECT, 'App Development', 'project', namespace, {
    description: 'Build a new web application with authentication and API features.',
  });

  await insertWorkItem(APP_INIT_AUTH, 'Authentication', 'initiative', namespace, {
    parent_id: APP_PROJECT,
  });

  await insertWorkItem(APP_EPIC_OAUTH, 'OAuth Integration', 'epic', namespace, {
    parent_id: APP_INIT_AUTH,
  });

  await insertWorkItem(APP_ISS_GOOGLE, 'Add Google login', 'issue', namespace, {
    parent_id: APP_EPIC_OAUTH,
    status: 'not_started',
    priority: 'P1',
    estimate_minutes: 480,
  });

  await insertWorkItem(APP_ISS_GITHUB, 'Add GitHub login', 'issue', namespace, {
    parent_id: APP_EPIC_OAUTH,
    status: 'not_started',
    priority: 'P2',
    estimate_minutes: 240,
  });

  await insertWorkItem(APP_INIT_API, 'API', 'initiative', namespace, {
    parent_id: APP_PROJECT,
  });

  await insertWorkItem(APP_EPIC_RATE, 'Rate Limiting', 'epic', namespace, {
    parent_id: APP_INIT_API,
  });

  await insertWorkItem(APP_ISS_THROT, 'Implement throttle', 'issue', namespace, {
    parent_id: APP_EPIC_RATE,
    status: 'not_started',
    priority: 'P1',
    estimate_minutes: 120,
  });

  // ── List 1: Weekly Groceries ────────────────────────────────────────
  console.log('  Creating Weekly Groceries list...');
  await insertWorkItem(LIST_GROCERY, 'Weekly Groceries', 'list', namespace, {
    description: 'Weekly shopping list',
  });

  await insertTodo(TODO_ASPARAGUS, LIST_GROCERY, 'Asparagus', 100, { priority: 'P2' });
  await insertTodo(TODO_MILK, LIST_GROCERY, 'Milk', 200, { priority: 'P2' });
  await insertTodo(TODO_BREAD, LIST_GROCERY, 'Bread', 300, { completed: true });
  await insertTodo(TODO_EGGS, LIST_GROCERY, 'Eggs', 400, { completed: true });
  await insertTodo(TODO_CHICKEN, LIST_GROCERY, 'Chicken', 500, { priority: 'P2' });

  // ── List 2: Packing List - Trip ─────────────────────────────────────
  console.log('  Creating Packing List...');
  await insertWorkItem(LIST_PACKING, 'Packing List - Trip', 'list', namespace, {
    description: 'Travel packing checklist',
  });

  await insertTodo(TODO_PASSPORT, LIST_PACKING, 'Passport', 100, { priority: 'P0' });
  await insertTodo(TODO_CHARGER, LIST_PACKING, 'Charger', 200, { priority: 'P2' });
  await insertTodo(TODO_CLOTHES, LIST_PACKING, 'Clothes', 300, { priority: 'P1' });
  await insertTodo(TODO_TOILETRIES, LIST_PACKING, 'Toiletries', 400, { completed: true });
  await insertTodo(TODO_SNACKS, LIST_PACKING, 'Snacks', 500, { priority: 'P3' });

  // ── Standalone triage issues ────────────────────────────────────────
  console.log('  Creating triage issues...');
  await insertWorkItem(TRIAGE_DENTIST, 'Call dentist', 'issue', namespace, {
    priority: 'P2',
    not_before: daysFromNow(1),
  });

  await insertWorkItem(TRIAGE_EMAIL, "Reply to Sarah's email", 'issue', namespace, {
    priority: 'P1',
  });

  await insertWorkItem(TRIAGE_TAP, 'Fix kitchen tap', 'issue', namespace, {
    priority: 'P3',
  });

  // ── Sample comments ─────────────────────────────────────────────────
  console.log('  Adding sample comments...');
  await insertComment(
    COMMENT_1,
    RENO_ISS_QUOTE,
    'Called three plumbers today. Best quote is from Smith & Co at $4,500.',
    email,
  );

  await insertComment(
    COMMENT_2,
    APP_ISS_GOOGLE,
    'Need to register the app in Google Cloud Console first. See https://console.cloud.google.com/',
    email,
  );

  console.log('\nSeed data created successfully!');
  console.log(`  2 projects, 2 lists, 3 triage issues`);
  console.log(`  Namespace: ${namespace}`);

  await pool.end();
}

main().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
