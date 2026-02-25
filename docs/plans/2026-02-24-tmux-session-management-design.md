# TMux Session Management — Feature Design

**Date:** 2026-02-24
**Status:** Approved

## Overview

A new worker container/service that manages tmux sessions over SSH (and locally), providing OpenClaw agents and human users with persistent terminal access to remote and local hosts. Session interactions are optionally embedded via pgvector for semantic search, enabling agents to "remember" terminal sessions.

## Requirements Summary

- **Connection management**: Define and store SSH connections (host, port, user, credentials)
- **Credential security**: Envelope encryption by default + command-based providers (e.g., `op` for 1Password)
- **Session lifecycle**: Create, attach, detach, terminate tmux sessions
- **Terminal I/O**: Full interactive terminal via xterm.js in the browser
- **Window/pane support**: Multi-window, multi-pane tmux layouts
- **SSH tunnels**: Forward, reverse, dynamic (SOCKS) tunnels
- **Reverse tunnel self-registration**: Remote servers can SSH back to the worker with enrollment tokens
- **Searchable history**: Command+output pairs, scrollback chunks, and annotations embedded via pgvector
- **Separate from memory recall**: Dedicated search endpoints with filtering by host, session, tags, date range
- **Plugin tools**: Full terminal functionality exposed as OpenClaw agent tools
- **Web UI**: Full management interface with interactive xterm.js terminal
- **Namespace scoping**: All entities follow the existing namespace authorization pattern

## Architecture

### Service Topology

```
Browser (xterm.js)
    ↕ WebSocket (JWT auth)
API Server (Fastify)
    ├── Auth + namespace verification
    ├── REST CRUD (connections, sessions, tunnels, etc.)
    ├── WebSocket → gRPC stream bridge (terminal I/O)
    └── Search endpoint (queries DB directly for entries)
    ↕ gRPC + mTLS
TMux Worker (new container)
    ├── gRPC server (session management, terminal I/O)
    ├── DB access (entry recording, credential resolution, session state)
    ├── tmux process management
    ├── SSH client (outbound connections)
    ├── SSH server (enrollment port for reverse tunnels)
    ├── Output throttling + batched entry recording
    └── Embedding queue (flags entries for async embedding)
    ↕ SSH / local
Remote Hosts (or local tmux)
```

### Key Design Decisions

1. **gRPC-native worker** — Strong typing via protobuf, efficient bidirectional streaming for terminal I/O. API server bridges gRPC streams to WebSocket for browser.
2. **Worker has DB access** — Credentials never leave the worker's memory. Entry recording happens at the source. No credential passthrough over gRPC.
3. **mTLS between API and worker** — gRPC channel encrypted with mutual TLS.
4. **Existing worker handles embeddings** — The background job worker polls for un-embedded entries and runs them through the embedding pipeline (same pattern as memories).
5. **Namespace scoping on all tables** — Consistent with the rest of the project, using `verifyReadScope`/`verifyWriteScope`.

## Data Model

### terminal_connection

Defines how to reach a host. Reusable across sessions.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid PK | |
| namespace | text NOT NULL | Tenant isolation |
| name | text NOT NULL | Human label ("prod-web-1") |
| host | text | Hostname/IP (null for local) |
| port | int DEFAULT 22 | SSH port |
| username | text | SSH user |
| auth_method | text | 'key', 'password', 'agent', 'command' |
| credential_id | uuid FK → terminal_credential | |
| proxy_jump_id | uuid FK → terminal_connection | Self-ref for jump host chains |
| is_local | boolean DEFAULT false | Local tmux (no SSH) |
| env | jsonb | Environment variables |
| connect_timeout_s | int DEFAULT 30 | |
| keepalive_interval | int DEFAULT 60 | SSH keepalive seconds |
| idle_timeout_s | int | Auto-disconnect after idle (null = no limit) |
| max_sessions | int | Max concurrent sessions (null = no limit) |
| host_key_policy | text DEFAULT 'strict' | 'strict', 'tofu', 'skip' |
| tags | text[] | Filterable labels |
| notes | text | Freeform description |
| last_connected_at | timestamptz | |
| last_error | text | Last connection error |
| deleted_at | timestamptz | Soft delete |
| created_at | timestamptz NOT NULL DEFAULT now() | |
| updated_at | timestamptz NOT NULL DEFAULT now() | |

