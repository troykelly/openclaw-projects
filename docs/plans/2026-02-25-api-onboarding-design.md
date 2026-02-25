# API Onboarding & Memory System — Design Document

**Date:** 2026-02-25
**Status:** Approved
**Author:** Claude Code + Troy

---

## Summary

Add an API onboarding system to openclaw-projects that allows OpenClaw agents to ingest OpenAPI specs, decompose them into semantically searchable memories, and store credential resolution information — enabling agents to autonomously discover and call any API with a published OpenAPI spec.

## Problem

OpenClaw agents currently have no structured way to discover or learn how to call third-party APIs. Adding a new integration requires code changes. We want agents to be able to:

1. Onboard any API by providing its OpenAPI spec URL (or inline spec content)
2. Semantically search for API capabilities by intent ("get weather", "find train times")
3. Retrieve full call details (endpoint, parameters, auth) from search results
4. Manage credentials for autonomous API calling

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage | Separate `api_memory` system (not existing `memory` table) | API memories have structured metadata, credential linkage, and spec-refresh lifecycle that don't fit the general memory model |
| Data model | Three tables: `api_source`, `api_credential`, `api_memory` | Clean separation matching existing patterns (`contact`/`contact_endpoint`, `work_item`/`work_item_participant`) |
| Search | Dedicated `api_recall` tool, separate from `memory_recall` | Keeps concerns clean; agents explicitly search for APIs |
| Credential resolution | Agent resolves at call time (not Projects) | Projects stores resolution strategy + encrypted reference; agent reads it and resolves in its own runtime |
| Embedding text | Template-based (v1), with LLM enrichment path for later | Deterministic, fast, testable. Quality flag on weak descriptions enables targeted LLM improvement later |
| Spec refresh | Manual now, scheduled later | Data model includes `refresh_interval_seconds` and `last_fetched_at` for future pgcron integration |
| Tag groups | Must-have from v1 | Required for medium-granularity recall ("what transport endpoints exist?") |
| Parser library | `@apidevtools/swagger-parser` | Handles OpenAPI 2.0/3.0/3.1, dereferences `$ref`s, validates specs |

---

## Data Model

### `api_source`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | uuidv7() |
| `namespace` | text NOT NULL | Namespace scoping |
| `name` | text NOT NULL | Human-readable name ("Transport for NSW") |
| `description` | text | Auto-extracted from spec `info.description` |
| `spec_url` | text | URL to fetch spec (null if uploaded inline) |
| `servers` | jsonb NOT NULL | Array of `{url, description}` from spec `servers` block |
| `spec_version` | text | From spec `info.version` |
| `spec_hash` | text | SHA-256 of last fetched/parsed spec (for diff detection) |
| `tags` | text[] DEFAULT '{}' | User/agent-applied categorization tags |
| `refresh_interval_seconds` | integer | Future: pgcron scheduling. Null = manual only |
| `last_fetched_at` | timestamptz | When spec was last fetched |
| `status` | text DEFAULT 'active' | `active`, `disabled`, `error` |
| `error_message` | text | Last error if status = 'error' |
| `created_by_agent` | text | Agent that onboarded this API |
| `deleted_at` | timestamptz | Soft delete |
| `created_at` | timestamptz NOT NULL DEFAULT now() |
| `updated_at` | timestamptz NOT NULL DEFAULT now() |

### `api_credential`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | uuidv7() |
| `api_source_id` | uuid NOT NULL FK | References `api_source.id` ON DELETE CASCADE |
| `purpose` | text NOT NULL DEFAULT 'api_call' | `api_call` or `spec_fetch` |
| `header_name` | text NOT NULL | e.g. `Authorization`, `X-Api-Key` |
| `header_prefix` | text | e.g. `Bearer`, `Basic`, null for raw value |
| `resolve_strategy` | text NOT NULL | `literal`, `env`, `file`, `command` |
| `resolve_reference` | text NOT NULL | **Encrypted at rest** (AES-256-GCM via existing OAuth crypto) |
| `created_at` | timestamptz NOT NULL DEFAULT now() |
| `updated_at` | timestamptz NOT NULL DEFAULT now() |

