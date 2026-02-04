# openclaw-projects

A Postgres-backed project management, memory, and communications backend designed for integration with [OpenClaw](https://docs.openclaw.ai/) AI agents.

> **Note:** OpenClaw (the AI agent gateway we integrate with) was previously known as "Clawdbot" and "Moltbot". This project was originally named `clawdbot-projects` but has been renamed to `openclaw-projects` to align with the current OpenClaw branding.

## What This Is

**openclaw-projects** is a **third-party backend service** that provides OpenClaw agents with:

- **Project Management**: Projects, epics, initiatives, issues, and tasks with full hierarchy
- **Memory System**: Long-term memory storage with pgvector semantic search
- **Communications**: SMS (Twilio) and email (Postmark) integration
- **Contact Management**: Contact storage with endpoint linking (email, phone, etc.)

This is **not** part of OpenClaw itself — it's an independent project that OpenClaw agents can connect to via the `@troykelly/openclaw-projects` plugin.

## Features

- Projects contain initiatives → epics → issues/tasks
- Standalone tasks not attached to a project (but still participating in dependencies)
- Full dependency graph: blocks/blocked-by across all item types
- Multi-user roles per item (owner/assignee/watcher/etc)
- Priorities (P0, P1, …)
- Task types (coding/dev/admin/etc)
- Scheduling constraints: not_before / not_after
- Dashboard at `/dashboard` with magic-link login (15 min link), 7-day sessions
- Semantic memory search via pgvector
- Inbound/outbound messaging (SMS, email)

## Architecture

- **Postgres 18** with extensions:
  - pgvector (semantic search)
  - pg_cron (scheduled hooks)
  - TimescaleDB (time-series)
  - PostGIS (optional, location-aware features)
- **Node.js/TypeScript** backend API
- Web dashboard (planned)
- **OpenClaw Plugin** (`packages/openclaw-plugin`) for agent integration

## OpenClaw Integration

OpenClaw agents connect to this backend via the plugin:

```bash
pnpm add @troykelly/openclaw-projects
```

The plugin provides tools for memory, projects, todos, and contacts that agents can use during conversations. See [packages/openclaw-plugin/README.md](packages/openclaw-plugin/README.md) for details.

## Operations

See `ops/README.md` for the production Docker Compose deployment runbook (including Traefik wiring).

## Development

- **Issue-driven development:** every change is tied to a GitHub issue
- **TDD:** tests written first
- See `CLAUDE.md` for full development guidelines

## Links

- [OpenClaw Documentation](https://docs.openclaw.ai/)
- [Plugin Documentation](packages/openclaw-plugin/README.md)
- [Report Issues](https://github.com/troykelly/openclaw-projects/issues)
