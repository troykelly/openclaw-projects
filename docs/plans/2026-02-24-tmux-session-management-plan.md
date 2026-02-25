# TMux Session Management — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a new tmux-worker service with gRPC bridge, REST API, plugin tools, and web UI for managing terminal sessions over SSH and locally, with pgvector-embedded session history.

**Architecture:** Separate gRPC-native container (`tmux-worker`) with DB access for credential resolution and entry recording. API server proxies REST/WebSocket to worker. Existing background worker handles embedding. All entities namespace-scoped.

**Tech Stack:** TypeScript, Fastify, @grpc/grpc-js, @grpc/proto-loader, ssh2, node-pty, xterm.js, pgvector, React 19, shadcn/ui, Tailwind v4

**Epic:** #1667 — TMux Session Management
**Design Doc:** `docs/plans/2026-02-24-tmux-session-management-design.md`

---

## Phase 1: Foundation

### Task 1: Database Migrations (#1668)

**Files:**
- Create: `migrations/229_terminal_tables.up.sql`
- Create: `migrations/229_terminal_tables.down.sql`

**Step 1: Write the up migration**

Create all 10 tables in dependency order: terminal_credential → terminal_connection → terminal_known_host → terminal_session → terminal_session_window → terminal_session_pane → terminal_session_entry → terminal_tunnel → terminal_enrollment_token → terminal_activity.

See #1668 for full SQL. Key points:
- All tables have `namespace text NOT NULL`
- All tables use `uuid PK DEFAULT gen_random_uuid()`
- `terminal_session_entry.embedding` uses `vector(1536)` for pgvector
- IVFFlat index on embedding column
- GIN indexes on tags arrays
- CHECK constraints on enum-like columns
- CASCADE DELETE on child tables

**Step 2: Write the down migration**

Drop all tables in reverse dependency order.

**Step 3: Run migration locally**

Run: `pnpm migrate:up`
Expected: All tables created, no errors.

**Step 4: Verify migration reversal**

Run: `pnpm migrate:down` then `pnpm migrate:up`
Expected: Clean reversal and re-application.

**Step 5: Write integration test**

Create `tests/integration/terminal/migrations.test.ts`:
- Verify all tables exist after migration
- Verify column types match schema
- Verify indexes exist
- Verify constraints work (insert invalid enum values → fails)

**Step 6: Run test**

Run: `pnpm exec vitest run tests/integration/terminal/migrations.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add migrations/229_terminal_tables.up.sql migrations/229_terminal_tables.down.sql tests/integration/terminal/
git commit -m "[#1668] Add database migrations for terminal_* tables"
```

---

### Task 2: Protobuf Definitions (#1669)

**Files:**
- Create: `proto/terminal/v1/terminal.proto`
- Create: `buf.gen.yaml` (or equivalent config)
- Modify: `package.json` (add proto:build script)
- Generated: `src/generated/proto/terminal/v1/`

**Step 1: Set up protobuf toolchain**

Add dependencies:
```bash
pnpm add -D @grpc/proto-loader
pnpm add @grpc/grpc-js
```

**Step 2: Write terminal.proto**

Full service and message definitions per the design doc. Include all RPCs:
- TestConnection, CreateSession, TerminateSession, ListSessions, GetSession, ResizeSession
- CreateWindow, CloseWindow, SplitPane, ClosePane
- AttachSession (bidirectional stream)
- SendCommand, SendKeys, CapturePane
- CreateTunnel, CloseTunnel, ListTunnels
- GetEnrollmentListener (server stream)
- ApproveHostKey, RejectHostKey
- GetWorkerStatus

**Step 3: Configure proto loading**

Using `@grpc/proto-loader` for dynamic loading (avoids code generation step):
```typescript
// src/shared/grpc-types.ts
import * as protoLoader from '@grpc/proto-loader';
import * as grpc from '@grpc/grpc-js';

const packageDefinition = protoLoader.loadSync('proto/terminal/v1/terminal.proto', {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
export const terminalProto = grpc.loadPackageDefinition(packageDefinition);
```

**Step 4: Write TypeScript type definitions**

Create `src/shared/terminal-types.ts` with handwritten types matching proto messages. These provide type safety without code generation.

**Step 5: Verify proto loads**

Run: `node -e "require('./src/shared/grpc-types')"` (or equivalent ts check)
Expected: No errors

**Step 6: Commit**

```bash
git add proto/ src/shared/grpc-types.ts src/shared/terminal-types.ts package.json pnpm-lock.yaml
git commit -m "[#1669] Add protobuf definitions and gRPC type setup"
```

---

### Task 3: TMux Worker Container (#1670)

