# Symphony Orchestration Layer — Design Document

**Date:** 2026-03-06
**Status:** Approved (post 3-round dual audit)
**Epic:** Symphony Orchestration for Development Tooling

---

## 1. Overview

Symphony is a fully autonomous orchestration layer for openclaw-projects that manages coding agent execution against GitHub issues. Users configure projects with repos and SSH hosts, and Symphony handles everything: provisioning devcontainers, launching coding agents (Claude Code, Codex), monitoring progress, retrying failures, verifying results, merging PRs, and closing issues.

### Core Promise

**Users and agents should NOT have to closely monitor coding agents — Symphony handles that autonomously.** If something goes wrong, Symphony either fixes it automatically or notifies the user with clear, actionable information.

### Key Design Decisions

1. **New orchestration layer** composing existing primitives (dev sessions, terminal sessions, dev prompts)
2. **Separate symphony-worker process** — not embedded in the existing worker
3. **Zero repo intrusion** — nothing stored in target repos; everything in orchestrator DB
4. **Pluggable tracker** with GitHub as first implementation
5. **Both** per-project multi-repo AND per-repo independent operation
6. **Orchestrator-decided agent selection** (impl→Claude Code, review→Codex), configurable per-project
7. **Full control panel UI** — monitoring, control, and configuration

---

## 2. Domain Model

### Entity Relationship

```
Project (work_item, type=project)
  ├── project_repository (org/repo, sync_strategy, sync_epic_id)
  ├── project_host (terminal_connection, priority, max_concurrent_sessions)
  ├── symphony_orchestrator_config (versioned: polling, concurrency, budget, agent rules, notifications)
  │     └── symphony_notification_rule (event → channel + target)
  ├── Work Items (synced from GitHub, parented under sync epic)
  │     └── symphony_claim (orchestrator_id, lease_expires_at, claim_epoch)
  │     └── symphony_run (attempt, status, stage, trace_id, config_version, manifest, tokens, cost)
  │           ├── symphony_provisioning_step (8 steps with rollback, timeout, heartbeat)
  │           ├── symphony_run_terminal (purpose: provisioning/agent/review/cleanup)
  │           ├── symphony_run_event (timestamped event stream, hypertable)
  │           ├── dev_session (orchestrated=true, agent_type)
  │           │     └── terminal_session (purpose=orchestrated)
  │           └── token tracking (token_input, token_output, model_id, cost)
  ├── symphony_tool_config (agent CLI: command, verify, min_version, auth, timeouts)
  ├── symphony_secret_deployment (host, secret_ref, version, file_path, last_used_at)
  └── Workflow Templates (dev_prompt, per-project overrides, extended context vars)

Shared:
  ├── symphony_github_rate_limit (remaining, limit, reset_at)
  ├── symphony_workspace (host, repo, worktree_path, container, warm_state, disk_usage)
  ├── symphony_container (run_id, host, container_id, max_ttl_hours)
  ├── symphony_cleanup_item (resource_type, resource_ref, status with SLO)
  └── symphony_orchestrator_heartbeat (orchestrator_id, heartbeat_at, active_runs)
```

### GitHub Issue Sync Hierarchy

Synced issues are parented under an auto-created "GitHub Issues" epic per project repository. This satisfies the `validate_work_item_hierarchy` trigger which requires issues to have an epic parent.

```
Project (kind=project)
  └── "GitHub Issues: <org>/<repo>" (kind=epic, auto-created)
       ├── Issue #123 (kind=issue, synced from GitHub)
       ├── Issue #124 (kind=issue, synced from GitHub)
       └── ...
```

### Dev Session Migration

Orchestrated sessions use `symphony@orchestrator.local` as `user_email` (not nullable — preserves existing query patterns). Existing queries migrated to namespace-based filtering.

---

## 3. State Machine

### Run Lifecycle

