# clawdbot-projects

A Postgres-backed project + task management system intended to be used collaboratively by humans (e.g. Troy, Matty) and Clawdbot.

## Goals

- Projects contain initiatives → epics → issues/tasks
- Standalone tasks not attached to a project (but still participating in dependencies)
- Full dependency graph: blocks/blocked-by/etc across all item types
- Multi-user roles per item (owner/assignee/watcher/etc)
- Priorities (P0, P1, …)
- Task types (coding/dev/admin/etc)
- Scheduling constraints: not_before / not_after
- Dashboard at `/dashboard` with magic-link login (15 min link), 7-day sessions

## Architecture (planned)

- **Postgres 18** (+ extensions: TimescaleDB, PostGIS, pg_cron, pgvector, plus additional standard extensions as needed)
- Backend API (TBD language)
- Web dashboard

## Operations

See `ops/README.md` for the production Docker Compose deployment runbook (including Traefik wiring).

## Development rules

- **Issue-driven development:** every change is tied to a GitHub issue.
- **TDD:** tests written first.

## Status

Scaffolding / design stage.