**Files:**
- Create: `Dockerfile.tmux-worker`
- Create: `src/tmux-worker/run.ts`
- Create: `src/tmux-worker/grpc-server.ts`
- Create: `src/tmux-worker/config.ts`
- Create: `src/tmux-worker/db.ts`
- Create: `src/tmux-worker/health.ts`
- Modify: `docker-compose.yml` (add tmux-worker service)
- Modify: `docker-compose.quickstart.yml` (add tmux-worker)
- Modify: `package.json` (add tmux-worker scripts)
- Modify: `tsconfig.build.json` (add tmux-worker paths)

**Step 1: Write Dockerfile.tmux-worker**

Node 22 slim + tmux + openssh-client + openssh-server. Build context copies dist/tmux-worker/.

**Step 2: Write worker config module**

`src/tmux-worker/config.ts` — loads env vars: DATABASE_URL, GRPC_PORT, ENROLLMENT_SSH_PORT, OAUTH_TOKEN_ENCRYPTION_KEY, WORKER_ID.

**Step 3: Write DB connection module**

`src/tmux-worker/db.ts` — pg Pool setup (same pattern as API server).

**Step 4: Write gRPC server**

`src/tmux-worker/grpc-server.ts`:
- Load proto definition
- Register GetWorkerStatus handler (returns worker_id, uptime, active_sessions=0)
- All other RPCs return UNIMPLEMENTED
- Start server on GRPC_PORT

**Step 5: Write entry point**

`src/tmux-worker/run.ts`:
- Load config
- Connect to DB
- Start gRPC server
- Log startup info
- Handle SIGTERM/SIGINT for graceful shutdown

**Step 6: Add build scripts to package.json**

```json
"tmux-worker:build": "tsc -p tsconfig.tmux-worker.json",
"tmux-worker:dev": "tsx watch src/tmux-worker/run.ts"
```

**Step 7: Add to docker-compose**

Add tmux-worker service per design doc. Depends on db + migrate.

**Step 8: Build and test**

```bash
pnpm run tmux-worker:build
docker compose build tmux-worker
docker compose up tmux-worker -d
# Verify gRPC health
```

**Step 9: Write integration test**

`tests/integration/terminal/worker-health.test.ts`:
- Connect gRPC client to worker
- Call GetWorkerStatus
- Verify response has worker_id and uptime

**Step 10: Commit**

```bash
git add Dockerfile.tmux-worker src/tmux-worker/ docker-compose*.yml package.json tsconfig.tmux-worker.json
git commit -m "[#1670] Add tmux-worker container with basic gRPC server"
```

---

### Task 4: Credential Encryption Module (#1671)

**Files:**
- Create: `src/tmux-worker/credentials/index.ts`
- Create: `src/tmux-worker/credentials/envelope.ts`
- Create: `src/tmux-worker/credentials/command-provider.ts`
- Create: `src/tmux-worker/credentials/types.ts`
- Test: `tests/unit/terminal/credential-encryption.test.ts`
- Test: `tests/integration/terminal/credential-resolution.test.ts`

**Step 1: Write failing unit tests**

```typescript
describe('envelope encryption', () => {
  it('encrypts and decrypts a private key', () => { ... });
  it('rejects wrong master key', () => { ... });
  it('produces different ciphertext for same input (random IV)', () => { ... });
});

describe('command provider', () => {
  it('executes command and returns stdout', () => { ... });
  it('throws on timeout', () => { ... });
  it('caches result for cache_ttl_s', () => { ... });
});
```

**Step 2: Run tests to verify failure**

Run: `pnpm exec vitest run tests/unit/terminal/credential-encryption.test.ts`
Expected: FAIL

**Step 3: Implement envelope encryption**

AES-256-GCM with random 12-byte IV. Format: iv(12) + tag(16) + ciphertext.

**Step 4: Implement command provider**

Child process execution with timeout. Cache with TTL.

**Step 5: Implement resolveCredential**

Fetches from DB, decrypts or executes command, returns credential.

**Step 6: Run unit tests**

Expected: PASS

**Step 7: Write integration test**

Store encrypted credential in DB, resolve via resolveCredential.

**Step 8: Run integration test**

Expected: PASS

**Step 9: Commit**

```bash
git add src/tmux-worker/credentials/ tests/unit/terminal/ tests/integration/terminal/
git commit -m "[#1671] Add credential encryption/decryption module"
```

---

## Phase 2: Core Session Management

### Task 5: Connection CRUD (#1672)

**Files:**
- Modify: `src/api/server.ts` (add connection routes)
- Create: `src/api/terminal/ssh-config-parser.ts`
- Test: `tests/unit/terminal/ssh-config-parser.test.ts`
- Test: `tests/integration/terminal/connections.test.ts`

Implement all 7 connection endpoints. See #1672 for full spec.