### terminal_credential

Encrypted SSH keys, passwords, or command references.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid PK | |
| namespace | text NOT NULL | |
| name | text NOT NULL | Label ("troy-ed25519") |
| kind | text NOT NULL | 'ssh_key', 'password', 'command' |
| encrypted_value | bytea | Envelope-encrypted private key or password |
| command | text | External command (e.g., 'op read op://vault/key') |
| command_timeout_s | int DEFAULT 10 | Max wait for command |
| cache_ttl_s | int DEFAULT 0 | 0 = no cache |
| fingerprint | text | SSH key fingerprint |
| public_key | text | Public key (safe to display) |
| deleted_at | timestamptz | |
| created_at | timestamptz NOT NULL DEFAULT now() | |
| updated_at | timestamptz NOT NULL DEFAULT now() | |

### terminal_known_host

SSH host key trust store.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid PK | |
| namespace | text NOT NULL | |
| connection_id | uuid FK → terminal_connection | |
| host | text NOT NULL | |
| port | int DEFAULT 22 | |
| key_type | text NOT NULL | 'ssh-ed25519', 'ssh-rsa', etc. |
| key_fingerprint | text NOT NULL | |
| public_key | text NOT NULL | Full key for verification |
| trusted_at | timestamptz NOT NULL DEFAULT now() | |
| trusted_by | text | Who approved (agent/user/tofu) |
| created_at | timestamptz NOT NULL DEFAULT now() | |

UNIQUE(namespace, host, port, key_type)

### terminal_session

An active or historical tmux session.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid PK | |
| namespace | text NOT NULL | |
| connection_id | uuid FK → terminal_connection | |
| tmux_session_name | text NOT NULL | Name on the host |
| worker_id | text | Which worker instance owns this |
| status | text NOT NULL | 'starting', 'active', 'idle', 'disconnected', 'terminated', 'error', 'pending_host_verification' |
| cols | int DEFAULT 120 | Terminal width |
| rows | int DEFAULT 40 | Terminal height |
| capture_interval_s | int DEFAULT 30 | Scrollback capture frequency (0=disabled) |
| capture_on_command | boolean DEFAULT true | Capture after each command |
| embed_commands | boolean DEFAULT true | Auto-embed command entries |
| embed_scrollback | boolean DEFAULT false | Auto-embed scrollback |
| started_at | timestamptz | |
| last_activity_at | timestamptz | |
| terminated_at | timestamptz | |
| exit_code | int | |
| error_message | text | |
| tags | text[] | |
| notes | text | |
| created_at | timestamptz NOT NULL DEFAULT now() | |
| updated_at | timestamptz NOT NULL DEFAULT now() | |

### terminal_session_window

Tracks tmux windows within a session.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid PK | |
| session_id | uuid FK → terminal_session | |
| namespace | text NOT NULL | |
| window_index | int NOT NULL | |
| window_name | text | |
| is_active | boolean DEFAULT false | |
| created_at | timestamptz NOT NULL DEFAULT now() | |
| updated_at | timestamptz NOT NULL DEFAULT now() | |

UNIQUE(session_id, window_index)

### terminal_session_pane

Tracks panes within windows.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid PK | |
| window_id | uuid FK → terminal_session_window | |
| namespace | text NOT NULL | |
| pane_index | int NOT NULL | |
| is_active | boolean DEFAULT false | |
| pid | int | Process PID |
| current_command | text | Running command (vim, htop) |
| created_at | timestamptz NOT NULL DEFAULT now() | |
| updated_at | timestamptz NOT NULL DEFAULT now() | |

UNIQUE(window_id, pane_index)

### terminal_session_entry

Captured interactions — commands, output, scrollback, annotations.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid PK | |
| session_id | uuid FK → terminal_session | |
| pane_id | uuid FK → terminal_session_pane | Optional |
| namespace | text NOT NULL | |
| kind | text NOT NULL | 'command', 'output', 'scrollback', 'annotation', 'error' |
| content | text NOT NULL | |
| embedding | vector(1536) | pgvector, populated async |
| embedded_at | timestamptz | Null = not yet embedded |
| sequence | bigserial | Ordering within session |
| captured_at | timestamptz NOT NULL DEFAULT now() | |
| metadata | jsonb | { exit_code, duration_ms, etc. } |
| created_at | timestamptz NOT NULL DEFAULT now() | |

