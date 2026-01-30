# AGENTS.md — clawdbot-projects

This repo is worked on by humans and automated agents.

If you are an automated agent (including dev-major/dev-adhoc, Claude Code, Codex CLI, or ralph-loop), you **must** follow the rules below.

## Source of truth (mandatory)

1. **Dev Runbook (mandatory):** `/home/moltbot/molt/dev/DEV-RUNBOOK.md`
2. **Coding Rules (mandatory):** `/home/moltbot/molt/shared/CODING.md`

If these conflict, **ask Troy** before proceeding.

## Non‑negotiables

- **Devcontainer-first (dev-major):** dev-major must work inside the repo devcontainer.
- **Issue-driven:** every change maps to a GitHub issue with clear acceptance criteria.
- **One issue → one PR:** a PR should close exactly one issue unless Troy explicitly approves bundling.
- **TDD:** write failing tests first; add meaningful coverage.
- **Local verification first:** run tests locally before relying on CI.
- **No secrets/PII:** never commit tokens, hostnames, personal info, or credentials.
- **Type safety:** avoid `any`; validate `unknown` at boundaries.

## Tooling rules

- **Claude Code = implementation.**
- **Codex CLI = review (security + blind spots).**
- **Ralph (ralph-loop) = long-running autonomy.**
  - If working through multiple issues autonomously, start ralph-loop with:
    - `--max-iterations` (required)
    - a strict completion promise emitted only when truly complete.

## Required hygiene

- Update the GitHub issue as you work (start, progress, blockers, completion).
- Commit messages must be atomic and reference the issue:
  - `[#NN] Brief description`
- PR description must include:
  - `Closes #NN`
  - local test commands run
  - any migration notes

## Stop conditions

- If blocked, do **not** thrash.
- Create a blocker issue and link it from the parent issue.
- If unsure, stop and ask Troy.
