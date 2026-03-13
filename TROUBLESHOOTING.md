# TROUBLESHOOTING.md — openclaw-projects

**Mandatory protocol for ALL issue handling by agents in this repository.**

This document is paired with `CLAUDE.md`, `CODING.md`, `CODING-RUNBOOK.md`, and `AGENTS.md`. All rules here are **NON-NEGOTIABLE**.

---

## The Core Problem

Agents have a tendency to:
- Skip over issues, intending to "come back later"
- Forget issues after context compaction
- Apply temporary fixes instead of real solutions
- Leave issues undocumented

**This stops now.**

---

## The Protocol (MANDATORY)

When you encounter ANY issue — build failure, test failure, unexpected behavior, configuration error, deprecation warning, CI failure, anything — follow this protocol **IMMEDIATELY**.

### Step 1: Issue Found

An issue is ANY of the following:
- Build errors or warnings
- Test failures
- CI/CD pipeline failures
- Runtime errors or exceptions
- Unexpected behavior
- Configuration issues
- Deprecation warnings
- Performance problems
- Security vulnerabilities
- Migration failures
- Database connection or query errors
- Hook dispatch failures
- Documentation gaps that block work

**Severity and priority do NOT matter.** All issues follow this protocol.

### Step 2: Document IMMEDIATELY

**IMMEDIATELY** create or update a GitHub issue:

```bash
# Create new issue
gh issue create --title "[Component] Brief description" --body "
## Problem
[Clear description of what's broken]

## Current Behavior
[What happens now]

## Expected Behavior
[What should happen]

## Steps to Reproduce
1. [Step one]
2. [Step two]

## Context
- Branch: [branch name]
- Commit: [commit hash]
- Relevant files: [list]
"

# OR update existing issue
gh issue comment <number> --body "
## Update: [timestamp]
[New findings, progress, or blockers]
"
```

**NO EXCEPTIONS.** Do not continue work until the issue is documented.

### Step 3: Research Team IMMEDIATELY

**IMMEDIATELY** spawn an agent team to:
1. **Complete issue documentation** — add missing details, reproduction steps, error messages
2. **Research codebase** — identify all code areas that might contribute to the issue
3. **Research online** — find CURRENT documentation and best practices for the affected technology
4. **Document findings** — update the GitHub issue with all research findings

Example:
```bash
# Use TeamCreate + Task tool to spawn research team
# Team should update the GitHub issue with findings
# Team should identify specific files/functions to inspect
# Team should link to relevant external documentation
```

**Do not skip this step.** Even if you think you know the fix, research might reveal deeper issues or better solutions.

### Step 4: Decide — Defer or Fix Now

Ask yourself: **Does current work TRULY supersede fixing this issue?**

Valid reasons to defer:
- The current work is a blocker fix that prevents ALL other work
- The current work is a security incident response
- The current work unlocks the issue fix (e.g., need to merge a dependency upgrade first)

**NOT valid reasons:**
- "I don't want to divert"
- "It's a small issue"
- "I'll remember to come back"
- "I'm almost done with this"
- "It might fix itself"

**Default to fix now.** If in doubt, fix now.

If you defer:
- Add a `status: deferred` label to the issue
- Add a comment explaining WHY it's deferred and WHEN you'll return
- Add the issue number to your current work notes
- Set a reminder to check after current work completes

### Step 5: Fix Team (If Not Deferred)

**IMMEDIATELY** task an agent team with shipping a **REAL PRODUCTION FIX**.

Not:
- Proof of concept
- MVP
- Band-aid
- Workaround
- "Good enough for now"

A real production fix means:
- Root cause identified and resolved
- Tests added to prevent regression
- Documentation updated if needed
- CI passes
- Code review completed
- Works in production environment

#### Step 5.a: Keep Issue Updated

The fix team MUST update the GitHub issue with:
- Work in progress
- Findings from investigation
- Proposed solution approach
- Implementation progress
- Test results
- Blockers encountered

Update frequency: **at least once per major step**.

### Step 6: Follow CODING-RUNBOOK.md

The fix team MUST follow `CODING-RUNBOOK.md` completely:
- Create worktree for issue
- Work in issue branch
- Write/update tests
- Run codex MCP code review
- Monitor CI pipeline
- Follow merge protocol
- Clean up worktree

#### Step 6.a: Keep Issue Updated

Update the GitHub issue with:
- PR created: `#<number>`
- CI status: passing/failing
- Code review status: pending/approved
- Merge status: merged/blocked
- Deployment status: deployed/pending

### Step 7: Resolution

Once the fix is merged and deployed:

1. **Verify fix in production** (if applicable)
2. **Update issue** with final status
3. **Close issue** with comment: "Fixed in #<PR number>, verified in production"
4. **Clean up worktree** and branch
5. **Update project memory** if the issue revealed a pattern or learning

### Step 8: Resume Previous Work

NOW you can resume the work you were doing before the issue was found.

---

## Special Cases

### Multiple Issues Found

If you find multiple issues:
1. Document ALL issues first (Step 2 for each)
2. Spawn ONE research team to investigate all (Step 3)
3. Decide priority order (Step 4 for each)
4. Fix in priority order (Steps 5-7 for each)

### Cascade Issues

If fixing one issue reveals another:
1. **STOP** the current fix
2. Document the new issue (Step 2)
3. Research the new issue (Step 3)
4. Decide if new issue blocks current fix
5. If yes: fix new issue first
6. If no: defer new issue, finish current fix, then fix new issue

### Issues During Code Review

If codex MCP review finds issues:
1. Document each issue in the PR's GitHub issue (Step 2)
2. Research if needed (Step 3)
3. Fix ALL issues before merging (Steps 5-7)
4. Re-run codex review
5. Do NOT merge until codex review passes