Index: `CREATE INDEX ON terminal_session_entry USING ivfflat (embedding vector_cosine_ops)`

### terminal_tunnel

Active SSH tunnels.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid PK | |
| namespace | text NOT NULL | |
| connection_id | uuid FK → terminal_connection | |
| session_id | uuid FK → terminal_session | Optional association |
| direction | text NOT NULL | 'local', 'remote', 'dynamic' |
| bind_host | text DEFAULT '127.0.0.1' | |
| bind_port | int NOT NULL | |
| target_host | text | Null for dynamic/SOCKS |
| target_port | int | |
| status | text NOT NULL | 'active', 'failed', 'closed' |
| error_message | text | |
| created_at | timestamptz NOT NULL DEFAULT now() | |
| updated_at | timestamptz NOT NULL DEFAULT now() | |

### terminal_enrollment_token

For remote server self-registration.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid PK | |
| namespace | text NOT NULL | |
| token_hash | text NOT NULL | Hashed enrollment token |
| label | text NOT NULL | |
| max_uses | int | Null = unlimited |
| uses | int DEFAULT 0 | |
| expires_at | timestamptz | |
| connection_defaults | jsonb | Default tags, notes, env |
| allowed_tags | text[] | Auto-applied tags |
| created_at | timestamptz NOT NULL DEFAULT now() | |

### terminal_activity

Audit trail.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid PK | |
| namespace | text NOT NULL | |
| session_id | uuid FK → terminal_session | Optional |
| connection_id | uuid FK → terminal_connection | Optional |
| actor | text NOT NULL | Agent ID, user ID, or 'system' |
| action | text NOT NULL | 'session.create', 'command.send', etc. |
| detail | jsonb | Action-specific metadata |
| created_at | timestamptz NOT NULL DEFAULT now() | |

## gRPC Service Definition

```protobuf
service TerminalService {
  // Connection testing
  rpc TestConnection(TestConnectionRequest) returns (TestConnectionResponse);

  // Session lifecycle
  rpc CreateSession(CreateSessionRequest) returns (SessionInfo);
  rpc TerminateSession(TerminateSessionRequest) returns (Empty);
  rpc ListSessions(ListSessionsRequest) returns (ListSessionsResponse);
  rpc GetSession(GetSessionRequest) returns (SessionInfo);
  rpc ResizeSession(ResizeSessionRequest) returns (Empty);

  // Window/pane management
  rpc CreateWindow(CreateWindowRequest) returns (WindowInfo);
  rpc CloseWindow(CloseWindowRequest) returns (Empty);
  rpc SplitPane(SplitPaneRequest) returns (PaneInfo);
  rpc ClosePane(ClosePaneRequest) returns (Empty);

  // Terminal I/O — bidirectional stream
  rpc AttachSession(stream TerminalInput) returns (stream TerminalOutput);

  // Command execution
  rpc SendCommand(SendCommandRequest) returns (SendCommandResponse);
  rpc SendKeys(SendKeysRequest) returns (Empty);

  // Scrollback capture
  rpc CapturePane(CapturePaneRequest) returns (CapturePaneResponse);

  // Tunnels
  rpc CreateTunnel(CreateTunnelRequest) returns (TunnelInfo);
  rpc CloseTunnel(CloseTunnelRequest) returns (Empty);
  rpc ListTunnels(ListTunnelsRequest) returns (ListTunnelsResponse);

  // Enrollment
  rpc GetEnrollmentListener(Empty) returns (stream EnrollmentEvent);

  // Host key verification
  rpc ApproveHostKey(ApproveHostKeyRequest) returns (Empty);
  rpc RejectHostKey(RejectHostKeyRequest) returns (Empty);

  // Health
  rpc GetWorkerStatus(Empty) returns (WorkerStatus);
}
```

### Key Streaming Design

- `AttachSession`: Bidirectional stream. Client sends keystrokes (TerminalInput), server sends screen updates (TerminalOutput). API server bridges this to WebSocket.
- `GetEnrollmentListener`: Server stream. Emits events when remote servers self-register.
- `SendCommand`: Uses marker technique — sends `cmd; echo "MARKER_UUID"` and waits for marker. Includes `timeout_s` parameter.