Key steps:
1. Write integration tests for CRUD lifecycle
2. Write unit tests for SSH config parser
3. Implement routes in server.ts with namespace scoping
4. Implement SSH config parser
5. Test connection proxies to worker gRPC
6. Run all tests
7. Commit: `[#1672] Add connection CRUD API endpoints`

---

### Task 6: Credential CRUD (#1673)

**Files:**
- Modify: `src/api/server.ts` (add credential routes)
- Test: `tests/integration/terminal/credentials.test.ts`

Implement all 6 credential endpoints. See #1673 for full spec.

Key steps:
1. Write integration tests
2. Implement routes (never expose encrypted_value in responses)
3. Key generation using crypto.generateKeyPairSync
4. Run tests
5. Commit: `[#1673] Add credential CRUD API endpoints`

---

### Task 7: Session Lifecycle (#1674)

**Files:**
- Modify: `src/tmux-worker/services/session.ts` (gRPC implementations)
- Modify: `src/api/server.ts` (add session routes)
- Create: `src/tmux-worker/ssh/client.ts` (SSH connection logic)
- Test: `tests/integration/terminal/sessions.test.ts`
- Test: `tests/e2e/terminal/session-lifecycle.test.ts`

Key steps:
1. Implement SSH client module (connect, proxy jump, host key callback)
2. Implement gRPC session handlers (CreateSession, TerminateSession, etc.)
3. Implement API routes
4. Write integration tests (mock worker for API tests)
5. Write E2E test (local tmux session: create → verify → terminate)
6. Commit: `[#1674] Add session lifecycle management`

---

### Task 8: Terminal I/O Streaming (#1675)

**Files:**
- Modify: `src/tmux-worker/services/session.ts` (AttachSession stream)
- Modify: `src/api/server.ts` (WebSocket endpoint)
- Create: `src/api/terminal/websocket-bridge.ts`
- Test: `tests/integration/terminal/terminal-io.test.ts`
- Test: `tests/e2e/terminal/terminal-streaming.test.ts`

Key steps:
1. Implement AttachSession bidirectional gRPC stream on worker
2. Implement WebSocket endpoint on API server
3. Build WebSocket ↔ gRPC bridge
4. Handle binary (terminal data) and JSON (control) messages
5. Implement reconnection protocol
6. Write tests
7. Commit: `[#1675] Add terminal I/O streaming via WebSocket-gRPC bridge`

---

### Task 9: Command Execution (#1676)

**Files:**
- Modify: `src/tmux-worker/services/session.ts` (SendCommand, SendKeys, CapturePane)
- Modify: `src/api/server.ts` (command routes)
- Create: `src/tmux-worker/tmux/command-runner.ts` (marker technique)
- Test: `tests/unit/terminal/command-runner.test.ts`
- Test: `tests/integration/terminal/commands.test.ts`

Key steps:
1. Implement marker-based command execution
2. Implement send-keys and capture-pane
3. Add API routes
4. Write tests (including timeout scenarios)
5. Commit: `[#1676] Add command execution with marker-based completion detection`

---

## Phase 3: Advanced Features

### Task 10: Window/Pane Management (#1677)

See #1677 for full spec. Implement window/pane CRUD + periodic state sync.

Commit: `[#1677] Add window and pane management`

### Task 11: SSH Tunnels (#1678)

See #1678 for full spec. Implement tunnel CRUD + health monitoring.

Commit: `[#1678] Add SSH tunnel management`

### Task 12: Known Host Verification (#1679)

See #1679 for full spec. Implement strict/TOFU/skip + pending verification flow.

Commit: `[#1679] Add known host verification with TOFU support`

### Task 13: Entry Recording (#1680)

See #1680 for full spec. Implement batched recording, scrollback capture, embedding pipeline integration.

Commit: `[#1680] Add entry recording and embedding pipeline`

### Task 14: Semantic Search (#1681)

See #1681 for full spec. Implement pgvector search with filters + entry listing + export.

Commit: `[#1681] Add semantic search across session entries`

### Task 15: Session Recovery (#1682)

See #1682 for full spec. Implement worker startup recovery + graceful shutdown.

Commit: `[#1682] Add session recovery after worker restart`

---

## Phase 4: Enrollment & Security

### Task 16: Enrollment Tokens (#1683)

See #1683. Token creation (hash at rest, show once), enrollment endpoint, validation.

Commit: `[#1683] Add enrollment token system`

### Task 17: SSH Enrollment Server (#1684)

See #1684. Lightweight SSH server on worker for reverse tunnel registration.

Commit: `[#1684] Add SSH enrollment server for reverse tunnels`

### Task 18: mTLS (#1685)

See #1685. Certificate generation, gRPC mTLS setup, fallback for dev.

Commit: `[#1685] Add mTLS between API server and tmux worker`

