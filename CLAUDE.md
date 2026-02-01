# CLAUDE.md — clawdbot-projects

You are Claude Code working in `troykelly/clawdbot-projects`.

This repo is intended to be maintained by both humans and automated agents. The process rules below are **non-negotiable**.

## Mandatory source docs (read first)

1) **Dev Runbook:** `/home/moltbot/molt/dev/DEV-RUNBOOK.md`
2) **Agentic Coding Rules:** `/home/moltbot/molt/shared/CODING.md`
3) Repo-local guidelines: `AGENTS.md` (this repo)
4) **Frontend work:** `docs/knowledge/frontend-2026.md` (MUST read for any frontend/UI changes)

If you have not read them in this environment, stop and read them.

## Non‑negotiable workflow

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
  - Examples: API endpoints a UI component will need, follow-up refactors, known limitations to address later.

- **TDD + real verification**
  - Write failing tests first.
  - Run tests locally before pushing.
  - If the dev environment provides real services (Postgres), include integration coverage against the real service.

- **Type safety**
  - Avoid `any`.
  - Use `unknown` only at trust boundaries and narrow immediately.

- **No silent failures**
  - Handle errors explicitly and add context.
  - Don’t log secrets or PII.

## Tooling responsibilities

- **Claude Code is for implementation only.**
- **Codex CLI is for review only** (security + blind spot pass).
- For long-running autonomous work across multiple issues, use **ralph-loop** per the runbook:
  - always set `--max-iterations`
  - only emit the completion promise when the work is truly complete

## Devcontainer / environment

- dev-major must work inside the repo devcontainer.
- The devcontainer must load `GITHUB_TOKEN` and `GITHUB_TOKEN_TROY` from a local `.env` (not committed) per the runbook.

## Commit discipline

- Small, atomic commits, each passing local tests.
- Commit message format: `[#NN] Brief description of change`.

## If you get blocked

- Do not keep hacking.
- Write down the blocker in the issue, create a dedicated blocker issue if needed, and stop.
