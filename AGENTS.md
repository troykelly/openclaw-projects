# AGENTS.md — clawdbot-projects

This repo is worked on by humans and automated agents.

If you are an automated agent (including dev-major/dev-adhoc, Claude Code, Codex CLI, or ralph-loop), you **must** follow the rules below.

---

## What This Project Is

**clawdbot-projects** is the backend service for [OpenClaw](https://docs.openclaw.ai/) — providing project management, memory storage, and communications handling for AI agents.

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
- **Ralph (ralph-loop) = long-running autonomy.**
  - If working through multiple issues autonomously, start ralph-loop with:
    - `--max-iterations` (required)
    - a strict completion promise emitted only when truly complete.

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
