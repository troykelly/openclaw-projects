/**
 * Memory lifecycle seed data — shared logic for seed-dev-data.ts and tests.
 * Issue #2461 (Epic #2426).
 *
 * Exports a seedMemories() function that inserts 23 diverse memory entries
 * covering all lifecycle scenarios. Designed to be called by both:
 * - scripts/seed-dev-data.ts (dev database seeding)
 * - tests/seed_dev_memory.test.ts (integration testing)
 */
import type { Pool } from 'pg';

// ── Fixed UUIDs for idempotency ────────────────────────────────────────

// Permanent memories (no TTL)
const MEM_PERM_1 = '10000000-0007-4000-a000-000000000001';
const MEM_PERM_2 = '10000000-0007-4000-a000-000000000002';
const MEM_PERM_3 = '10000000-0007-4000-a000-000000000003';
const MEM_PERM_4 = '10000000-0007-4000-a000-000000000004';
const MEM_PERM_5 = '10000000-0007-4000-a000-000000000005';

// Ephemeral memories (future expiry)
const MEM_EPH_1H  = '10000000-0007-4000-a000-000000000010';
const MEM_EPH_6H  = '10000000-0007-4000-a000-000000000011';
const MEM_EPH_24H = '10000000-0007-4000-a000-000000000012';
const MEM_EPH_3D  = '10000000-0007-4000-a000-000000000013';
const MEM_EPH_7D  = '10000000-0007-4000-a000-000000000014';

// Expired memories (for reaper testing)
const MEM_EXP_1 = '10000000-0007-4000-a000-000000000020';
const MEM_EXP_2 = '10000000-0007-4000-a000-000000000021';
const MEM_EXP_3 = '10000000-0007-4000-a000-000000000022';

// Supersession chain: A → B → C
const MEM_SUPER_A = '10000000-0007-4000-a000-000000000030';
const MEM_SUPER_B = '10000000-0007-4000-a000-000000000031';
const MEM_SUPER_C = '10000000-0007-4000-a000-000000000032';

// Sliding window memories
const MEM_SLIDE_MON = '10000000-0007-4000-a000-000000000040';
const MEM_SLIDE_TUE = '10000000-0007-4000-a000-000000000041';
const MEM_SLIDE_WK  = '10000000-0007-4000-a000-000000000042';

// Pinned memories
const MEM_PIN_1 = '10000000-0007-4000-a000-000000000050';
const MEM_PIN_2 = '10000000-0007-4000-a000-000000000051';

// Different namespace memories
const MEM_NS_1 = '10000000-0007-4000-a000-000000000060';
const MEM_NS_2 = '10000000-0007-4000-a000-000000000061';

/** Number of memory entries this module seeds */
export const SEED_MEMORY_COUNT = 23;

/** Agent label used by all seed memories for querying */
export const SEED_AGENT_LABEL = 'seed-script';

/** Alternate namespace used for isolation tests */
export const ALT_NAMESPACE = 'test-isolated';

// ── Helpers ────────────────────────────────────────────────────────────

function hoursFromNow(n: number): string {
  const d = new Date();
  d.setTime(d.getTime() + n * 60 * 60 * 1000);
  return d.toISOString();
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

async function insertMemory(
  pool: Pool,
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
  } = {},
): Promise<void> {
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
      SEED_AGENT_LABEL,
    ],
  );
}

/**
 * Seed all memory lifecycle entries into the database.
 *
 * @param pool - PostgreSQL connection pool
 * @param namespace - Primary namespace (default: 'default')
 */
