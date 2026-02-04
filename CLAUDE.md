# CLAUDE.md — openclaw-projects

You are Claude Code working in `troykelly/openclaw-projects`.

This repo is intended to be maintained by both humans and automated agents. The process rules below are **non-negotiable**.

---

## What This Project Is

**openclaw-projects** is a **third-party project management, memory, and communications backend** designed for integration with [OpenClaw](https://docs.openclaw.ai/) — the open-source AI agent gateway.

> This is **not** part of OpenClaw itself. We build tools and integrations FOR OpenClaw agents.

### Primary Users: OpenClaw Agents

OpenClaw agents are the **primary consumers** of this API. They interact via:
- REST API calls to manage tasks, projects, memories, contacts
- Webhooks/hooks triggered by pgcron for scheduled reminders and nudges
- Inbound message processing (SMS via Twilio, Email via Postmark/Cloudflare)

### Secondary Users: Humans via Web UI

Humans interact with OpenClaw agents through messaging platforms (WhatsApp, Telegram, iMessage, Discord, SMS, Email). The web UI provides:
- Visual project/task management
- Memory browsing and search
- Contact management
- Activity feeds and timelines

### Core Use Cases

1. **Personal task management**: "Add asparagus to my shopping list", "Remind me to call mom tomorrow"
2. **Software development**: Epics, initiatives, issues for building apps with OpenClaw assistance
3. **Life projects**: Tiny home builds, renovations — giving agents visibility to help contextually
4. **Communication linking**: SMS/email arrives → OpenClaw links sender to M365/Google contacts
5. **Memory storage**: Agents store user preferences, context, relationships for personalized assistance

---

## Technical Architecture

### Database (PostgreSQL + Extensions)

| Extension | Purpose |
|-----------|---------|
| **pgvector** | Semantic memory search, relationship discovery, embedding storage |
| **pg_cron** | Scheduled hooks back to OpenClaw (reminders, nudges, recurring tasks) |
| **TimescaleDB** | Time-series data for activity, analytics |
| **PostGIS** | Location-aware features (optional) |

### Integration Points

| System | Integration |
|--------|-------------|
| **OpenClaw Gateway** | Hooks fire via HTTP when events occur (task due, reminder fires) |
| **Twilio** | Inbound SMS webhook → `external_message` + thread linking |
| **Postmark** | Inbound email webhook → message threading, magic link auth |
| **Cloudflare Email** | Alternative email routing |
| **M365/Google** | Contact sync and linking (planned) |

### Key Data Models

- **work_item**: Projects, epics, initiatives, issues, tasks (hierarchical)
- **contact / contact_endpoint**: People with multiple endpoints (email, phone, telegram, etc.)
- **external_message / external_thread**: Inbound/outbound communications
- **work_item_memory**: Contextual memories attached to work items
- **notification**: Agent-to-user and system notifications

---

## OpenClaw Hook Integration

This tool integrates with OpenClaw via the [hooks system](https://docs.openclaw.ai/hooks):

### Outbound Hooks (openclaw-projects → OpenClaw)

Triggered by pgcron jobs when:
- A reminder fires (`not_before` date reached)
- A deadline approaches (`not_after` date approaching)
- A scheduled nudge is due
- An inbound message needs agent attention

### Inbound API (OpenClaw → openclaw-projects)

Agents call our API to:
- Create/update/query work items
- Store and search memories (pgvector semantic search)
- Link contacts to external identities
- Log communications and context

---

## Memory Management with pgvector

Memories use pgvector for:
- **Semantic search**: "What does the user prefer for notifications?" → vector similarity
- **Relationship discovery**: Find related memories, contacts, work items
- **Context retrieval**: Bootstrap agent sessions with relevant history

Memory types:
- `preference`: User likes/dislikes, defaults
- `fact`: Known information about user or domain
- `decision`: Past decisions and rationale
- `context`: Situational context for ongoing work

---

## Mandatory Source Docs (read first)

1. **Development / Coding Runbook:** `CODING-RUNBOOK.md`
2. **Agentic Coding Rules:** `CODING.md`
3. **Repo-local guidelines:** `AGENTS.md` (this repo)
4. **Frontend work:** `docs/knowledge/frontend-2026.md` (MUST read for any frontend/UI changes)

If you have not read them in this environment, stop and read them.

---

## Non-negotiable Workflow

- **Issue-driven development only**
  - Every change maps to a GitHub issue with acceptance criteria.
  - If acceptance criteria are vague, refine them in the issue before coding.

- **Branch-only work**
  - Never commit to `main` directly.
  - Prefer `issue/<number>-<slug>` branch names.

- **One issue → one PR**
  - PR title should begin with `[#NN]`.
  - PR body must include `Closes #NN`.

- **No deferred work without tracking**
  - If you skip, defer, or TODO any work while completing an issue, you MUST create NEW GitHub issues for that work.
  - New issues MUST be in the same epic as the originating issue.
  - New issues MUST reference the originating issue (e.g., "Related to #85" or "Spun off from #85").
  - NEVER document future work only in the current issue's PR or comments—it will be lost when the issue closes.

- **TDD + real verification**
  - Write failing tests first.
  - Run tests locally before pushing.
  - If the dev environment provides real services (Postgres), include integration coverage against the real service.

- **Type safety**
  - Avoid `any`.
  - Use `unknown` only at trust boundaries and narrow immediately.

- **No silent failures**
  - Handle errors explicitly and add context.
  - Don't log secrets or PII.

---

## Tooling Responsibilities

- **Claude Code is for implementation only.**
- **Codex CLI is for review only** (security + blind spot pass).
- For long-running autonomous work across multiple issues, use **ralph-loop** per the runbook:
  - always set `--max-iterations`
  - only emit the completion promise when the work is truly complete
  - use templates from `docs/ralph-templates/` (issue, epic, iteration, initiative)

### Worktree Discipline (MANDATORY)

**Never work in the root repository directly.** All work MUST happen in isolated git worktrees in `/tmp`.

```bash
# Create worktree
git worktree add /tmp/worktree-issue-<NUMBER>-<slug> -b issue/<NUMBER>-<slug>
cd /tmp/worktree-issue-<NUMBER>-<slug>

# After PR merged, clean up
cd <REPO_ROOT>
git worktree remove /tmp/worktree-issue-<NUMBER>-<slug>
git branch -d issue/<NUMBER>-<slug>
```

This enables parallel agents and prevents filesystem conflicts. See `AGENTS.md` for full worktree policy.

---

## Devcontainer / Environment

- dev-major must work inside the repo devcontainer.
- The devcontainer must load `GITHUB_TOKEN` and `GITHUB_TOKEN_TROY` from a local `.env` (not committed) per the runbook.

### Package Manager: pnpm ONLY

- **NEVER use `npm` or `npx`.** This project uses `pnpm` exclusively.
- Use `pnpm run <script>`, `pnpm exec <bin>`, `pnpm add`, `pnpm install`, etc.
- All scripts in `package.json` are invoked via `pnpm run <name>`.

---

## Commit Discipline

- Small, atomic commits, each passing local tests.
- Commit message format: `[#NN] Brief description of change`.

---

## If You Get Blocked

- Do not keep hacking.
- Write down the blocker in the issue, create a dedicated blocker issue if needed, and stop.