### Task 19: Audit Trail (#1686)

See #1686. Activity recording on all operations + API endpoint.

Commit: `[#1686] Add terminal activity audit trail`

### Task 20: Retention Policies (#1687)

See #1687. pgcron cleanup job + namespace-level settings.

Commit: `[#1687] Add entry retention policies`

---

## Phase 5: OpenClaw Plugin

### Task 21: Plugin Connection/Credential Tools (#1688)

See #1688. 8 tools for connection and credential management.

Commit: `[#1688] Add plugin tools for connection and credential management`

### Task 22: Plugin Session/Command Tools (#1689)

See #1689. 7 tools for session management and command execution.

Commit: `[#1689] Add plugin tools for session management and commands`

### Task 23: Plugin Search/Tunnel Tools (#1690)

See #1690. 5 tools for search, annotations, and tunnels.

Commit: `[#1690] Add plugin tools for search, annotations, and tunnels`

---

## Phase 6: Web UI

### Task 24: Terminal Dashboard (#1691)

See #1691. Dashboard page, sidebar navigation, stats, quick-connect, empty states.

Commit: `[#1691] Add terminal dashboard page and sidebar navigation`

### Task 25: Connections Page (#1692)

See #1692. Connection list, form, test, SSH config import, proxy chain diagram.

Commit: `[#1692] Add connections management page`

### Task 26: Credentials Page (#1693)

See #1693. Credential list, upload, command config, key generation, usage list.

Commit: `[#1693] Add credentials management page`

### Task 27: Session Detail with xterm.js (#1694)

See #1694. xterm.js terminal, WebSocket hook, toolbar, window tabs, status overlays, host key dialog.

Commit: `[#1694] Add session detail page with xterm.js terminal`

### Task 28: History and Search Pages (#1695)

See #1695. Session history timeline, cross-session semantic search, filters, context.

Commit: `[#1695] Add session history and terminal search pages`

### Task 29: Remaining UI Pages (#1696)

See #1696. Tunnels, enrollment, known hosts, activity pages.

Commit: `[#1696] Add tunnels, enrollment, known hosts, and activity pages`

---

## Phase 7: Documentation

### Task 30: OpenAPI Specs (#1697)

See #1697. 10 OpenAPI path modules + schemas + main builder integration.

Commit: `[#1697] Add OpenAPI spec modules for all terminal endpoints`

---

## Dependency Graph

```
Phase 1 (Foundation):
  #1668 (migrations) ─────────────┐
  #1669 (protobuf) ──┐            │
  #1670 (container) ←─┘           │
  #1671 (credentials) ←───────────┘

Phase 2 (Core):
  #1672 (conn CRUD) ←── #1668, #1670, #1671
  #1673 (cred CRUD) ←── #1668, #1671
  #1674 (sessions) ←── #1668-#1672
  #1675 (I/O stream) ←── #1674
  #1676 (commands) ←── #1674

Phase 3 (Advanced):
  #1677 (windows) ←── #1674
  #1678 (tunnels) ←── #1674
  #1679 (known hosts) ←── #1668, #1674
  #1680 (entries) ←── #1668, #1674, #1676
  #1681 (search) ←── #1668, #1680
  #1682 (recovery) ←── #1674

Phase 4 (Security):
  #1683 (enrollment) ←── #1668, #1672
  #1684 (SSH enroll) ←── #1670, #1683
  #1685 (mTLS) ←── #1670
  #1686 (audit) ←── #1668, #1674
  #1687 (retention) ←── #1668, #1680

Phase 5 (Plugin):
  #1688 (conn tools) ←── #1672, #1673
  #1689 (session tools) ←── #1674, #1676
  #1690 (search tools) ←── #1678, #1681

Phase 6 (UI):
  #1691 (dashboard) ←── #1672, #1674, #1678
  #1692 (connections) ←── #1672
  #1693 (credentials) ←── #1673
  #1694 (xterm.js) ←── #1675, #1677
  #1695 (history/search) ←── #1681
  #1696 (remaining) ←── #1678, #1679, #1683, #1686

Phase 7 (Docs):
  #1697 (OpenAPI) ←── all API issues
```

## Parallelism Opportunities

Within each phase, many tasks can be done in parallel:

**Phase 1:** #1668 + #1669 in parallel. Then #1670 + #1671 in parallel.
**Phase 2:** #1672 + #1673 in parallel. Then #1674 alone. Then #1675 + #1676 in parallel.
**Phase 3:** All 6 tasks can be done in parallel (different domains).
**Phase 4:** #1683 + #1685 + #1686 in parallel. Then #1684, #1687.
**Phase 5:** All 3 tasks in parallel.
**Phase 6:** #1691-#1693 in parallel. Then #1694. Then #1695 + #1696 in parallel.