```
Unclaimed
  │ poll selects (pre-dispatch: budget gate, rate limit, disk, host capacity)
  ▼
Claimed (leased 60s, claim_epoch fencing)
  │ atomic concurrency check (pg_advisory_xact_lock)
  ▼
Provisioning (8 steps, 20min aggregate, per-step timeouts + rollback)
  │ workspace ready
  ▼
Prompting (2min timeout)
  │ prompt delivered via stdin (never shell arg)
  ▼
Running (leased, heartbeat, configurable timeout default 60min)
  │ stages inferred from I/O (advisory only, never drives transitions)
  │
  ├── agent success → VerifyingResult (10min: CI check + optional Codex review)
  │                      │ verified → MergePending
  │                      │ CI fails → Failed (retry with CI feedback)
  │
  ├── approval needed → AwaitingApproval (5min SLA, auto-resolve policy)
  ├── stall timeout → Stalled → RetryQueued
  ├── agent error → Failed → RetryQueued
  └── agent loop detected → Failed (agent_loop) → RetryQueued

MergePending
  │ merge succeeds → PostMergeVerify
  │ merge conflict → Failed (retry with rebase)
  │ merge blocked → AwaitingApproval

PostMergeVerify
  │ post-merge CI green → IssueClosing
  │ post-merge CI red → revert PR, Failed

IssueClosing
  │ issue closed → Released (complete)

RetryQueued (backoff + jitter, per-failure-class limits)
  │ retry timer fires → Redispatch → Provisioning
  │ max retries exceeded OR budget exceeded → Paused

ContinuationWait (exponential backoff: 30s × 2^n, max 30min)
  │ re-fetch issue + check for new signal + issue edit detection
  │ issue still active + new signal → Redispatch
  │ 3 continuations without progress → Paused

Paused → manual re-enable → Redispatch

External triggers (from any active state):
  User cancels → Terminating (2min graceful) → cleanup → Released
  Issue terminal → Terminating → cleanup → Released
  Issue non-active → Terminating → Released (deferred GC, 24h)
  Lease expired → Orphaned → reclaim → Failed/Released
  Cleanup fails → CleanupFailed (operator queue with SLO)
  Host draining → Terminating → Released
```

### Compare-and-Swap Transitions

Every state write uses `WHERE state_version = $expected`. Terminal states are idempotent. `claim_epoch` fences against split-brain after lease expiry.

### Failure Taxonomy with Per-Class Retry Limits

| Failure Class | Max Retries | Recovery |
|---------------|-------------|----------|
| ssh_lost | 3 | Retry same host after reconnect |
| docker_unavailable | 2 | Host degraded, retry different host |
| host_reboot | 2 | Wait for host recovery |
| credentials_unavailable | 1 | Paused (needs human) |
| rate_limited | unlimited | Wait until reset_at |
| disk_full | 0 | Host degraded immediately |
| token_exhaustion | 0 | Terminal failure |
| context_overflow | 1 | Retry with reduced context |
| budget_exceeded | 0 | Paused |
| agent_loop | 1 | Retry with different prompt |
| diverged_base | 2 | Auto-rebase or restart |

### Concurrency Control (Atomic)

All four levels checked in one transaction with `pg_advisory_xact_lock(host_id)`:
- Global: `max_concurrent_agents - running_total`
- Project: `project.max_concurrent - running_in_project`
- Host: `host.max_concurrent_sessions - active_on_host`
- State: `per_state_limit[state] - running_in_state`

### Per-State Timeouts

| State | Timeout |
|-------|---------|
| Claimed | 60s |
| Provisioning (aggregate) | 20 min |
| Provisioning (per-step) | configurable |
| Prompting | 2 min |
| Running | configurable (default 60 min) |
| VerifyingResult | 10 min |
| MergePending | 30 min |
| PostMergeVerify | 15 min |
| IssueClosing | 5 min |
| ContinuationWait | 30s-30min (backoff) |
| AwaitingApproval | 5 min SLA |
| Terminating | 2 min |