Multiple rows per API source (one per header needed). All `resolve_reference` values are encrypted regardless of strategy (commands and file paths reveal infrastructure).

### `api_memory`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | uuidv7() |
| `api_source_id` | uuid NOT NULL FK | References `api_source.id` ON DELETE CASCADE |
| `namespace` | text NOT NULL | Denormalized from api_source for search filtering |
| `memory_kind` | text NOT NULL | `overview`, `tag_group`, `operation` |
| `operation_key` | text NOT NULL | Stable identifier for diff (see Operation Key Resolution) |
| `title` | text NOT NULL | e.g. "GET /v1/departures/{stop_id}" |
| `content` | text NOT NULL | Natural-language embedding text |
| `metadata` | jsonb NOT NULL DEFAULT '{}' | Structured operation spec (method, path, params, schemas) |
| `tags` | text[] DEFAULT '{}' | OpenAPI tags this memory relates to |
| `embedding` | vector(1024) | pgvector semantic search |
| `embedding_model` | text | Which model generated the embedding |
| `embedding_provider` | text | Which provider |
| `embedding_status` | text DEFAULT 'pending' | `pending`, `complete`, `failed` |
| `search_vector` | tsvector | Full-text search fallback |
| `created_at` | timestamptz NOT NULL DEFAULT now() |
| `updated_at` | timestamptz NOT NULL DEFAULT now() |

**Constraints:**
- UNIQUE(`api_source_id`, `operation_key`)

### `api_source_link`

| Column | Type | Notes |
|--------|------|-------|
| `api_source_id` | uuid NOT NULL FK | References `api_source.id` |
| `work_item_id` | uuid NOT NULL FK | References `work_item.id` |
| `created_at` | timestamptz NOT NULL DEFAULT now() |

**Constraint:** PK(`api_source_id`, `work_item_id`)

---

## Operation Key Resolution

Stable identifier for each memory, used for refresh/diff:

1. If spec provides `operationId` → use it directly (e.g., `getDepartures`)
2. Else → `METHOD:` + path with parameter names stripped (e.g., `GET:/v1/departures/{}`)
3. For tag groups: `tag:{tagName}`
4. For overview: `overview`
5. Uniqueness enforced by UNIQUE(`api_source_id`, `operation_key`). On collision, append suffix: `getDepartures_2`

---

## Credential Security

### Encryption at rest

All `resolve_reference` values encrypted using existing OAuth crypto module (`src/api/oauth/crypto.ts`):
- Algorithm: AES-256-GCM with per-row HKDF key derivation
- Master key: `OAUTH_TOKEN_ENCRYPTION_KEY` (reused, no new key)
- Salt: credential row UUID

### Credential resolution strategies

| Strategy | Reference value | Resolved by |
|----------|----------------|-------------|
| `literal` | The actual token value | Agent reads decrypted value directly |
| `env` | Environment variable name (e.g., `TFNSW_TOKEN`) | Agent reads from its environment |
| `file` | File path (e.g., `/run/secrets/tfnsw-token`) | Agent reads file |
| `command` | Shell command (e.g., `op read "op://Personal/TfNSW/credential"`) | Agent executes command |

Projects never executes stored commands — it only stores and returns them (decrypted) to the agent. The agent resolves credentials in its own runtime.

### Audit log redaction

Audit triggers on `api_credential` must redact `resolve_reference` in the `changes` JSONB. Logged as `[REDACTED]`.

### Credential masking in API responses

- Default: `resolve_reference` masked (e.g., `op read "op://...***"`)
- With write-scope authorization: full decrypted values returned

---

## Embedding Text Generation

### Principles

- **Intent-first**: Lead with what the operation does, not the API name
- **Business domain terms**: Include domain language for semantic matching
- **Inputs/outputs summarized**: Parameter names + descriptions, brief output description
- **Endpoint signature last**: Useful for keyword matching, not semantic discovery
- **Auth noted**: So agent knows requirements before attempting

### Operation template

```
{operation summary — what this does}.

{operation description — business context and details}.

Inputs: {param_name} ({description}, {required/optional}), ...

Returns: {brief output description from response schema}.

Endpoint: {METHOD} {path}
API: {api_name}
Tags: {tag1}, {tag2}
Auth: {auth requirement}
```