export async function seedMemories(pool: Pool, namespace: string = 'default'): Promise<void> {
  // ── 5 Permanent memories (no TTL, varied types and importance) ──────
  console.log('  Creating permanent memories...');

  await insertMemory(pool, MEM_PERM_1, namespace, 'Notification preference', 'User prefers SMS over email for urgent notifications. Email is fine for weekly digests.', {
    memory_type: 'preference', importance: 8, confidence: 0.95, tags: ['notifications', 'sms', 'email'],
  });

  await insertMemory(pool, MEM_PERM_2, namespace, 'Home address', 'User lives at 42 Wallaby Way, Sydney. Moved there in January 2025.', {
    memory_type: 'fact', importance: 7, confidence: 1.0, tags: ['address', 'personal'],
  });

  await insertMemory(pool, MEM_PERM_3, namespace, 'Chose React over Vue', 'Decision to use React 19 with Next.js for the new dashboard. Vue was considered but team has more React experience.', {
    memory_type: 'decision', importance: 9, confidence: 0.9, tags: ['tech-stack', 'frontend'],
  });

  await insertMemory(pool, MEM_PERM_4, namespace, 'Renovation budget context', 'Total renovation budget is $85,000. Plumbing allocated $15,000, electrical $12,000, painting $8,000.', {
    memory_type: 'context', importance: 6, confidence: 0.85, tags: ['renovation', 'budget'],
  });

  await insertMemory(pool, MEM_PERM_5, namespace, 'API design guidelines doc', 'Team follows the OpenClaw API design guide at docs.openclaw.ai/api-design. All endpoints must use JSON:API format.', {
    memory_type: 'reference', importance: 4, confidence: 1.0, tags: ['api', 'documentation'],
  });

  // ── 5 Ephemeral memories with FUTURE expiry ─────────────────────────
  console.log('  Creating ephemeral memories (future TTL)...');

  await insertMemory(pool, MEM_EPH_1H, namespace, 'Current meeting notes', 'Standup: discussed blocking issue with auth middleware. Need to follow up with Sarah.', {
    memory_type: 'context', importance: 3, confidence: 0.8, expires_at: hoursFromNow(1), tags: ['meeting', 'standup'],
  });

  await insertMemory(pool, MEM_EPH_6H, namespace, 'Debugging session context', 'Investigating memory leak in WebSocket handler. Suspect connection pool not draining. Check poolConfig.max setting.', {
    memory_type: 'context', importance: 5, confidence: 0.7, expires_at: hoursFromNow(6), tags: ['debugging', 'websocket'],
  });

  await insertMemory(pool, MEM_EPH_24H, namespace, 'Today focus items', 'Focus: finish PR review for #2450, update migration docs, respond to design feedback.', {
    memory_type: 'note', importance: 6, confidence: 0.9, expires_at: hoursFromNow(24), tags: ['daily', 'focus'],
  });

  await insertMemory(pool, MEM_EPH_3D, namespace, 'Sprint goal reminder', 'Sprint goal: complete memory lifecycle MVP by Friday. Core endpoints + reaper + basic UI.', {
    memory_type: 'context', importance: 7, confidence: 0.85, expires_at: daysFromNow(3), tags: ['sprint', 'planning'],
  });

  await insertMemory(pool, MEM_EPH_7D, namespace, 'Weekly experiment tracker', 'Testing new embedding model (text-embedding-3-large) for memory search quality. Compare against current model by end of week.', {
    memory_type: 'note', importance: 4, confidence: 0.6, expires_at: daysFromNow(7), tags: ['experiment', 'embeddings'],
  });

  // ── 3 Expired memories (expires_at in PAST, is_active=true → reaper test) ──
  console.log('  Creating expired memories (for reaper testing)...');

  await insertMemory(pool, MEM_EXP_1, namespace, 'Yesterday meeting notes', 'Discussed deployment timeline with ops team. Agreed on Thursday release window.', {
    memory_type: 'context', importance: 3, confidence: 0.7, expires_at: hoursFromNow(-2), is_active: true, tags: ['meeting', 'expired-test'],
  });

  await insertMemory(pool, MEM_EXP_2, namespace, 'Old debugging context', 'Was investigating CORS issue on staging. Turned out to be nginx config. Fixed in commit abc123.', {
    memory_type: 'context', importance: 2, confidence: 0.5, expires_at: daysFromNow(-1), is_active: true, tags: ['debugging', 'expired-test'],
  });

  await insertMemory(pool, MEM_EXP_3, namespace, 'Stale cache investigation', 'Redis cache TTL was set to 5 min instead of 5 sec for session tokens. Already patched.', {
    memory_type: 'note', importance: 1, confidence: 0.4, expires_at: daysFromNow(-3), is_active: true, tags: ['debugging', 'redis', 'expired-test'],
  });

  // ── Supersession chain: A → B → C ──────────────────────────────────
  console.log('  Creating supersession chain...');

  await insertMemory(pool, MEM_SUPER_C, namespace, 'Project stack: React 19 + Next.js 15', 'Final decision: React 19 with Next.js 15 App Router. Server components for data fetching, client components for interactivity.', {
    memory_type: 'decision', importance: 9, confidence: 1.0, tags: ['tech-stack', 'supersession-chain'],
  });

  await insertMemory(pool, MEM_SUPER_B, namespace, 'Project stack: React 19 + Vite', 'Updated decision: React 19 with Vite. Moved away from CRA. SSR not needed initially.', {
    memory_type: 'decision', importance: 9, confidence: 0.8, superseded_by: MEM_SUPER_C, is_active: false, tags: ['tech-stack', 'supersession-chain'],
  });

  await insertMemory(pool, MEM_SUPER_A, namespace, 'Project stack: React 18 + CRA', 'Initial decision: React 18 with Create React App for quick bootstrapping.', {
    memory_type: 'decision', importance: 9, confidence: 0.6, superseded_by: MEM_SUPER_B, is_active: false, tags: ['tech-stack', 'supersession-chain'],
  });

  // ── Sliding window memories ─────────────────────────────────────────
  console.log('  Creating sliding window memories...');

  await insertMemory(pool, MEM_SLIDE_MON, namespace, 'Monday daily summary', 'Completed: auth middleware refactor, started memory lifecycle migration. Blocked on CI for 2 hours (flaky test). Unblocked by pinning test DB version.', {
    memory_type: 'context', importance: 5, confidence: 0.9, tags: ['day-memory:monday', 'daily-summary'],
  });

  await insertMemory(pool, MEM_SLIDE_TUE, namespace, 'Tuesday daily summary', 'Completed: memory reaper function, digest clustering endpoint. PR #2450 approved. Started seed data script for dev environment.', {
    memory_type: 'context', importance: 5, confidence: 0.9, pinned: true, tags: ['day-memory:tuesday', 'daily-summary'],
  });

  await insertMemory(pool, MEM_SLIDE_WK, namespace, 'Week 11 summary', 'Sprint focus: memory lifecycle MVP. Completed foundation migration, reaper, digest, supersession. Remaining: seed data, docs, UI indicators.', {
    memory_type: 'context', importance: 7, confidence: 0.85, tags: ['week-memory:current', 'weekly-summary'],
  });

  // ── Pinned memories ─────────────────────────────────────────────────
  console.log('  Creating pinned memories...');

  await insertMemory(pool, MEM_PIN_1, namespace, 'User timezone', 'User is in Australia/Sydney timezone (AEST/AEDT). All time-based reminders should use this timezone.', {
    memory_type: 'preference', importance: 10, confidence: 1.0, pinned: true, tags: ['timezone', 'critical-context'],
  });

  await insertMemory(pool, MEM_PIN_2, namespace, 'Communication style', 'User prefers concise, direct responses. No emojis. Technical depth is appreciated. Prefers bullet points over paragraphs.', {
    memory_type: 'preference', importance: 10, confidence: 0.95, pinned: true, tags: ['communication', 'critical-context'],
  });

  // ── Different namespace memories (namespace isolation) ──────────────
  console.log('  Creating alternate namespace memories...');

  await insertMemory(pool, MEM_NS_1, ALT_NAMESPACE, 'Isolated project config', 'This project uses a separate database and deployment pipeline. Do not cross-reference with default namespace.', {
    memory_type: 'context', importance: 6, confidence: 1.0, tags: ['config', 'isolation-test'],
  });

  await insertMemory(pool, MEM_NS_2, ALT_NAMESPACE, 'Isolated user preference', 'In this namespace, the user prefers verbose logging and debug output enabled.', {
    memory_type: 'preference', importance: 5, confidence: 0.9, tags: ['preference', 'isolation-test'],
  });
}
