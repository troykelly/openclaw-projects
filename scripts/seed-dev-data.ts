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

// ── Memory seed UUIDs (Issue #2461) ───────────────────────────────────

// Permanent memories (no TTL)
const MEM_PERM_1 = '10000000-0007-4000-a000-000000000001'; // preference
const MEM_PERM_2 = '10000000-0007-4000-a000-000000000002'; // fact
const MEM_PERM_3 = '10000000-0007-4000-a000-000000000003'; // decision
const MEM_PERM_4 = '10000000-0007-4000-a000-000000000004'; // context
const MEM_PERM_5 = '10000000-0007-4000-a000-000000000005'; // reference

// Ephemeral memories (future expiry)
const MEM_EPH_1H  = '10000000-0007-4000-a000-000000000010'; // 1h TTL
const MEM_EPH_6H  = '10000000-0007-4000-a000-000000000011'; // 6h TTL
const MEM_EPH_24H = '10000000-0007-4000-a000-000000000012'; // 24h TTL
const MEM_EPH_3D  = '10000000-0007-4000-a000-000000000013'; // 3d TTL
const MEM_EPH_7D  = '10000000-0007-4000-a000-000000000014'; // 7d TTL

// Expired memories (expires_at in past, is_active still true — for reaper testing)
const MEM_EXP_1 = '10000000-0007-4000-a000-000000000020';
const MEM_EXP_2 = '10000000-0007-4000-a000-000000000021';
const MEM_EXP_3 = '10000000-0007-4000-a000-000000000022';

// Supersession chain: A → B → C
const MEM_SUPER_A = '10000000-0007-4000-a000-000000000030'; // superseded by B
const MEM_SUPER_B = '10000000-0007-4000-a000-000000000031'; // superseded by C
const MEM_SUPER_C = '10000000-0007-4000-a000-000000000032'; // current (active)

// Sliding window memories
const MEM_SLIDE_MON = '10000000-0007-4000-a000-000000000040'; // day-memory:monday
const MEM_SLIDE_TUE = '10000000-0007-4000-a000-000000000041'; // day-memory:tuesday
const MEM_SLIDE_WK  = '10000000-0007-4000-a000-000000000042'; // week-memory:current

// Pinned memories
const MEM_PIN_1 = '10000000-0007-4000-a000-000000000050';
const MEM_PIN_2 = '10000000-0007-4000-a000-000000000051';

// Different namespace memories (namespace isolation)
const MEM_NS_1 = '10000000-0007-4000-a000-000000000060';
const MEM_NS_2 = '10000000-0007-4000-a000-000000000061';

// ── Helpers ────────────────────────────────────────────────────────────

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

function hoursFromNow(n: number): string {
  const d = new Date();
  d.setTime(d.getTime() + n * 60 * 60 * 1000);
  return d.toISOString();
}