### Tag group template

```
{tag description or synthesized summary of operations in this group}.

{count} operations for {group purpose}:
- {operation 1 summary in natural language}
- {operation 2 summary in natural language}
- ...

API: {api_name} — {tag_name} group
Endpoints: {METHOD} {path}, {METHOD} {path}, ...
```

### Overview template

```
{API description from info.description — business context}.

{total_operations} operations across {group_count} groups:
- {tag1}: {natural language summary of tag group}
- {tag2}: {natural language summary of tag group}
- ...

API: {api_name}
Base URL: {primary server URL}
Auth: {auth requirement}
```

### Weak description fallback

For operations with no `description`:
1. Use `summary` field if available
2. Else synthesize from: path segments + parameter names + schema property names
3. Set `metadata.description_quality = "synthesized"` for future LLM enrichment

### Text construction for embedding

Following existing pattern: embedding generated from `title + "\n\n" + content`.

---

## Spec Text Sanitization

All spec-sourced text is sanitized before use in embedding content:

1. Strip HTML tags
2. Strip markdown link/image syntax (keep link text)
3. Remove lines matching injection patterns: "ignore previous", "ignore above", "system prompt", "you are", "act as", "pretend" (case-insensitive, log warning)
4. Normalize whitespace (collapse multiple newlines/spaces)
5. Remove control characters (same `sanitizeText` as embedding service)
6. Per-field truncation limits:
   - Operation description: max 1,000 chars
   - Parameter description: max 200 chars
   - API info.description: max 2,000 chars
   - Tag description: max 500 chars
7. If sanitization triggered, set `metadata.sanitization_applied = true`

---

## Schema Truncation Strategy

For `metadata` JSONB on `api_memory`:

1. Inline `$ref` schemas to depth 3
2. At depth 3+, replace with `{"$summary": "TypeName", "type": "object", "properties_count": N, "description": "..."}`
3. Strip `example` values from all schemas
4. Strip `x-` extension fields
5. If metadata > 48KB after truncation:
   a. Remove response schemas (keep only 200 response description)
   b. If still > 48KB, remove request body schema (keep description only)
   c. Log warning with `api_source_id` and `operation_key`

---

## REST API Endpoints

### API Source lifecycle

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/api-sources` | Onboard new API (accepts `spec_url` or `spec_content`) |
| `GET` | `/api/api-sources` | List API sources (namespace-scoped) |
| `GET` | `/api/api-sources/:id` | Get API source details |
| `PATCH` | `/api/api-sources/:id` | Update metadata (name, tags, status) |
| `DELETE` | `/api/api-sources/:id` | Soft-delete |
| `POST` | `/api/api-sources/:id/restore` | Restore soft-deleted source |
| `POST` | `/api/api-sources/:id/refresh` | Re-fetch spec, diff and update memories |

### Credentials

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/api-sources/:id/credentials` | Add credential |
| `GET` | `/api/api-sources/:id/credentials` | List credentials (masked by default) |
| `GET` | `/api/api-sources/:id/credentials/:cred_id` | Get single credential |
| `PATCH` | `/api/api-sources/:id/credentials/:cred_id` | Update credential |
| `DELETE` | `/api/api-sources/:id/credentials/:cred_id` | Remove credential |

### API Memory search

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/api-memories/search` | Semantic search across API memories |
| `GET` | `/api/api-sources/:id/memories` | List memories for a specific source |

### Work item linkage

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/api-sources/:id/links` | Link to work item |
| `DELETE` | `/api/api-sources/:id/links/:work_item_id` | Unlink |

All endpoints enforce namespace scoping via `verifyReadScope`/`verifyWriteScope`.

Deduplication: `POST /api/api-sources` checks `spec_url` within namespace. Returns existing source if duplicate.

SSRF: `spec_url` validated via existing `validateSsrf()`. HTTPS enforced in production.

---

## Plugin Tools