---

## 4. Provisioning Pipeline

### 8 Steps with Rollback

| Step | Action | Timeout | Rollback |
|------|--------|---------|----------|
| 1. disk_check | Verify 10GB+ free on host | 30s | none |
| 2. ssh_connect | Connect via terminal session | 30s | disconnect |
| 3. repo_check | ~/claw/repos/ORG/REPO, clone if missing | 5min | rm -rf if freshly cloned |
| 4. env_sync | 1Password ".env (ORG/REPO) [User]", version check | 30s | rm .env, delete record |
| 5. devcontainer_up | devcontainer up --workspace-folder | 15min | docker rm -f if fresh |
| 6. container_exec | docker exec -u USER CONTAINER /bin/zsh | 30s | exit shell |
| 7. agent_verify | CLI version + auth check | 60s | none (read-only) |
| 8. worktree_setup | git fetch, git worktree add | 2min | git worktree remove |

Each step tracks: `status`, `rollback_status`, `started_at`, `completed_at`, `heartbeat_at`, `error`, `timeout_s`.

On failure: execute rollbacks in reverse order. Track in `symphony_provisioning_step`.

### Devcontainer Config Validation

Before step 6, validate `.devcontainer/devcontainer.json` against strict allowlist patterns for container names. Never blindly trust target repo config.

### Agent CLI Version Check

Step 7 validates `claude --version` and `codex --version` against minimum versions in `symphony_tool_config`. Fails fast with clear version mismatch error.

---

## 5. Prompt & Agent Execution

### Prompt Delivery

- Prompt passed via **stdin pipe** — never as shell argument
- Agent launched via `execFile` (no shell) — prevents injection
- Issue title/body sanitized: strip ANSI escapes, null bytes
- Worktree paths slugified to `[A-Za-z0-9._-]`, length-capped

### Template Context

Dev prompts extended with Symphony variables:
```
{{ issue_title }}, {{ issue_body }}, {{ issue_labels }}
{{ issue_acceptance_criteria }}
{{ run_attempt }}, {{ previous_error }}, {{ continuation_count }}
{{ branch_name }}, {{ pr_url }}, {{ workspace_path }}
{{ repo_org }}, {{ repo_name }}, {{ project_name }}
```

### Agent Progress Markers

Agents can write to `~/.symphony-heartbeat` with timestamps. Orchestrator checks during heartbeat. Recent markers suppress loop detection.

### Agent Loop Detection

Track during Running:
- File change count per window
- Test result diversity
- Command diversity
- No progress for 10 minutes (configurable per-project, up to 30min for slow builds)

### Filesystem Sandboxing

- Read-only bind mounts except worktree
- Docker socket removed from agent containers
- `safe.directory` git config restrictions
- Post-run diff scope validation — flag changes outside worktree

---

## 6. Self-Healing Mechanisms

### Orchestrator Crash Recovery

On startup, each orchestrator runs a recovery sweep:
- Find runs with expired leases (`lease_expires_at < now()`)
- Transition to recovery states: Claimed → Released, Provisioning → Failed (rollback), Running → Stalled
- Heartbeat tracking via `symphony_orchestrator_heartbeat`

### SSH Session Recovery

Prerequisite infrastructure: SSH reconnect + remote tmux reattach:
- Detect disconnect → exponential backoff reconnect
- On reconnect → `tmux attach` to existing session
- 3 retries before marking session dead

### Host Circuit Breaker with Auto-Recovery

- N provisioning failures → host marked `degraded`
- Every 10 minutes: lightweight health probe (SSH + disk check)
- 2 consecutive probe successes → auto-recover to healthy
- Follows existing `CircuitBreaker` half_open pattern

### GitHub Rate Limit Budget

- Track `X-RateLimit-Remaining` and `X-RateLimit-Reset`
- Reserve minimum quota (100 calls) for critical ops
- Sync operations are paginated with resume cursor
- Back off to reset time when rate-limited