### Worker Responsibilities

- **Session management**: SSH + tmux process lifecycle
- **Credential resolution**: Decrypts credentials from DB or executes command-based providers
- **Entry recording**: Batched inserts of terminal_session_entry rows
- **Output throttling**: Rate-limits recording for high-volume output
- **Session recovery**: Re-attaches to tmux sessions after worker restart
- **Enrollment SSH server**: Accepts reverse tunnel registrations

### Session Recovery Protocol

On worker startup:
1. Query `terminal_session WHERE worker_id = $this AND status IN ('active', 'idle', 'disconnected')`
2. For each session, attempt to re-attach to the tmux session on the host
3. If successful, update status to 'active'
4. If tmux session is gone, update status to 'terminated'
5. If host is unreachable, update status to 'disconnected'

## REST API Endpoints

### Connections

```
GET    /api/terminal/connections                    — List connections (filtered)
POST   /api/terminal/connections                    — Create connection
GET    /api/terminal/connections/:id                — Get connection details
PATCH  /api/terminal/connections/:id                — Update connection
DELETE /api/terminal/connections/:id                — Soft delete
POST   /api/terminal/connections/:id/test           — Test connectivity
POST   /api/terminal/connections/import-ssh-config  — Import from SSH config
```

### Credentials

```
GET    /api/terminal/credentials                    — List (no secrets)
POST   /api/terminal/credentials                    — Create/upload
GET    /api/terminal/credentials/:id                — Get metadata
PATCH  /api/terminal/credentials/:id                — Update
DELETE /api/terminal/credentials/:id                — Soft delete
POST   /api/terminal/credentials/generate           — Generate key pair
```

### Sessions

```
GET    /api/terminal/sessions                       — List sessions
POST   /api/terminal/sessions                       — Create session
GET    /api/terminal/sessions/:id                   — Get session details
PATCH  /api/terminal/sessions/:id                   — Update notes/tags
DELETE /api/terminal/sessions/:id                    — Terminate session
POST   /api/terminal/sessions/:id/resize            — Resize terminal
POST   /api/terminal/sessions/:id/annotate          — Add annotation
WS     /api/terminal/sessions/:id/attach            — WebSocket terminal attach
```

### Windows & Panes

```
POST   /api/terminal/sessions/:id/windows                      — Create window
DELETE /api/terminal/sessions/:sid/windows/:wid                 — Close window
POST   /api/terminal/sessions/:sid/windows/:wid/split           — Split pane
DELETE /api/terminal/sessions/:sid/panes/:pid                    — Close pane
```

### Commands (Agent API)

```
POST   /api/terminal/sessions/:id/send-command      — Send command, optionally wait
POST   /api/terminal/sessions/:id/send-keys          — Send raw keystrokes
GET    /api/terminal/sessions/:id/capture             — Capture current pane
```

### History & Search

```
GET    /api/terminal/sessions/:id/entries            — List entries (paginated)
GET    /api/terminal/sessions/:id/entries/export      — Export as text/markdown
POST   /api/terminal/search                           — Semantic search
```

### Tunnels

```
GET    /api/terminal/tunnels                          — List active tunnels
POST   /api/terminal/tunnels                          — Create tunnel
DELETE /api/terminal/tunnels/:id                      — Close tunnel
```

### Enrollment

```
GET    /api/terminal/enrollment-tokens                — List tokens
POST   /api/terminal/enrollment-tokens                — Create token
DELETE /api/terminal/enrollment-tokens/:id             — Revoke token
POST   /api/terminal/enroll                            — Remote self-registration
```

### Known Hosts

```
GET    /api/terminal/known-hosts                      — List
POST   /api/terminal/known-hosts                      — Trust host key
POST   /api/terminal/known-hosts/approve              — Approve pending (unblocks session)
DELETE /api/terminal/known-hosts/:id                   — Revoke trust
```

### Activity

```
GET    /api/terminal/activity                          — Audit log
```

## OpenClaw Plugin Tools

Tools in `packages/openclaw-plugin/src/tools/terminal.ts`:

