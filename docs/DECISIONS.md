# Decisions

- Identifiers: prefer UUIDv7 (Troy request).
- Webhooks: DB schedules internal callbacks; backend performs outbound notifications.
- Repo is public: no secrets or personal info committed.

## UUIDs

- Use **UUIDv7** everywhere.
- Generation: **Postgres 18 native UUIDv7 generation function** (`uuidv7()`, RFC 9562), not app-generated.
- App-facing helper: **`new_uuid()`** SQL function (wrapper around `uuidv7()`) so app code can depend on a stable name.

## External system links

- Internal work items can be linked to external entities (initially GitHub: repo/issues/PRs/projects).
- Sync should be explicit and predictable (start with internal → GitHub updates).

## Assignment / agent identity

- Use a dedicated **agent identity user** for assignment: **Quasar**.
