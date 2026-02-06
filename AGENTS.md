# AGENTS.md — openclaw-projects

This repo is worked on by humans and automated agents.

If you are an automated agent (including dev-major/dev-adhoc, Claude Code, Codex CLI, or ralph-loop), you **must** follow the rules below.

---

## What This Project Is

**openclaw-projects** is a **third-party backend service** designed for integration with [OpenClaw](https://docs.openclaw.ai/) — providing project management, memory storage, and communications handling for AI agents.

> This is NOT part of OpenClaw itself. We build integrations FOR OpenClaw.

### Who Uses This API

| User | How They Interact |
|------|-------------------|
| **OpenClaw Agents** (primary) | REST API for tasks, memories, contacts; receive hooks for reminders/notifications |
| **Humans** (secondary) | Web UI for visual management; messaging platforms via OpenClaw gateway |

### What This System Does

1. **Work Item Management**: Hierarchical tasks (projects → epics → initiatives → issues → todos)
2. **Memory Storage**: pgvector-powered semantic search for agent memories and context
3. **Contact Management**: Link identities across platforms (phone, email, Telegram, etc.)
4. **Communications**: Process inbound SMS (Twilio) and Email (Postmark/Cloudflare)
5. **Scheduled Hooks**: pgcron triggers webhooks to OpenClaw for reminders and nudges

### Example Interactions

- User says "Add milk to my shopping list" → Agent calls POST `/api/work-items` with parent=shopping-list
- User says "Remind me about the dentist Tuesday" → Agent creates work item with `not_before` date
- SMS arrives from unknown number → System creates contact, links thread, notifies agent via hook
- Agent needs context → Queries `/api/memories/search` with embedding for semantic match

---

## OpenClaw Integration

### Hooks (docs.openclaw.ai/hooks)

This system **sends hooks to OpenClaw** when:
- Reminder fires (pgcron job triggers on `not_before` date)
- Deadline approaches (`not_after` date within threshold)
- Inbound message needs agent attention
- Scheduled nudge is due

### Agent Workspace Integration

OpenClaw agents have workspace files (`MEMORY.md`, `memory/YYYY-MM-DD.md`). This system provides:
- Persistent storage beyond workspace files
- Cross-session memory with semantic search
- Structured data (projects, contacts) that workspace markdown can't handle well

---

## Source of Truth (mandatory)

1. **Development / Coding Runbook:** `CODING-RUNBOOK.md`
2. **Agentic Coding Rules:** `CODING.md`
3. **Frontend Knowledge (mandatory for UI work):** `docs/knowledge/frontend-2026.md`

If these conflict, **ask Troy** before proceeding.

---

## Non-negotiables

- **Devcontainer-first (dev-major):** dev-major must work inside the repo devcontainer.
- **Issue-driven:** every change maps to a GitHub issue with clear acceptance criteria.
- **One issue → one PR:** a PR should close exactly one issue unless Troy explicitly approves bundling.
- **TDD:** write failing tests first; add meaningful coverage.
- **Local verification first:** run tests locally before relying on CI.
- **No secrets/PII:** never commit tokens, hostnames, personal info, or credentials.
- **Type safety:** avoid `any`; validate `unknown` at boundaries.

---

## Tooling Rules

- **Claude Code = implementation.**
- **Codex CLI = review (security + blind spots).**
- **Ralph (ralph-loop) = long-running sequential autonomy.**
  - If working through multiple issues autonomously, start ralph-loop with:
    - `--max-iterations` (required)
    - a strict completion promise emitted only when truly complete.
- **Agent Teams = parallel coordination (experimental).**
  - For parallel work across independent issues/epics, use Claude Code agent teams.
  - Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (set in devcontainer).
  - See the Agent Teams section below for rules and constraints.

---

## Worktree Discipline (MANDATORY)

**Never work in the root repository directly.** All work MUST happen in isolated git worktrees.

### Why Worktrees?

- Enables parallel agents to work on different issues simultaneously
- Prevents filesystem conflicts between concurrent workers
- Isolates work-in-progress from the main checkout
- Using `/tmp` keeps worktrees ephemeral and avoids polluting the workspace

### Worktree Rules

- Every worker MUST use its own git worktree in `/tmp` with naming pattern: `/tmp/worktree-issue-<number>-<slug>`
- Workers MUST NOT operate in the root repository directory
- One issue per worker, one branch per issue
- Worktrees MUST be cleaned up immediately after PR merge:
  ```bash
  git worktree remove /tmp/worktree-issue-<number>-<slug>
  git branch -d issue/<number>-<slug>
  ```

### Orchestrator vs Worker

When running parallel work:

| Role | Where It Runs | What It Does |
|------|---------------|--------------|
| **Orchestrator** | Root repository | Coordinates workers, updates GitHub Projects, serializes board updates |
| **Workers** | Isolated worktrees in `/tmp` | Implements issues, uses REST-only GitHub API (no GraphQL) |

### Worker API Constraints

Workers MUST NOT use:
- `gh api graphql`
- `gh project item-list`
- Any GitHub Projects/ProjectV2 queries

Workers SHOULD use REST-only endpoints:
- `gh api repos/<owner>/<repo>/issues/<num>`
- `gh api repos/<owner>/<repo>/issues/<num>/comments`
- `gh pr view <num> --json ...`
- `gh pr checks <num> --watch`

---

## Agent Teams (Experimental)

Agent teams coordinate multiple Claude Code instances working in parallel. A team lead manages a shared task list, spawns teammates, and synthesizes results. Teammates work independently, each in its own context window and worktree.

> **Prerequisite:** Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (set in devcontainer environment).

### When to Use Agent Teams

| Scenario | Tool |
|----------|------|
| Sequential single-issue work | Ralph-loop (no team needed) |
| Sequential multi-issue work | Ralph-loop sequential mode |
| 3+ independent issues that can parallel | **Agent teams** |
| Debugging with competing hypotheses | **Agent teams** |
| Code review from multiple perspectives | **Agent teams** |
| Quick focused subtask within a session | Subagents (Task tool) |

### Agent Teams vs Ralph-Loop vs Subagents

| Feature | Ralph-loop | Agent Teams | Subagents |
|---------|-----------|-------------|-----------|
| **Purpose** | Session persistence | Parallel coordination | Quick focused tasks |
| **Parallelism** | No (sequential) | Yes (multiple teammates) | Yes (within session) |
| **Communication** | N/A | Direct messaging between teammates | Report back to caller only |
| **Task tracking** | Manual | Shared task list with dependencies | None |
| **Token cost** | Low | High (each teammate = separate instance) | Medium |
| **Complementary** | Can wrap team lead | Can use with ralph-loop | Used by teammates |

### Team Structure

| Role | Where It Runs | What It Does |
|------|---------------|--------------|
| **Team Lead** | Root repository or coordination worktree | Creates team, spawns teammates, manages tasks, coordinates phases |
| **Teammates** | Isolated worktrees in `/tmp` | Implements issues, communicates via team messaging |

### Rules for Teammates

All existing worktree and worker rules apply to teammates:

- Each teammate MUST work in an isolated worktree in `/tmp`
- One issue per teammate (or one epic per teammate for iteration-scale work)
- REST-only GitHub API (no GraphQL) — same as worker constraints
- Teammates read `CLAUDE.md` automatically (and all referenced docs)
- Teammates do NOT inherit the lead's conversation history — include issue-specific context in spawn prompts
- Clean up worktrees after PR merge

### Team Lifecycle

1. **Create team** — lead uses TeamCreate to set up shared task list
2. **Create tasks** — lead creates tasks with dependencies (Phase 1 unblocked, Phase 2 blocked by Phase 1, etc.)
3. **Spawn teammates** — lead spawns teammates via Task tool with `team_name` parameter
4. **Teammates claim work** — teammates pick up unblocked, unassigned tasks
5. **Communication** — teammates message lead on completion or blockers
6. **Phase transitions** — when blocking tasks complete, dependent tasks auto-unblock
7. **Shutdown** — lead sends shutdown requests, teammates approve
8. **Cleanup** — lead runs TeamDelete after all teammates shut down

### Limitations

- No nested teams (teammates cannot create sub-teams)
- No session resumption for in-process teammates
- One team per session
- Split-pane mode not available in VS Code integrated terminal (use in-process mode)
- Token usage scales with number of active teammates
- Task status may lag — verify manually if work appears stuck

### Cost Guidance

Agent teams use significantly more tokens than sequential work. Use them when:

- 3+ issues can genuinely run in parallel
- Coordination benefits outweigh token costs
- Work items are self-contained enough to avoid file conflicts

For 2 issues or simple sequential work, ralph-loop alone is more cost-effective.

---

## Key Technical Patterns

### Memory APIs (pgvector)

When implementing memory features:
- Store embeddings with context metadata (memory_type, related entities)
- Support semantic search via cosine similarity
- Enable relationship discovery between memories, contacts, work items

### Hook Dispatch (pgcron)

When implementing scheduled features:
- Use `internal_job` table for job tracking
- Use `webhook_outbox` for reliable delivery
- pgcron triggers job processing at intervals

### Contact Linking

When implementing contact features:
- Contacts have multiple endpoints (email, phone, telegram, etc.)
- Endpoints are normalized for matching
- Support linking to external systems (M365, Google) via OAuth

### Inbound Messages

When implementing communication features:
- Messages belong to threads
- Threads link to contacts via endpoints
- Support work item linking for context

---

## Required Hygiene

- Update the GitHub issue as you work (start, progress, blockers, completion).
- Commit messages must be atomic and reference the issue:
  - `[#NN] Brief description`
- PR description must include:
  - `Closes #NN`
  - local test commands run
  - any migration notes

---

## Stop Conditions

- If blocked, do **not** thrash.
- Create a blocker issue and link it from the parent issue.
- If unsure, stop and ask Troy.