### Connection Management
- `terminal_connection_list` — List saved connections (tags, search, status filters)
- `terminal_connection_create` — Save a new connection
- `terminal_connection_update` — Update connection
- `terminal_connection_delete` — Remove connection
- `terminal_connection_test` — Test SSH connectivity

### Credential Management
- `terminal_credential_create` — Upload SSH key or set command
- `terminal_credential_list` — List credentials (no secrets)
- `terminal_credential_delete` — Remove credential

### Session Management
- `terminal_session_start` — Start tmux session on a connection
- `terminal_session_list` — List active/historical sessions
- `terminal_session_terminate` — Terminate session
- `terminal_session_info` — Get session details + windows/panes

### Command Execution
- `terminal_send_command` — Send command and wait for output (timeout_s, pane_id)
- `terminal_send_keys` — Send raw keystrokes (for interactive programs)
- `terminal_capture_pane` — Read current pane content

### Search & Annotations
- `terminal_search` — Semantic search across entries (query, connection_id, session_id, kind, tags, date_range)
- `terminal_annotate` — Add note/annotation to session

### Tunnels
- `terminal_tunnel_create` — Open SSH tunnel (forward, reverse, dynamic)
- `terminal_tunnel_list` — List active tunnels
- `terminal_tunnel_close` — Close tunnel

## UI Design

### Routes

```
/terminal                              → TerminalDashboardPage
/terminal/connections                  → ConnectionsPage
/terminal/connections/:id              → ConnectionDetailPage
/terminal/credentials                  → CredentialsPage
/terminal/sessions                     → SessionsPage
/terminal/sessions/:id                 → SessionDetailPage (xterm.js)
/terminal/sessions/:id/history         → SessionHistoryPage
/terminal/tunnels                      → TunnelsPage
/terminal/enrollment                   → EnrollmentPage
/terminal/search                       → TerminalSearchPage
/terminal/known-hosts                  → KnownHostsPage
/terminal/activity                     → TerminalActivityPage
```

### Pages

**Terminal Dashboard** — Active sessions count, connection health, quick-connect, recent sessions, active tunnels.

**Connections Page** — Card/table view with name, host, status indicator, tags. Create/edit dialog, test button, proxy chain visualization.

**Session Detail Page** — Full xterm.js terminal (interactive, resizable). Session info sidebar. Window/pane tabs. Toolbar with annotate, split, fullscreen. Status overlay for connecting/disconnected states.

**Terminal Search** — Full-page semantic search with filters (connection, session, date range, entry kind, tags). Results show matched entries with surrounding context.

**Credentials Page** — List with name, kind, fingerprint. Upload/paste SSH key. Command-based credential config. Key pair generation. Usage list (which connections use each credential).

**Tunnels Page** — Direction arrows (local↔remote), status indicators, create/kill actions.

**Enrollment Page** — Token creation with expiry/max-uses. Token shown once. Generated enrollment script for copy-paste. List of enrolled connections.

**Known Hosts** — Trusted keys with fingerprints. Trust/revoke actions. TOFU approval dialog in session page.

### Components

```
src/ui/components/terminal/
├── terminal-emulator.tsx              — xterm.js wrapper (WebSocket, reconnection)
├── terminal-toolbar.tsx               — window tabs, split, annotate, fullscreen
├── terminal-dashboard-stats.tsx       — summary cards
├── quick-connect-dialog.tsx           — quick-start session
├── connection-card.tsx                — connection list item
├── connection-form.tsx                — create/edit connection
├── connection-status-indicator.tsx    — online/offline/error badge
├── proxy-chain-diagram.tsx            — jump host chain visualization
├── credential-form.tsx                — upload key / configure command
├── credential-usage-list.tsx          — connections using a credential
├── session-card.tsx                   — session list item
├── session-info-sidebar.tsx           — session metadata panel
├── session-status-overlay.tsx         — connecting/disconnected overlay
├── tunnel-card.tsx                    — tunnel list item
├── tunnel-form.tsx                    — create tunnel dialog
├── tunnel-direction-diagram.tsx       — direction arrow visualization
├── enrollment-form.tsx                — create enrollment token
├── enrollment-script-generator.tsx    — copyable enrollment script
├── known-host-card.tsx                — host key display
├── host-key-dialog.tsx                — TOFU approval dialog
├── entry-search.tsx                   — search bar + results
├── entry-timeline.tsx                 — timeline view of entries
├── search-result-context.tsx          — matched entry + context
├── terminal-search-filters.tsx        — filters for cross-session search
├── capture-config-form.tsx            — capture settings
├── activity-filters.tsx               — audit log filters
├── terminal-empty-state.tsx           — first-use guidance
└── terminal-notification-toast.tsx    — enrollment/disconnect toasts
```