| Tool | Purpose |
|------|---------|
| `api_onboard` | Onboard new API from URL or inline spec, with optional credentials |
| `api_recall` | Semantic search for API capabilities (returns operations + credentials) |
| `api_get` | Direct lookup by source ID (config + credentials without searching) |
| `api_list` | List all onboarded APIs |
| `api_update` | Update source metadata, enable/disable |
| `api_credential_manage` | Add/update/remove credentials on existing source |
| `api_refresh` | Re-fetch spec and diff/update memories |
| `api_remove` | Soft-delete API source |
| `api_restore` | Restore soft-deleted API source |

All tools follow existing factory pattern: Zod schema → `createTool(options)` → `{ name, description, parameters, execute }`.

---

## Onboard Flow

```
1. Validate spec_url (SSRF check, HTTPS in production) or accept spec_content
2. Check deduplication (spec_url within namespace)
3. Resolve spec_fetch credentials (if provided)
4. Fetch spec via HTTP (or parse inline content)
5. Parse with swagger-parser (validate + dereference $refs)
6. Sanitize all text fields from spec
7. SHA-256 hash the raw spec → spec_hash
8. Extract API-level info → INSERT api_source
9. Store credentials → INSERT api_credential (encrypted)
10. Pass 1 — For each path+method operation:
    a. Resolve operation_key (operationId or METHOD:path)
    b. Generate embedding text from template
    c. Build metadata JSON (with schema truncation)
    d. INSERT api_memory (memory_kind='operation')
11. Pass 2 — For each unique tag:
    a. Aggregate operations in this tag
    b. Generate tag_group embedding text
    c. INSERT api_memory (memory_kind='tag_group')
12. Handle untagged operations → synthetic tag_group (tag:_untagged)
13. Generate overview embedding text → INSERT api_memory (memory_kind='overview')
14. Batch-generate embeddings for all api_memory rows
15. Return summary (counts, api_source_id)
```

Application-level cap: 200 operations per API source (configurable). Reject with descriptive error before creating records.

---

## Refresh / Diff Flow

```
1. Fetch new spec (same SSRF checks, same spec_fetch credentials)
2. SHA-256 hash → compare with api_source.spec_hash
3. If hash matches → no changes, return early
4. Parse and dereference new spec
5. Extract operations (keyed by operation_key)
6. Compare against existing api_memory rows:
   a. New keys not in DB → INSERT new api_memory rows
   b. Existing keys with changed content → UPDATE content + metadata, re-embed
   c. Existing keys not in new spec → DELETE those api_memory rows
   d. Tag groups → regenerate all (delete old, insert new)
   e. Overview → regenerate
7. Update api_source: spec_hash, spec_version, last_fetched_at, servers
8. Batch-embed new/updated memories
9. Return diff summary: { added: [...], updated: [...], removed: [...] }
```

---

## Search Implementation

Hybrid search (50% text + 50% semantic), matching existing memory search pattern:

- Semantic: cosine similarity via pgvector `<=>` operator on `embedding` column
- Text: PostgreSQL `plainto_tsquery` on `search_vector` tsvector column
- Results joined with `api_source` (for name, servers, status)
- Credentials fetched in secondary query by `api_source_id` (decrypted)
- Filters: `namespace`, `memory_kind`, `api_source_id`, `tags`
- Excludes: soft-deleted sources, disabled sources, memories without embeddings

---

## Error Handling

| Failure | Behaviour |
|---------|-----------|
| Spec URL unreachable | Set `api_source.status = 'error'`, store error, return error |
| Spec fails validation | Same — don't create memories for invalid spec |
| Partial embedding failure | Memories created with `embedding_status: 'failed'`, searchable via text fallback |
| Spec too large (>200 ops) | Reject before creating records |
| SSRF blocked URL | Reject immediately |
| Duplicate spec_url in namespace | Return existing api_source |

---

## Source Code Structure

### API server

```
src/api/api-sources/
  ├── routes.ts           — Fastify route registration
  ├── service.ts          — Business logic (CRUD, onboard, refresh, search)
  ├── parser.ts           — OpenAPI spec parsing + decomposition
  ├── embedding-text.ts   — Template-based embedding text generation
  ├── sanitizer.ts        — Spec text sanitization (injection protection)
  ├── credential-crypto.ts — Encrypt/decrypt wrapper over existing OAuth crypto
  └── types.ts            — TypeScript interfaces
```