async function insertMemory(
  id: string,
  namespace: string,
  title: string,
  content: string,
  opts: {
    memory_type?: string;
    importance?: number;
    confidence?: number;
    expires_at?: string | null;
    superseded_by?: string | null;
    is_active?: boolean;
    pinned?: boolean;
    tags?: string[];
    created_by_agent?: string | null;
  } = {},
) {
  await pool.query(
    `INSERT INTO memory (id, namespace, title, content, memory_type, importance, confidence, expires_at, superseded_by, is_active, pinned, tags, created_by_agent, embedding_status)
     VALUES ($1, $2, $3, $4, $5::memory_type, $6, $7, $8, $9, $10, $11, $12, $13, 'pending')
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      namespace,
      title,
      content,
      opts.memory_type ?? 'note',
      opts.importance ?? 5,
      opts.confidence ?? 1.0,
      opts.expires_at ?? null,
      opts.superseded_by ?? null,
      opts.is_active ?? true,
      opts.pinned ?? false,
      opts.tags ?? [],
      opts.created_by_agent ?? 'seed-script',
    ],
  );
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

  // ── Memory Lifecycle Seed Data (Issue #2461) ─────────────────────────

  // Alternate namespace for isolation tests
  const altNamespace = 'test-isolated';

  // Ensure namespace_grant for alt namespace
  await pool.query(
    `INSERT INTO namespace_grant (email, namespace, access, is_home)
     VALUES ($1, $2, 'readwrite', false)
     ON CONFLICT (email, namespace) DO NOTHING`,
    [email, altNamespace],
  );

  // ── 5 Permanent memories (no TTL, varied types and importance) ──────
  console.log('  Creating permanent memories...');

  await insertMemory(MEM_PERM_1, namespace, 'Notification preference', 'User prefers SMS over email for urgent notifications. Email is fine for weekly digests.', {
    memory_type: 'preference', importance: 8, confidence: 0.95, tags: ['notifications', 'sms', 'email'],
  });

  await insertMemory(MEM_PERM_2, namespace, 'Home address', 'User lives at 42 Wallaby Way, Sydney. Moved there in January 2025.', {
    memory_type: 'fact', importance: 7, confidence: 1.0, tags: ['address', 'personal'],
  });

  await insertMemory(MEM_PERM_3, namespace, 'Chose React over Vue', 'Decision to use React 19 with Next.js for the new dashboard. Vue was considered but team has more React experience.', {
    memory_type: 'decision', importance: 9, confidence: 0.9, tags: ['tech-stack', 'frontend'],
  });

  await insertMemory(MEM_PERM_4, namespace, 'Renovation budget context', 'Total renovation budget is $85,000. Plumbing allocated $15,000, electrical $12,000, painting $8,000.', {
    memory_type: 'context', importance: 6, confidence: 0.85, tags: ['renovation', 'budget'],
  });

  await insertMemory(MEM_PERM_5, namespace, 'API design guidelines doc', 'Team follows the OpenClaw API design guide at docs.openclaw.ai/api-design. All endpoints must use JSON:API format.', {
    memory_type: 'reference', importance: 4, confidence: 1.0, tags: ['api', 'documentation'],
  });

  // ── 5 Ephemeral memories with FUTURE expiry ─────────────────────────
  console.log('  Creating ephemeral memories (future TTL)...');

  await insertMemory(MEM_EPH_1H, namespace, 'Current meeting notes', 'Standup: discussed blocking issue with auth middleware. Need to follow up with Sarah.', {
    memory_type: 'context', importance: 3, confidence: 0.8, expires_at: hoursFromNow(1), tags: ['meeting', 'standup'],
  });

  await insertMemory(MEM_EPH_6H, namespace, 'Debugging session context', 'Investigating memory leak in WebSocket handler. Suspect connection pool not draining. Check poolConfig.max setting.', {
    memory_type: 'context', importance: 5, confidence: 0.7, expires_at: hoursFromNow(6), tags: ['debugging', 'websocket'],
  });

  await insertMemory(MEM_EPH_24H, namespace, 'Today focus items', 'Focus: finish PR review for #2450, update migration docs, respond to design feedback.', {
    memory_type: 'note', importance: 6, confidence: 0.9, expires_at: hoursFromNow(24), tags: ['daily', 'focus'],
  });

  await insertMemory(MEM_EPH_3D, namespace, 'Sprint goal reminder', 'Sprint goal: complete memory lifecycle MVP by Friday. Core endpoints + reaper + basic UI.', {
    memory_type: 'context', importance: 7, confidence: 0.85, expires_at: daysFromNow(3), tags: ['sprint', 'planning'],
  });

  await insertMemory(MEM_EPH_7D, namespace, 'Weekly experiment tracker', 'Testing new embedding model (text-embedding-3-large) for memory search quality. Compare against current model by end of week.', {
    memory_type: 'note', importance: 4, confidence: 0.6, expires_at: daysFromNow(7), tags: ['experiment', 'embeddings'],
  });

  // ── 3 Expired memories (expires_at in PAST, is_active=true → reaper test) ──
  console.log('  Creating expired memories (for reaper testing)...');

  await insertMemory(MEM_EXP_1, namespace, 'Yesterday meeting notes', 'Discussed deployment timeline with ops team. Agreed on Thursday release window.', {
    memory_type: 'context', importance: 3, confidence: 0.7, expires_at: hoursFromNow(-2), is_active: true, tags: ['meeting', 'expired-test'],
  });

  await insertMemory(MEM_EXP_2, namespace, 'Old debugging context', 'Was investigating CORS issue on staging. Turned out to be nginx config. Fixed in commit abc123.', {
    memory_type: 'context', importance: 2, confidence: 0.5, expires_at: daysFromNow(-1), is_active: true, tags: ['debugging', 'expired-test'],
  });

  await insertMemory(MEM_EXP_3, namespace, 'Stale cache investigation', 'Redis cache TTL was set to 5 min instead of 5 sec for session tokens. Already patched.', {
    memory_type: 'note', importance: 1, confidence: 0.4, expires_at: daysFromNow(-3), is_active: true, tags: ['debugging', 'redis', 'expired-test'],
  });

  // ── Supersession chain: A → B → C ──────────────────────────────────
  console.log('  Creating supersession chain...');

  // Insert C first (no superseded_by dependency)
  await insertMemory(MEM_SUPER_C, namespace, 'Project stack: React 19 + Next.js 15', 'Final decision: React 19 with Next.js 15 App Router. Server components for data fetching, client components for interactivity.', {
    memory_type: 'decision', importance: 9, confidence: 1.0, tags: ['tech-stack', 'supersession-chain'],
  });

  // Insert B (superseded by C)
  await insertMemory(MEM_SUPER_B, namespace, 'Project stack: React 19 + Vite', 'Updated decision: React 19 with Vite. Moved away from CRA. SSR not needed initially.', {
    memory_type: 'decision', importance: 9, confidence: 0.8, superseded_by: MEM_SUPER_C, is_active: false, tags: ['tech-stack', 'supersession-chain'],
  });

  // Insert A (superseded by B)
  await insertMemory(MEM_SUPER_A, namespace, 'Project stack: React 18 + CRA', 'Initial decision: React 18 with Create React App for quick bootstrapping.', {
    memory_type: 'decision', importance: 9, confidence: 0.6, superseded_by: MEM_SUPER_B, is_active: false, tags: ['tech-stack', 'supersession-chain'],
  });

  // ── Sliding window memories ─────────────────────────────────────────
  console.log('  Creating sliding window memories...');

  await insertMemory(MEM_SLIDE_MON, namespace, 'Monday daily summary', 'Completed: auth middleware refactor, started memory lifecycle migration. Blocked on CI for 2 hours (flaky test). Unblocked by pinning test DB version.', {
    memory_type: 'context', importance: 5, confidence: 0.9, tags: ['day-memory:monday', 'daily-summary'],
  });

  await insertMemory(MEM_SLIDE_TUE, namespace, 'Tuesday daily summary', 'Completed: memory reaper function, digest clustering endpoint. PR #2450 approved. Started seed data script for dev environment.', {
    memory_type: 'context', importance: 5, confidence: 0.9, pinned: true, tags: ['day-memory:tuesday', 'daily-summary'],
  });

  await insertMemory(MEM_SLIDE_WK, namespace, 'Week 11 summary', 'Sprint focus: memory lifecycle MVP. Completed foundation migration, reaper, digest, supersession. Remaining: seed data, docs, UI indicators.', {
    memory_type: 'context', importance: 7, confidence: 0.85, tags: ['week-memory:current', 'weekly-summary'],
  });

  // ── Pinned memories ─────────────────────────────────────────────────
  console.log('  Creating pinned memories...');

  await insertMemory(MEM_PIN_1, namespace, 'User timezone', 'User is in Australia/Sydney timezone (AEST/AEDT). All time-based reminders should use this timezone.', {
    memory_type: 'preference', importance: 10, confidence: 1.0, pinned: true, tags: ['timezone', 'critical-context'],
  });

  await insertMemory(MEM_PIN_2, namespace, 'Communication style', 'User prefers concise, direct responses. No emojis. Technical depth is appreciated. Prefers bullet points over paragraphs.', {
    memory_type: 'preference', importance: 10, confidence: 0.95, pinned: true, tags: ['communication', 'critical-context'],
  });

  // ── Different namespace memories (namespace isolation) ──────────────
  console.log('  Creating alternate namespace memories...');

  await insertMemory(MEM_NS_1, altNamespace, 'Isolated project config', 'This project uses a separate database and deployment pipeline. Do not cross-reference with default namespace.', {
    memory_type: 'context', importance: 6, confidence: 1.0, tags: ['config', 'isolation-test'],
  });

  await insertMemory(MEM_NS_2, altNamespace, 'Isolated user preference', 'In this namespace, the user prefers verbose logging and debug output enabled.', {
    memory_type: 'preference', importance: 5, confidence: 0.9, tags: ['preference', 'isolation-test'],
  });

  console.log('\nSeed data created successfully!');
  console.log(`  2 projects, 2 lists, 3 triage issues, 25 memories`);
  console.log(`  Namespace: ${namespace} (+ ${altNamespace} for isolation tests)`);

  await pool.end();
}

main().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