### Hooks

```
src/ui/hooks/
├── useTerminalWebSocket.ts            — WebSocket + reconnection + backoff
├── useTerminalSessions.ts             — session CRUD queries
├── useTerminalConnections.ts          — connection CRUD queries
└── useTerminalSearch.ts               — semantic search queries
```

### xterm.js Integration

- `@xterm/xterm` — core terminal emulator
- `@xterm/addon-fit` — auto-resize to container
- `@xterm/addon-web-links` — clickable URLs
- `@xterm/addon-search` — in-terminal search
- `@xterm/addon-webgl` — GPU rendering (optional)

WebSocket lifecycle: JWT auth → connect → resize on container change → reconnect with backoff on disconnect → clean close on unmount.

### UX Considerations

- **Focus management**: Escape releases focus from terminal. Clear focus ring indicator.
- **Responsive**: Mobile shows session info/history in read-only. Desktop for interactive terminal.
- **Empty states**: First-use guidance with setup flow (credential → connection → session).
- **Keyboard shortcuts**: Ctrl+Shift+F (search), Escape (release focus), Ctrl+Shift+` (fullscreen).
- **Notifications**: Toast for disconnects, enrollment events, tunnel failures.

## Operational Concerns

### Entry Retention

Namespace-level setting (default 90 days). pgcron job cleans up old entries. Annotated entries exempt from auto-cleanup.

### Output Throttling

If output exceeds configurable bytes/sec threshold, recording switches to summary mode ("high-volume output truncated, X bytes in Y seconds"). Live WebSocket feed applies backpressure.

### Session Recovery

On worker restart, re-attach to surviving tmux sessions. SSH sessions reconnect if remote tmux persists. Orphaned sessions marked as terminated.

### Multi-Worker Scaling

`worker_id` in session table provides affinity. API routes to correct worker. Dead worker's sessions redistributable.

### Security

- Credentials envelope-encrypted with project's encryption key
- Command-based credentials (e.g., `op`) for external secret managers
- mTLS between API server and worker
- Enrollment tokens hashed (bcrypt/argon2), shown once on creation
- Host key verification (strict/TOFU/skip per connection)
- All entities namespace-scoped
- Audit trail on all actions

## Testing Strategy

### Unit Tests
- Credential encryption/decryption
- SSH config parser
- Command marker detection
- Output throttling logic
- gRPC message serialization

### Integration Tests (real DB)
- Connection CRUD with namespace scoping
- Session lifecycle state machine
- Entry recording and embedding
- Semantic search across entries
- Enrollment token creation and validation
- Known host trust/verification flow

### E2E Tests
- Full flow: create credential → connection → session → send command → search history
- WebSocket terminal attach and I/O
- Tunnel creation and verification
- Worker restart and session recovery
- Enrollment flow (HTTP path)

## Docker Configuration

New service in docker-compose:

```yaml
tmux-worker:
  build:
    context: .
    dockerfile: Dockerfile.tmux-worker
  environment:
    - DATABASE_URL
    - GRPC_PORT=50051
    - ENROLLMENT_SSH_PORT=2222
    - OAUTH_TOKEN_ENCRYPTION_KEY  # reuse for credential encryption
    - WORKER_ID=tmux-worker-1
  ports:
    - "50051:50051"   # gRPC (internal)
    - "2222:2222"     # Enrollment SSH (external)
  depends_on:
    - db
    - migrate
```

API server adds:
```yaml
environment:
  - TMUX_WORKER_GRPC_URL=tmux-worker:50051
  - TMUX_WORKER_MTLS_CERT=/certs/api-client.pem
  - TMUX_WORKER_MTLS_KEY=/certs/api-client-key.pem
  - TMUX_WORKER_MTLS_CA=/certs/ca.pem
```