### Plugin

```
packages/openclaw-plugin/src/tools/
  ├── api-onboard.ts
  ├── api-recall.ts
  ├── api-get.ts
  ├── api-list.ts
  ├── api-update.ts
  ├── api-credential-manage.ts
  ├── api-refresh.ts
  ├── api-remove.ts
  └── api-restore.ts

packages/openclaw-plugin/src/services/
  └── api-source-service.ts
```

---

## Testing Strategy

### Unit tests (parallel, no DB)

| Test file | Coverage |
|-----------|----------|
| `tests/api/api-sources/parser.test.ts` | OpenAPI parsing with fixture specs (minimal, rich, Swagger 2.0, nested schemas, no tags, adversarial) |
| `tests/api/api-sources/embedding-text.test.ts` | Template output for operations, tag groups, overviews, weak descriptions |
| `tests/api/api-sources/sanitizer.test.ts` | HTML stripping, injection detection, truncation, control char removal |
| `tests/api/api-sources/operation-key.test.ts` | operationId preference, fallback, param stripping, collision handling |

### Integration tests (serial, DB)

| Test file | Coverage |
|-----------|----------|
| `tests/api/api-sources/crud.test.ts` | API source CRUD, soft-delete, restore |
| `tests/api/api-sources/credentials.test.ts` | Credential CRUD, encryption/decryption, masking |
| `tests/api/api-sources/onboard.test.ts` | Full onboard flow with fixture specs and mocked HTTP/embeddings |
| `tests/api/api-sources/search.test.ts` | Semantic + text search, namespace scoping, filters |
| `tests/api/api-sources/refresh.test.ts` | Spec diff: added/updated/removed operations |
| `tests/api/api-sources/dedup.test.ts` | Duplicate spec_url handling |
| `tests/api/api-sources/links.test.ts` | Work item linkage |
| `tests/api/api-sources/audit.test.ts` | Audit log entries, credential redaction |

### Plugin contract tests

| Test file | Coverage |
|-----------|----------|
| `tests/openclaw-contract/api-tools.test.ts` | All 9 plugin tools: param validation, API calls, response formatting |

---

## Implementation Phases

### Phase 1: Data model + CRUD (foundation)

- Migrations 117, 118, 119
- `api_source` CRUD endpoints + soft delete/restore
- `api_credential` CRUD with encryption
- Audit triggers with credential redaction
- Tests: CRUD, credentials, encryption, audit

### Phase 2: Parser + embedding generation (core)

- Add `@apidevtools/swagger-parser` dependency
- Spec fetching with SSRF validation
- OpenAPI parsing + decomposition (two-pass)
- Embedding text generation templates
- Spec text sanitization
- Operation key resolution
- Schema truncation
- Full onboard endpoint (`POST /api/api-sources`)
- Tests: parser fixtures, sanitizer, embedding text, onboard integration

### Phase 3: Search + plugin tools (agent-facing)

- `api_recall` hybrid search endpoint
- All 9 plugin tools
- Plugin tool registration in `register-openclaw.ts`
- Plugin service layer
- Tests: search, plugin contract

### Phase 4: Refresh + links (lifecycle)

- Spec refresh + diff logic
- Work item linkage
- Inline spec support (`spec_content`)
- Deduplication check on onboard
- Tests: refresh, dedup, links

---

## New Dependencies

| Package | Purpose | Where |
|---------|---------|-------|
| `@apidevtools/swagger-parser` | Parse/validate/dereference OpenAPI 2.0/3.0/3.1 specs | Root `package.json` |

---

## Future Enhancements (not in scope)

- **Scheduled refresh** via pgcron (data model ready: `refresh_interval_seconds`, `last_fetched_at`)
- **LLM-enriched descriptions** for operations with `description_quality: "synthesized"`
- **UI pages** for API source management, credential configuration, memory browsing
- **API proxy endpoint** (Projects proxies calls with auth injection)
- **Query-intent gating** to dynamically adjust search weights for API vs general queries
