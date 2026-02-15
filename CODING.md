# Agentic Coding Rules

These principles are **non-negotiable**. They apply to all contributors — human and automated.

## Issue-Driven Development

- Every change requires a corresponding GitHub issue
- Create the issue before starting work if one doesn't exist
- Issues must include **acceptance criteria** (how to know it’s done)
- Update the issue with progress, decisions, and blockers as work proceeds — not after completion
- This makes work resumable by any contributor at any point

## Test-Driven Development

- Write failing tests **before** implementation code
- Tests must cover expected usage, edge cases, and error conditions
- "Minimal TDD to satisfy TDD" is not acceptable — coverage must be meaningful
- Run tests frequently during development, not just at completion
- Commit only when tests pass

### Test commands for development

| Command | When to use |
|---------|-------------|
| `pnpm test:changed` | **During active development** — runs only tests affected by uncommitted changes |
| `pnpm test:unit` | Quick feedback — pure tests (no DB), runs in parallel |
| `pnpm test:integration` | DB-dependent tests — runs serially |
| `pnpm test` | **Before committing/pushing** — runs both unit + integration |
| `pnpm run test:e2e` | Level 2 E2E tests (requires Docker backend) |

Prefer `pnpm test:changed` during iterative development to keep the feedback loop fast. Always run `pnpm test` before pushing.

## Test Against Real Services

- If the dev environment provides services (databases, queues, caches), **integration tests must exercise them**
- Do not replace real-service integration coverage with mocks for local infrastructure
- Unit tests may mock infrastructure for speed/determinism, but merge requires real-service verification
- Migrations, queries, and integrations must be verified against actual services before committing

## Type Safety

- Avoid permissive types (`any`, overly broad unions) as a shortcut
- `unknown` is allowed at trust boundaries only if it is validated/narrowed immediately (schema/guards)
- Create explicit interfaces and types for all data structures
- Types are documentation — they should clarify intent and constraints
- `any` requires a comment with justification and a tracking issue

## Self-Documenting Code

- Use language-standard documentation (JSDoc, PyDoc, GoDoc, etc.)
- Document the **why**, not just the what
- Public interfaces require documentation — no exceptions
- If code needs a comment to explain what it does, consider refactoring first

## Separation of Concerns

- Each module, class, or function has one responsibility
- Business logic stays separate from infrastructure
- Keep I/O at the edges

## Idempotency

- Operations must be safe to retry
- Database migrations, resource creation, and state changes must handle re-runs gracefully
- Use upserts, existence checks, and deterministic identifiers where appropriate

## Error Handling

- No silent failures
- Catch errors explicitly and either handle them or propagate with added context
- Log meaningful information — include what operation failed and relevant identifiers — **without logging secrets/PII**
- Fail fast and visibly
- When you encounter ANY issue (build error, test failure, unexpected behavior), follow `TROUBLESHOOTING.md` immediately — no deferring, no "I'll come back to this"

## Configuration

- No hardcoded secrets, URLs, ports, or environment-specific values
- All configuration comes from environment variables or config files
- Defaults should be safe and explicit

## Preserve Existing Conventions

- Match the patterns, style, and structure already present in the codebase
- Consistency with the project trumps personal preference
- Check for existing utilities, helpers, and abstractions before creating new ones

## Incremental Verification and Atomic Commits

- Verify each step works before moving to the next (tests, typecheck, local run)
- Commit small, focused changes frequently (working states only)
- Each commit references its issue and is individually revertable
- Format: `[#issue] Brief description of change`