### Secret Management

- Version tracking against 1Password items
- Pre-provisioning validation (source .env, check expected vars)
- Rollback to previous known-good version on validation failure
- GC secrets unused for 7 days with no active runs
- `last_used_at` tracking on deployments

### Ongoing Disk Monitoring

Part of health check loop:
- Host below 5GB → pause dispatches, notify
- LRU workspace eviction when disk low
- Track disk_usage per workspace

### Config Change Protocol

- Changes increment config version
- Active runs use snapshotted version
- Budget changes apply immediately
- Structural changes affect new runs only
- Host removal triggers draining protocol

### Codex Review Fallback

- 5min timeout, 2 retries
- If Codex unavailable: skip review, CI-check-only
- Notification if Codex unavailable >1 hour

### Best-Effort → Durable Writes

For orchestrated runs, critical DB writes (status, activity) retry on failure instead of swallowing errors.

### Circuit Breaker Persistence

Open/half-open state persisted in DB to survive restarts.

---

## 7. API Design

### Routes (separate Fastify plugin: `src/api/symphony/routes.ts`)

#### Configuration
| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/symphony/config | List project configs |
| GET | /api/symphony/config/:project_id | Get config |
| PUT | /api/symphony/config/:project_id | Create/update config |
| DELETE | /api/symphony/config/:project_id | Disable orchestration |

#### Project Resources
| Method | Path | Purpose |
|--------|------|---------|
| GET/POST/PATCH/DELETE | /api/symphony/projects/:id/repos | Repo CRUD |
| GET/POST/PATCH/DELETE | /api/symphony/projects/:id/hosts | Host CRUD |
| POST | /api/symphony/hosts/:host_id/drain | Start draining host |
| POST | /api/symphony/hosts/:host_id/activate | Re-enable host |

#### Tools
| Method | Path | Purpose |
|--------|------|---------|
| GET/POST/PATCH/DELETE | /api/symphony/tools | Tool config CRUD |

#### Runs
| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/symphony/runs | List with filters |
| GET | /api/symphony/runs/:id | Detail + provisioning + events + tokens |
| POST | /api/symphony/runs/:id/cancel | Request cancellation |
| POST | /api/symphony/runs/:id/retry | Manual retry from Paused |
| POST | /api/symphony/runs/:id/approve | Manual PR approval |
| POST | /api/symphony/runs/:id/merge | Manual merge trigger |
| GET | /api/symphony/runs/:id/events | Event stream (paginated) |
| GET | /api/symphony/runs/:id/terminal | Linked terminal IDs |

#### Dashboard
| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/symphony/status | Global status |
| GET | /api/symphony/queue | Next up with dispatch reasoning |
| POST | /api/symphony/queue/reorder | User override |
| POST | /api/symphony/refresh | Trigger immediate poll |
| GET | /api/symphony/hosts/health | Host health |

#### Sync & Ops
| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/symphony/sync/:project_id | Manual GitHub sync |
| GET | /api/symphony/sync/:project_id/status | Sync status |
| GET | /api/symphony/cleanup | CleanupFailed items |
| POST | /api/symphony/cleanup/:id/resolve | Mark resolved |
| GET | /api/symphony/metrics | Prometheus format |

#### WebSocket (authenticated, namespace-scoped)
| Path | Purpose |
|------|---------|
| ws /api/symphony/feed | Real-time events |

---

## 8. Database Schema

See full SQL in epic issues. Key design points:

- 14 new tables, all namespace-scoped
- `symphony_run_event` as TimescaleDB hypertable (weekly chunks, 90-day retention)
- 12 targeted indexes for claim, run, event, and cleanup queries
- Run idempotency via unique index on `(work_item_id, attempt)`
- Claim fencing via `claim_epoch` compare-and-swap
- Run manifest JSONB for reproducibility audit

---

## 9. UI Design