### CI Failures

CI failures are issues. Follow the full protocol:
1. Document the CI failure in issue (Step 2)
2. Research the failure (Step 3)
3. Fix now (Steps 5-7) — CI failures are NEVER deferred
4. Do NOT merge until CI passes

---

## Forbidden Behaviors

**NEVER:**
- Say "I'll come back to this"
- Add `// TODO: fix this later`
- Comment out failing tests
- Disable CI checks
- Skip code review because "it's urgent"
- Merge with failing tests
- Merge with CI failures
- Apply workarounds without documenting root cause
- Close issues without verification

**These are firing offenses for agents.**

---

## Context Compaction Survival

Before context compaction, the system will preserve:
- GitHub issues (external to conversation)
- Worktree state (filesystem)
- Git branches (external to conversation)
- CI status (external to conversation)

**This is why we document IMMEDIATELY.** Issues in conversation history will be lost. Issues in GitHub survive.

---

## Success Criteria

You're following this protocol correctly when:
- Every issue has a GitHub issue number
- Every issue has research documented
- No "I'll come back" comments in code or conversation
- No untracked TODOs
- CI always passes
- All merged code has been reviewed
- Issues are closed with verification evidence

---

## Local Test Suite Isolation (DB State Contamination)

### Problem

Running `pnpm test` (unit + integration combined) **consecutively** in the devcontainer can produce ~216 spurious failures across ~74 test files. These failures are **not real bugs** — CI on `main` is consistently green.

**Root cause:** Integration tests share the single devcontainer PostgreSQL instance. Each integration test file runs `truncateAllTables()` in `beforeEach`, but when the entire suite is re-run without a Postgres restart, residual state (especially around sequences, deduplication tables, and notification state) bleeds across runs.

### Known Failure Clusters

| Test file | Failure pattern |
|-----------|----------------|
| `src/api/memory/deduplication.test.ts` | ID mismatch from stale `notification_dedup` rows |
| `src/api/memory/core-api.test.ts` | Upsert-by-tag logic collides with stale memory rows |
| `src/api/prompt-template/service.test.ts` | Deadlock in test setup (`TRUNCATE` vs server pool lock) |
| `tests/ui/chat-rich-card.test.tsx` | `window is not defined` — jsdom env not initialized (unit test leaking into integration runner) |

### Workaround: Run Tests Separately

Instead of `pnpm test` (which runs unit + integration in one process), run the two projects independently:

```bash
# Unit tests only — no DB, always reliable, runs in parallel
pnpm test:unit

# Integration tests only — runs serially against real Postgres
pnpm test:integration

# Clean DB state first, then run integration (most reliable locally)
pnpm test:clean

# Targeted run before pushing — fastest feedback loop
pnpm exec vitest run src/api/memory/deduplication.test.ts
```

**Trust CI as the final arbiter.** If your tests pass in CI, the code is correct — consecutive local `pnpm test` failures from this pattern do not block shipping.

### `pnpm test:clean` Script

`pnpm test:clean` resets DB state before running unit then integration tests. It:

1. Runs `scripts/reset-test-db.sh` — truncates all application tables with `RESTART IDENTITY CASCADE`
2. Runs `pnpm test:unit` (parallel, no DB)
3. Runs `pnpm test:integration` (serial, real Postgres)

```bash
pnpm test:clean
```

The script (`scripts/reset-test-db.sh`) connects using the same `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` environment variables as the test helpers (`tests/helpers/db.ts`).

**Safety gate:** The script checks `PGDATABASE` against a known-safe allowlist (`openclaw`, `openclaw_test`, `openclaw_ci`, `test`, `postgres`). It refuses to run if the name is not on the list. Note that this is a name-based check only — it does not verify the host, so if your `PGHOST` happens to point at a staging or production server whose database is also named `openclaw`, the script will proceed. Always confirm your shell's `PGHOST` and `PGPORT` are pointing at your local devcontainer Postgres before running. Customise the allowlist via `RESET_DB_SAFE_NAMES`.

### When to Use Each Command

| Situation | Command |
|-----------|---------|
| Active development — iterative feedback | `pnpm test:changed` |
| Checking unit tests only | `pnpm test:unit` |
| Checking integration tests only | `pnpm test:integration` |
| Full suite, clean DB state | `pnpm test:clean` |
| Before pushing a branch | `pnpm test:clean` then verify CI |
| Investigating one failing file | `pnpm exec vitest run <file>` |

### Why `pnpm test` Still Exists

`pnpm test` runs both vitest projects in a single process and is retained for compatibility. CI does NOT call it directly — CI calls `pnpm test:unit` and `pnpm test:integration` as separate steps (see `.github/workflows/ci.yml`). Unit tests do not touch Postgres at all, so when integration tests run next they start against a clean database that has only been initialised by migrations. This prevents consecutive-run contamination. `pnpm test:clean` mirrors that CI behaviour locally by explicitly truncating all tables before running each project.

### Sequence Diagram

```
pnpm test        →  [unit project] + [integration project] in one vitest run
                    ↳ Second consecutive run: stale DB state → ~216 failures

CI               →  pnpm test:unit   (no DB access — always clean)
                    pnpm test:integration  (same devcontainer Postgres, but
                      unit tests never wrote to it, so integration starts clean)
                    ↳ No contamination possible

pnpm test:clean  →  reset-test-db.sh (TRUNCATE all tables, RESTART IDENTITY)
                    → pnpm test:unit   (no DB access)
                    → pnpm test:integration  (DB is now clean)
                    ↳ Mirrors CI isolation locally — always reliable
```

---

## Questions?

There are no questions. This is the protocol. Follow it.
