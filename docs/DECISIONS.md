# Decisions

- Identifiers: prefer UUIDv7 (Troy request).
- Webhooks: DB schedules internal callbacks; backend performs outbound notifications.
- Repo is public: no secrets or personal info committed.

## UUIDs

- Use **UUIDv7** everywhere.
- Generation: **Postgres 18 native UUIDv7 generation function** (`uuidv7()`, RFC 9562), not app-generated.
- App-facing helper: **`new_uuid()`** SQL function (wrapper around `uuidv7()`) so app code can depend on a stable name.

## Internal scheduling + outbox (pg_cron)

We use **Postgres** to schedule *internal intent* (nudges, digests, escalations) and a durable **outbox** for outbound notifications.

- **DB responsibilities**:
  - Decide *what* should happen and *when*.
  - Record intent durably in tables:
    - `internal_job` for internal callbacks/work.
    - `webhook_outbox` for outbound delivery attempts.
  - Run a `pg_cron` entry (`internal_nudge_enqueue`) that calls `enqueue_due_nudges()` on a cadence.

- **Backend responsibilities**:
  - Drain due rows using a locking strategy (`FOR UPDATE SKIP LOCKED`) via `internal_job_claim(...)`.
  - Perform provider-specific side effects (email/SMS/webhooks/etc).
  - Mark success/failure (`internal_job_complete(...)` / `internal_job_fail(...)`).

This keeps the DB provider-agnostic while allowing reliable, at-least-once processing.

## External system links

- Internal work items can be linked to external entities (initially GitHub: repo/issues/PRs/projects).
- Sync should be explicit and predictable (start with internal → GitHub updates).

## Assignment / agent identity

- Use a dedicated **agent identity user** for assignment: **Quasar**.
