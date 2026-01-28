# ADR 0001: Database access and migrations strategy

- Status: accepted
- Date: 2026-01-28
- Related:
  - Issue #8: Tech choice: ORM + migrations/rollback strategy
  - docs/schema.md

## Context

This service is a Postgres-backed system with a migration-first workflow. Today:

- The API is Node.js/TypeScript (Fastify).
- The DB driver is `pg`.
- Migrations are stored as SQL under `migrations/`.
- The repo already documents the dependency on the **golang-migrate** CLI.

We need to decide whether to adopt an ORM (and which one), and define a clear migration + rollback approach that:

- keeps schema changes reviewable and deterministic,
- supports safe rollbacks,
- works well in CI/devcontainers,
- avoids a “magic” state hidden in app code.

## Decision

### ORM

We will **not** adopt a full ORM at this stage.

Instead, we will:

- keep using **`pg`** for database access,
- keep schema as **SQL-first**, with queries written explicitly,
- optionally introduce a lightweight query builder later if/when pain appears (e.g. Kysely), but not as part of Issue #8.

Rationale:

- The project is already migration-first; a schema-driven ORM would either duplicate schema definitions or force a toolchain switch.
- SQL is the lingua franca of Postgres and makes review/debugging/incident response easier.
- The current scope is still evolving; avoiding ORM lock-in keeps iteration fast.

### Migrations tool

We will standardize on **SQL-first migrations**, with **golang-migrate** (CLI `migrate`) as the primary operator tool.

- Migrations live in `migrations/` as ordered SQL pairs:
  - `NNNN_description.up.sql`
  - `NNNN_description.down.sql`
- The application runtime does **not** run migrations automatically.
  - Migrations are executed explicitly via `pnpm migrate:up` / `pnpm migrate:down`.
- **Tests/CI** may apply migrations using the repo’s internal migrator (`tests/helpers/migrate.ts`) to avoid an external `migrate` binary dependency.

### Rollback strategy

Rollbacks are handled via **explicit `down` migrations**, with the following rules:

1. Every `up` migration **must** have a corresponding `down` migration.
2. `down` migrations must be safe and as deterministic as possible.
3. Destructive changes require a two-phase approach:
   - Phase 1: add new structures + backfill + dual-write/read.
   - Phase 2: remove old structures only after the app no longer depends on them.
4. Data-loss rollbacks are allowed only when the forward migration is additive-only or when the data-loss is explicitly accepted.

## Consequences

### Positive

- Minimal new tooling; aligns with current repo state.
- Clear, reviewable schema history in SQL.
- Easier Postgres-native features adoption (UUIDv7, triggers, constraints).

### Negative

- More manual query writing (no ORM convenience).
- Type safety across SQL ↔ TS requires discipline; may need patterns/helpers as the codebase grows.

## Implementation notes

- Keep `DATABASE_URL` as the single source of truth for DB connectivity.
- CI/devcontainer should provide Postgres and a consistent `DATABASE_URL`.
- If we later introduce a query builder (e.g. Kysely), it should be additive and must not become the schema source of truth.