### New Pages

1. **Symphony Dashboard** (`/app/symphony`) — "Now" cards + "Next up" queue + global stats + alerts
2. **Project Symphony Config** (`/app/projects/:id/symphony`) — Full control panel
3. **Run Detail** (`/app/symphony/runs/:id`) — Provisioning timeline + terminal + events + cost
4. **Host Health** (`/app/symphony/hosts`) — Per-host status + containers + cleanup
5. **Tool Config** (`/app/symphony/tools`) — Agent profile management

### Status Card Requirements

Every run status card must show:
- **What**: current state and stage
- **Why**: specific blocked/paused reason
- **What Symphony tried**: auto-recovery actions taken
- **What user must do**: actionable instruction + one-click button
- **ETA**: estimated from historical data

### Notification Payload

```typescript
{
  run_id: string
  issue_identifier: string
  event: string
  severity: 'info' | 'warning' | 'critical'
  summary: string
  root_cause: string
  auto_actions_taken: string[]
  user_action_needed: string | null
  action_url: string | null
}
```

---

## 10. Observability

### Prometheus Metrics

```
symphony_runs_active{namespace, project, status}
symphony_runs_total{namespace, project, status}
symphony_provisioning_duration_seconds{step}
symphony_agent_duration_seconds{tool, project}
symphony_tokens_total{model, project, direction}
symphony_cost_usd_total{project}
symphony_github_api_calls_total{org, status}
symphony_github_rate_remaining{org}
symphony_host_active_sessions{host}
symphony_host_capacity_remaining{host}
symphony_retries_total{project, failure_class}
symphony_claims_total{project, result}
symphony_cleanup_items_pending
symphony_cleanup_backlog_age_seconds
symphony_orchestrator_heartbeat_age_seconds
```

### Structured Logging

Every log entry: `trace_id`, `run_id`, `issue_identifier`, `project_id`, `orchestrator_id`, `step` (if provisioning), `stage` (if running).

### Health Endpoint

Dedicated health server for orchestrator: DB connectivity, active runs, last poll time, circuit breaker states, uptime.

---

## 11. Infrastructure Prerequisites

These existing issues must be resolved before or alongside Symphony:

1. SSH session recovery (reconnect + tmux reattach)
2. Gateway unknown frame warning (not silent ignore)
3. Gateway init handshake validation
4. Gateway per-request timeout
5. Session affinity fail-closed (not localhost fallback)
6. Credential command allowlisting
7. Credential cache bounded LRU with TTL
8. dev_session user_email → namespace-based queries
9. dev_session.status CHECK constraint
10. terminal_session_entry (session_id, sequence) index
11. HTTP enrollment rate limiting
12. Circuit breaker state persistence

---

## 12. Security Model

### Trust Boundaries

- Target repos are **untrusted** — devcontainer configs validated against allowlists
- Issue content is **untrusted** — sanitized before prompt construction
- Terminal I/O is **sensitive** — redacted before storage/embedding
- Agent processes are **sandboxed** — read-only mounts except worktree, no Docker socket
- SSH hosts are **trusted** — `host_key_policy` must be `strict` or `tofu` for Symphony

### Secret Handling

- 1Password integration via existing credential command provider
- Secrets deployed to hosts tracked with version + cleanup lifecycle
- Post-run .env cleanup
- Redaction patterns: `op://`, `ghp_`, `sk-ant-`, `ANTHROPIC_API_KEY=`, bearer tokens, plus project-specific .env keys

### Namespace Isolation

All Symphony tables namespace-scoped. WebSocket feed authenticated and namespace-filtered.

---

## 13. Migration Strategy

Phased approach:
1. Add nullable columns to `dev_session`, `terminal_session` — no behavioral change
2. Deploy columns, verify existing functionality
3. Deploy Symphony tables and orchestrator code
4. Update UI with Symphony pages
5. Never make breaking changes to existing tables in the same migration as new functionality
