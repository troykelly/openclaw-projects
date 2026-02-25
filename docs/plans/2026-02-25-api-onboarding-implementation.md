# API Onboarding & Memory System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable OpenClaw agents to onboard any OpenAPI-documented API, decompose specs into semantically searchable memories, and store credential resolution info for autonomous API calling.

**Architecture:** Three new tables (`api_source`, `api_credential`, `api_memory`) with a dedicated search endpoint separate from general memory. OpenAPI specs are parsed, decomposed into per-operation/tag-group/overview memories with pgvector embeddings. Credentials are encrypted at rest using existing AES-256-GCM crypto. Nine new plugin tools expose the feature to agents.

**Tech Stack:** PostgreSQL + pgvector, `@apidevtools/swagger-parser`, existing Fastify route patterns, existing embedding service, existing OAuth crypto module, Zod for plugin tool schemas.

**Design doc:** `docs/plans/2026-02-25-api-onboarding-design.md` — read this first for full context on all decisions.

**Key reference files:**
- Crypto: `src/api/oauth/crypto.ts` — `encryptToken()` / `decryptToken()` to reuse
- SSRF: `src/api/webhooks/ssrf.ts` — `validateSsrf()` to reuse
- Embeddings: `src/api/embeddings/service.ts` — `embeddingService.embed()` / `.embedBatch()`
- Embedding integration: `src/api/embeddings/memory-integration.ts` — `generateMemoryEmbedding()` pattern
- Soft delete: `src/api/soft-delete/service.ts` — pattern for `softDeleteWorkItem()`
- Plugin tool pattern: `packages/openclaw-plugin/src/tools/memory-store.ts` — Zod + factory pattern
- Plugin tool index: `packages/openclaw-plugin/src/tools/index.ts` — barrel exports
- Audit: `src/api/audit/service.ts` — `createAuditLog()` / `updateLatestAuditEntry()`

---

## Phase 1: Data Model + CRUD

### Task 1: Create `api_source` migration

**Files:**
- Create: `migrations/116_api_source.up.sql`
- Create: `migrations/116_api_source.down.sql`

**Step 1: Write the up migration**

```sql
-- API Source: tracks onboarded OpenAPI-documented APIs.
-- Part of API Onboarding feature.

CREATE TABLE api_source (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  namespace   text NOT NULL DEFAULT 'default',
  name        text NOT NULL,
  description text,
  spec_url    text,
  servers     jsonb NOT NULL DEFAULT '[]',
  spec_version text,
  spec_hash   text,
  tags        text[] NOT NULL DEFAULT '{}',
  refresh_interval_seconds integer,
  last_fetched_at timestamptz,
  status      text NOT NULL DEFAULT 'active',
  error_message text,
  created_by_agent text,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_api_source_namespace ON api_source (namespace);
CREATE INDEX idx_api_source_status ON api_source (status) WHERE deleted_at IS NULL;
CREATE INDEX idx_api_source_deleted_at ON api_source (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_api_source_spec_url ON api_source (spec_url) WHERE spec_url IS NOT NULL;
CREATE INDEX idx_api_source_tags ON api_source USING gin (tags);

-- Audit trigger (same pattern as work_item/contact/memory)
CREATE OR REPLACE FUNCTION audit_api_source_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, changes)
    VALUES (uuidv7(), 'system', 'create', 'api_source', NEW.id,
            jsonb_build_object('new', to_jsonb(NEW)));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, changes)
    VALUES (uuidv7(), 'system', 'update', 'api_source', NEW.id,
            jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW)));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, changes)
    VALUES (uuidv7(), 'system', 'delete', 'api_source', OLD.id,
            jsonb_build_object('old', to_jsonb(OLD)));
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_api_source_insert AFTER INSERT ON api_source
  FOR EACH ROW EXECUTE FUNCTION audit_api_source_change();
CREATE TRIGGER audit_api_source_update AFTER UPDATE ON api_source
  FOR EACH ROW EXECUTE FUNCTION audit_api_source_change();
CREATE TRIGGER audit_api_source_delete AFTER DELETE ON api_source
  FOR EACH ROW EXECUTE FUNCTION audit_api_source_change();

-- Junction table: link API sources to work items
CREATE TABLE api_source_link (
  api_source_id uuid NOT NULL REFERENCES api_source(id) ON DELETE CASCADE,
  work_item_id  uuid NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (api_source_id, work_item_id)
);
```

**Step 2: Write the down migration**

```sql
DROP TABLE IF EXISTS api_source_link;
DROP TRIGGER IF EXISTS audit_api_source_delete ON api_source;
DROP TRIGGER IF EXISTS audit_api_source_update ON api_source;
DROP TRIGGER IF EXISTS audit_api_source_insert ON api_source;
DROP FUNCTION IF EXISTS audit_api_source_change;
DROP TABLE IF EXISTS api_source;
```

**Step 3: Run migration**

Run: `pnpm run migrate:up`
Expected: Migration 116 applied successfully.

**Step 4: Verify**

Run: `pnpm run migrate:status`
Expected: Shows version 116.

**Step 5: Commit**

```bash
git add migrations/116_api_source.up.sql migrations/116_api_source.down.sql
git commit -m "[#ISSUE] Add api_source and api_source_link migrations"
```

---

### Task 2: Create `api_credential` migration

**Files:**
- Create: `migrations/117_api_credential.up.sql`
- Create: `migrations/117_api_credential.down.sql`

**Step 1: Write the up migration**

```sql
-- API Credential: stores auth headers needed to call onboarded APIs.
-- resolve_reference is encrypted at rest via AES-256-GCM (same as OAuth tokens).
-- Audit trigger redacts resolve_reference to prevent secret leakage.

CREATE TABLE api_credential (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  api_source_id     uuid NOT NULL REFERENCES api_source(id) ON DELETE CASCADE,
  purpose           text NOT NULL DEFAULT 'api_call',
  header_name       text NOT NULL,
  header_prefix     text,
  resolve_strategy  text NOT NULL,
  resolve_reference text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT api_credential_purpose_check
    CHECK (purpose IN ('api_call', 'spec_fetch')),
  CONSTRAINT api_credential_strategy_check
    CHECK (resolve_strategy IN ('literal', 'env', 'file', 'command'))
);

CREATE INDEX idx_api_credential_source ON api_credential (api_source_id);
CREATE INDEX idx_api_credential_purpose ON api_credential (api_source_id, purpose);

-- Audit trigger with resolve_reference redaction
CREATE OR REPLACE FUNCTION audit_api_credential_change() RETURNS trigger AS $$
DECLARE
  old_redacted jsonb;
  new_redacted jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_redacted := to_jsonb(NEW);
    new_redacted := jsonb_set(new_redacted, '{resolve_reference}', '"[REDACTED]"');
    INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, changes)
    VALUES (uuidv7(), 'system', 'create', 'api_credential', NEW.id,
            jsonb_build_object('new', new_redacted));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    old_redacted := to_jsonb(OLD);
    old_redacted := jsonb_set(old_redacted, '{resolve_reference}', '"[REDACTED]"');
    new_redacted := to_jsonb(NEW);
    new_redacted := jsonb_set(new_redacted, '{resolve_reference}', '"[REDACTED]"');
    INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, changes)
    VALUES (uuidv7(), 'system', 'update', 'api_credential', NEW.id,
            jsonb_build_object('old', old_redacted, 'new', new_redacted));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    old_redacted := to_jsonb(OLD);
    old_redacted := jsonb_set(old_redacted, '{resolve_reference}', '"[REDACTED]"');
    INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, changes)
    VALUES (uuidv7(), 'system', 'delete', 'api_credential', OLD.id,
            jsonb_build_object('old', old_redacted));
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_api_credential_insert AFTER INSERT ON api_credential
  FOR EACH ROW EXECUTE FUNCTION audit_api_credential_change();
CREATE TRIGGER audit_api_credential_update AFTER UPDATE ON api_credential
  FOR EACH ROW EXECUTE FUNCTION audit_api_credential_change();
CREATE TRIGGER audit_api_credential_delete AFTER DELETE ON api_credential
  FOR EACH ROW EXECUTE FUNCTION audit_api_credential_change();
```

**Step 2: Write the down migration**

```sql
DROP TRIGGER IF EXISTS audit_api_credential_delete ON api_credential;
DROP TRIGGER IF EXISTS audit_api_credential_update ON api_credential;
DROP TRIGGER IF EXISTS audit_api_credential_insert ON api_credential;
DROP FUNCTION IF EXISTS audit_api_credential_change;
DROP TABLE IF EXISTS api_credential;
```

**Step 3: Run and verify**

Run: `pnpm run migrate:up`
Run: `pnpm run migrate:status`
Expected: Version 117.

**Step 4: Commit**

```bash
git add migrations/117_api_credential.up.sql migrations/117_api_credential.down.sql
git commit -m "[#ISSUE] Add api_credential migration with redacted audit"
```

---

### Task 3: Create `api_memory` migration

**Files:**
- Create: `migrations/118_api_memory.up.sql`
- Create: `migrations/118_api_memory.down.sql`

**Step 1: Write the up migration**

```sql
-- API Memory: semantically searchable memories generated from OpenAPI specs.
-- Each row is an operation, tag group, or API overview with a pgvector embedding.

CREATE TABLE api_memory (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  api_source_id     uuid NOT NULL REFERENCES api_source(id) ON DELETE CASCADE,
  namespace         text NOT NULL DEFAULT 'default',
  memory_kind       text NOT NULL,
  operation_key     text NOT NULL,
  title             text NOT NULL,
  content           text NOT NULL,
  metadata          jsonb NOT NULL DEFAULT '{}',
  tags              text[] NOT NULL DEFAULT '{}',
  embedding         vector(1024),
  embedding_model   text,
  embedding_provider text,
  embedding_status  text NOT NULL DEFAULT 'pending',
  search_vector     tsvector,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT api_memory_kind_check
    CHECK (memory_kind IN ('overview', 'tag_group', 'operation')),
  CONSTRAINT api_memory_embedding_status_check
    CHECK (embedding_status IN ('pending', 'complete', 'failed')),
  CONSTRAINT api_memory_unique_key
    UNIQUE (api_source_id, operation_key)
);

-- Indexes
CREATE INDEX idx_api_memory_source ON api_memory (api_source_id);
CREATE INDEX idx_api_memory_namespace ON api_memory (namespace);
CREATE INDEX idx_api_memory_kind ON api_memory (memory_kind);
CREATE INDEX idx_api_memory_tags ON api_memory USING gin (tags);
CREATE INDEX idx_api_memory_embedding_status ON api_memory (embedding_status)
  WHERE embedding_status != 'complete';
CREATE INDEX idx_api_memory_search_vector ON api_memory USING gin (search_vector);

-- HNSW vector index for semantic search (cosine distance)
CREATE INDEX idx_api_memory_embedding ON api_memory
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Auto-update search_vector on insert/update (same pattern as memory table)
CREATE OR REPLACE FUNCTION api_memory_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.content, '')), 'B');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER api_memory_search_vector_trigger
  BEFORE INSERT OR UPDATE OF title, content ON api_memory
  FOR EACH ROW EXECUTE FUNCTION api_memory_search_vector_update();

-- Audit trigger
CREATE OR REPLACE FUNCTION audit_api_memory_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, changes)
    VALUES (uuidv7(), 'system', 'create', 'api_memory', NEW.id,
            jsonb_build_object('new', jsonb_build_object(
              'id', NEW.id, 'api_source_id', NEW.api_source_id,
              'memory_kind', NEW.memory_kind, 'operation_key', NEW.operation_key,
              'title', NEW.title)));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, changes)
    VALUES (uuidv7(), 'system', 'update', 'api_memory', NEW.id,
            jsonb_build_object(
              'old_title', OLD.title, 'new_title', NEW.title,
              'old_kind', OLD.memory_kind, 'new_kind', NEW.memory_kind));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, changes)
    VALUES (uuidv7(), 'system', 'delete', 'api_memory', OLD.id,
            jsonb_build_object('old', jsonb_build_object(
              'id', OLD.id, 'api_source_id', OLD.api_source_id,
              'operation_key', OLD.operation_key)));
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_api_memory_insert AFTER INSERT ON api_memory
  FOR EACH ROW EXECUTE FUNCTION audit_api_memory_change();
CREATE TRIGGER audit_api_memory_update AFTER UPDATE ON api_memory
  FOR EACH ROW EXECUTE FUNCTION audit_api_memory_change();
CREATE TRIGGER audit_api_memory_delete AFTER DELETE ON api_memory
  FOR EACH ROW EXECUTE FUNCTION audit_api_memory_change();
```

Note: The `api_memory` audit trigger logs a lightweight summary (not the full row with content/metadata) to keep audit entries compact.

**Step 2: Write the down migration**

```sql
DROP TRIGGER IF EXISTS audit_api_memory_delete ON api_memory;
DROP TRIGGER IF EXISTS audit_api_memory_update ON api_memory;
DROP TRIGGER IF EXISTS audit_api_memory_insert ON api_memory;
DROP FUNCTION IF EXISTS audit_api_memory_change;
DROP TRIGGER IF EXISTS api_memory_search_vector_trigger ON api_memory;
DROP FUNCTION IF EXISTS api_memory_search_vector_update;
DROP TABLE IF EXISTS api_memory;
```

**Step 3: Run and verify**

Run: `pnpm run migrate:up`
Run: `pnpm run migrate:status`
Expected: Version 118.

**Step 4: Commit**

```bash
git add migrations/118_api_memory.up.sql migrations/118_api_memory.down.sql
git commit -m "[#ISSUE] Add api_memory migration with vector index and search trigger"
```

---

### Task 4: TypeScript types for api-sources module

**Files:**
- Create: `src/api/api-sources/types.ts`

**Step 1: Write the types**

Define all interfaces: `ApiSource`, `ApiCredential`, `ApiMemory`, `CreateApiSourceInput`, `UpdateApiSourceInput`, `CreateApiCredentialInput`, `UpdateApiCredentialInput`, `ApiMemorySearchOptions`, `ApiMemorySearchResult`, `OnboardResult`, `RefreshResult`.

Key type patterns:
- Match existing codebase style (see `src/api/soft-delete/types.ts` for reference)
- Use `string` for UUIDs (not a branded type)
- Use `Record<string, unknown>` for JSONB metadata
- Export all types

**Step 2: Typecheck**

Run: `pnpm run build`
Expected: PASS (no errors).

**Step 3: Commit**

```bash
git add src/api/api-sources/types.ts
git commit -m "[#ISSUE] Add TypeScript types for api-sources module"
```

---

### Task 5: Credential crypto wrapper

**Files:**
- Create: `src/api/api-sources/credential-crypto.ts`
- Test: `tests/api/api-sources/credential-crypto.test.ts`

**Step 1: Write the failing test**

Test that `encryptCredential(value, rowId)` returns a different string, and `decryptCredential(encrypted, rowId)` returns the original. Test that masking works (`maskResolveReference('op read "op://Personal/TfNSW/credential"')` → `'op read "op://...***"'`).

Run: `pnpm exec vitest run tests/api/api-sources/credential-crypto.test.ts`
Expected: FAIL — module not found.

**Step 2: Write the implementation**

- Import `encryptToken` / `decryptToken` from `../../oauth/crypto.ts`
- Re-export as `encryptCredential` / `decryptCredential` (thin wrapper, same signature)
- Add `maskResolveReference(value: string): string` — show first 15 chars + `***` if longer than 20, else all `***`

**Step 3: Run tests**

Run: `pnpm exec vitest run tests/api/api-sources/credential-crypto.test.ts`
Expected: PASS.

**Step 4: Commit**

```bash
git add src/api/api-sources/credential-crypto.ts tests/api/api-sources/credential-crypto.test.ts
git commit -m "[#ISSUE] Add credential encryption wrapper with masking"
```

---

### Task 6: API source CRUD service

**Files:**
- Create: `src/api/api-sources/service.ts`
- Test: `tests/api/api-sources/crud.test.ts`

**Step 1: Write failing integration tests**

Test CRUD operations against real Postgres:
- `createApiSource()` — inserts and returns with ID
- `getApiSource()` — retrieves by ID, returns null for non-existent
- `listApiSources()` — namespace-scoped, excludes soft-deleted
- `updateApiSource()` — updates name, tags, status
- `softDeleteApiSource()` — sets deleted_at
- `restoreApiSource()` — clears deleted_at

Use the same test setup pattern as existing integration tests (pool from `tests/setup-api.ts`).

Run: `pnpm exec vitest run tests/api/api-sources/crud.test.ts`
Expected: FAIL — service functions not found.

**Step 2: Implement the service**

Functions: `createApiSource`, `getApiSource`, `listApiSources`, `updateApiSource`, `softDeleteApiSource`, `restoreApiSource`.

Pattern: raw SQL queries via `pool.query()` (same as soft-delete service). Parameterized queries. Return typed results. Namespace filtering on all read operations.

**Step 3: Run tests**

Run: `pnpm exec vitest run tests/api/api-sources/crud.test.ts`
Expected: PASS.

**Step 4: Commit**

```bash
git add src/api/api-sources/service.ts tests/api/api-sources/crud.test.ts
git commit -m "[#ISSUE] Add api_source CRUD service with integration tests"
```

---

### Task 7: Credential CRUD service

**Files:**
- Modify: `src/api/api-sources/service.ts` (add credential functions)
- Test: `tests/api/api-sources/credentials.test.ts`

**Step 1: Write failing tests**

Test credential operations:
- `createApiCredential()` — encrypts `resolve_reference` before INSERT
- `listApiCredentials()` — returns masked values by default
- `listApiCredentials(decrypt: true)` — returns decrypted values
- `updateApiCredential()` — re-encrypts on update
- `deleteApiCredential()` — hard delete (cascades from api_source)
- Audit log entries have `[REDACTED]` for resolve_reference

Run: `pnpm exec vitest run tests/api/api-sources/credentials.test.ts`
Expected: FAIL.

**Step 2: Implement credential functions**

Functions: `createApiCredential`, `listApiCredentials`, `getApiCredential`, `updateApiCredential`, `deleteApiCredential`.

Key: call `encryptCredential()` before INSERT/UPDATE, call `decryptCredential()` or `maskResolveReference()` on SELECT depending on `decrypt` flag.

**Step 3: Run tests**

Run: `pnpm exec vitest run tests/api/api-sources/credentials.test.ts`
Expected: PASS.

**Step 4: Commit**

```bash
git add src/api/api-sources/service.ts tests/api/api-sources/credentials.test.ts
git commit -m "[#ISSUE] Add credential CRUD with encryption and audit redaction"
```

---

### Task 8: Fastify routes for api-sources CRUD

**Files:**
- Create: `src/api/api-sources/routes.ts`
- Modify: `src/api/server.ts` — register the route plugin
- Create: `src/api/openapi/paths/api-sources.ts` — OpenAPI spec

**Step 1: Write the routes plugin**

Fastify plugin pattern (same as voice/HA route plugins registered in server.ts):

```typescript
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

export async function apiSourceRoutesPlugin(
  app: FastifyInstance,
  opts: { pool: Pool },
): Promise<void> {
  const { pool } = opts;
  // Register all routes here...
}
```

Routes to implement:
- `POST /api/api-sources` — create (write scope). Initially just CRUD, onboard logic in Phase 2.
- `GET /api/api-sources` — list (read scope)
- `GET /api/api-sources/:id` — get (read scope)
- `PATCH /api/api-sources/:id` — update (write scope)
- `DELETE /api/api-sources/:id` — soft delete (write scope)
- `POST /api/api-sources/:id/restore` — restore (write scope)
- `POST /api/api-sources/:id/credentials` — add credential (write scope)
- `GET /api/api-sources/:id/credentials` — list credentials (read scope)
- `GET /api/api-sources/:id/credentials/:cred_id` — get credential (read scope)
- `PATCH /api/api-sources/:id/credentials/:cred_id` — update credential (write scope)
- `DELETE /api/api-sources/:id/credentials/:cred_id` — delete credential (write scope)

Use `verifyReadScope()` / `verifyWriteScope()` for namespace authorization (same as all other routes in server.ts).

**Step 2: Register in server.ts**

Add near the other plugin registrations:
```typescript
app.register(apiSourceRoutesPlugin, { pool: apiSourcePool });
```

**Step 3: Write OpenAPI path spec**

Create `src/api/openapi/paths/api-sources.ts` following the pattern in existing path files (e.g., `contacts.ts`). Document all endpoints.

**Step 4: Typecheck**

Run: `pnpm run build`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/api/api-sources/routes.ts src/api/server.ts src/api/openapi/paths/api-sources.ts
git commit -m "[#ISSUE] Add Fastify routes for api-sources CRUD + credentials"
```

---

### Task 9: Phase 1 integration test — full CRUD via HTTP

**Files:**
- Test: `tests/api/api-sources/routes.test.ts`

**Step 1: Write integration tests hitting the HTTP endpoints**

Test the full request/response cycle through Fastify:
- POST create → GET retrieve → PATCH update → DELETE soft-delete → POST restore
- Credential lifecycle: POST create → GET list (masked) → GET list (decrypted) → PATCH update → DELETE
- Namespace scoping: create in namespace A, list in namespace B → empty
- Audit log: verify entries exist with redacted credentials

Use `app.inject()` (Fastify's test helper) to make HTTP requests without a running server.

**Step 2: Run all Phase 1 tests**

Run: `pnpm exec vitest run tests/api/api-sources/`
Expected: All PASS.

**Step 3: Typecheck**

Run: `pnpm run build`
Expected: PASS.

**Step 4: Commit**

```bash
git add tests/api/api-sources/routes.test.ts
git commit -m "[#ISSUE] Add HTTP integration tests for api-sources routes"
```

---

## Phase 2: Parser + Embedding Generation

### Task 10: Add `@apidevtools/swagger-parser` dependency

**Step 1: Install**

Run: `pnpm add @apidevtools/swagger-parser`

**Step 2: Verify types available**

Run: `pnpm run build`
Expected: PASS. The package includes TypeScript types.

**Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "[#ISSUE] Add @apidevtools/swagger-parser dependency"
```

---

### Task 11: Spec text sanitizer

**Files:**
- Create: `src/api/api-sources/sanitizer.ts`
- Test: `tests/api/api-sources/sanitizer.test.ts`

**Step 1: Write failing tests**

Test cases:
- Strips HTML tags: `<b>bold</b>` → `bold`
- Strips markdown links: `[text](url)` → `text`
- Strips markdown images: `![alt](url)` → `alt`
- Removes injection patterns: `"Ignore previous instructions"` → removed, warning logged
- Normalizes whitespace: `"foo\n\n\n\nbar"` → `"foo\n\nbar"`
- Removes control characters
- Truncates per-field limits: 1000-char operation description truncated with `...`
- Returns `sanitization_applied: true` flag when any rule triggers
- Leaves clean text unchanged

Run: `pnpm exec vitest run tests/api/api-sources/sanitizer.test.ts`
Expected: FAIL.

**Step 2: Implement sanitizer**

Export functions:
- `sanitizeSpecText(text: string, maxLength: number): { text: string; sanitized: boolean }`
- `sanitizeOperationDescription(text: string): { text: string; sanitized: boolean }`
- `sanitizeParameterDescription(text: string): { text: string; sanitized: boolean }`
- `sanitizeApiDescription(text: string): { text: string; sanitized: boolean }`
- `sanitizeTagDescription(text: string): { text: string; sanitized: boolean }`

Each delegates to `sanitizeSpecText` with appropriate max length (1000, 200, 2000, 500).

**Step 3: Run tests**

Run: `pnpm exec vitest run tests/api/api-sources/sanitizer.test.ts`
Expected: PASS.

**Step 4: Commit**

```bash
git add src/api/api-sources/sanitizer.ts tests/api/api-sources/sanitizer.test.ts
git commit -m "[#ISSUE] Add spec text sanitizer with injection protection"
```

---

### Task 12: Operation key resolver

**Files:**
- Create: `src/api/api-sources/operation-key.ts`
- Test: `tests/api/api-sources/operation-key.test.ts`

**Step 1: Write failing tests**

Test cases:
- Uses `operationId` when present: `"getDepartures"` → `"getDepartures"`
- Falls back to METHOD:path with params stripped: `GET /v1/stops/{stop_id}/departures` → `"GET:/v1/stops/{}/departures"`
- Tag group key: `"tag:realtime"`
- Overview key: `"overview"`
- Collision handling: `["getDepartures", "getDepartures"]` → `["getDepartures", "getDepartures_2"]`
- Handles multiple path params: `GET /v1/{org}/{repo}/issues` → `"GET:/v1/{}/{}/issues"`

Run: `pnpm exec vitest run tests/api/api-sources/operation-key.test.ts`
Expected: FAIL.

**Step 2: Implement**

Export:
- `resolveOperationKey(method: string, path: string, operationId?: string): string`
- `resolveTagGroupKey(tagName: string): string` — returns `tag:${tagName}`
- `deduplicateKeys(keys: string[]): string[]` — appends `_2`, `_3` etc. on collision

**Step 3: Run tests and commit**

Run: `pnpm exec vitest run tests/api/api-sources/operation-key.test.ts`
Expected: PASS.

```bash
git add src/api/api-sources/operation-key.ts tests/api/api-sources/operation-key.test.ts
git commit -m "[#ISSUE] Add operation key resolver with collision handling"
```

---

### Task 13: Embedding text generator

**Files:**
- Create: `src/api/api-sources/embedding-text.ts`
- Test: `tests/api/api-sources/embedding-text.test.ts`

**Step 1: Write failing tests**

Test the three templates with fixture data:
- `generateOperationText()` — produces intent-first text with parameters, returns section, endpoint, API name, tags, auth
- `generateTagGroupText()` — produces group summary with operation list
- `generateOverviewText()` — produces API summary with tag group list
- Weak description fallback: operation with no description/summary synthesizes from path
- Sets `description_quality: "synthesized"` in returned metadata
- Empty parameters list: omits "Inputs:" section
- Handles missing response schema gracefully

Run: `pnpm exec vitest run tests/api/api-sources/embedding-text.test.ts`
Expected: FAIL.

**Step 2: Implement**

Export:
- `generateOperationText(op: ParsedOperation, apiName: string, authSummary: string): { title: string; content: string; descriptionQuality: 'original' | 'synthesized' }`
- `generateTagGroupText(tag: ParsedTagGroup, apiName: string): { title: string; content: string }`
- `generateOverviewText(api: ParsedApiOverview): { title: string; content: string }`

These are pure functions — no side effects, no DB, no embedding calls. Input is parsed spec data, output is strings.

**Step 3: Run tests and commit**

Run: `pnpm exec vitest run tests/api/api-sources/embedding-text.test.ts`
Expected: PASS.

```bash
git add src/api/api-sources/embedding-text.ts tests/api/api-sources/embedding-text.test.ts
git commit -m "[#ISSUE] Add embedding text generator templates"
```

---

### Task 14: OpenAPI parser and decomposer

**Files:**
- Create: `src/api/api-sources/parser.ts`
- Test: `tests/api/api-sources/parser.test.ts`
- Create: `tests/fixtures/openapi/` — test fixture specs

**Step 1: Create test fixture specs**

Create small, focused OpenAPI 3.0 JSON fixtures:

- `tests/fixtures/openapi/minimal.json` — 1 endpoint, no descriptions, no tags
- `tests/fixtures/openapi/rich.json` — 3 endpoints, 2 tags, full descriptions
- `tests/fixtures/openapi/no-tags.json` — 2 endpoints, no tags (test `_untagged` grouping)
- `tests/fixtures/openapi/nested-schemas.json` — deeply nested request/response schemas (test truncation)
- `tests/fixtures/openapi/adversarial.json` — descriptions containing injection patterns
- `tests/fixtures/openapi/swagger2.json` — Swagger 2.0 format (test backwards compat)

**Step 2: Write failing tests**

Test `parseOpenApiSpec(specContent: string)`:
- Returns `ParsedApi` with overview, tag groups, and operations
- Correct operation count
- Correct tag group count (including `_untagged` when applicable)
- All `$ref`s resolved (no `$ref` keys in output)
- Schema truncation at depth 3+
- Sanitized descriptions
- Correct operation keys
- Rejects spec with >200 operations (use a fixture or mock)
- Validates spec structure (rejects invalid JSON)

Run: `pnpm exec vitest run tests/api/api-sources/parser.test.ts`
Expected: FAIL.

**Step 3: Implement parser**

```typescript
import SwaggerParser from '@apidevtools/swagger-parser';
```

Export:
- `parseOpenApiSpec(specContent: string): Promise<ParsedApi>` — main entry point
- `parseOpenApiSpecFromUrl(url: string, fetchHeaders?: Record<string, string>): Promise<ParsedApi>` — fetches then parses

Internal flow:
1. `JSON.parse()` or YAML parse the content
2. `SwaggerParser.validate()` — structural validation
3. `SwaggerParser.dereference()` — resolve all `$ref`s
4. Extract operations (pass 1): iterate `paths`, collect per path+method
5. Generate operation keys (with dedup)
6. Apply sanitization to all text fields
7. Apply schema truncation to metadata
8. Extract tag groups (pass 2): aggregate operations by tag
9. Generate overview
10. Generate embedding text for all memories
11. Return `ParsedApi` with all data ready for DB insertion

**Step 4: Run tests and commit**

Run: `pnpm exec vitest run tests/api/api-sources/parser.test.ts`
Expected: PASS.

```bash
git add src/api/api-sources/parser.ts tests/api/api-sources/parser.test.ts tests/fixtures/openapi/
git commit -m "[#ISSUE] Add OpenAPI parser with decomposition, sanitization, and truncation"
```

---

### Task 15: Full onboard endpoint

**Files:**
- Modify: `src/api/api-sources/service.ts` — add `onboardApiSource()`
- Modify: `src/api/api-sources/routes.ts` — enhance POST endpoint
- Test: `tests/api/api-sources/onboard.test.ts`

**Step 1: Write failing integration test**

Test the full onboard flow:
- Provide a fixture spec URL (use a local HTTP server in test, or inline `spec_content`)
- Verify: `api_source` row created with correct name, servers, spec_hash
- Verify: correct number of `api_memory` rows (operations + tag groups + 1 overview)
- Verify: correct `operation_key` values
- Verify: embedding text content matches templates
- Verify: metadata JSONB has expected structure
- Verify: credentials stored encrypted
- Verify: `embedding_status` is `'complete'` or `'pending'` (mock embedding service)
- Verify: deduplication — second call with same `spec_url` returns existing source
- Verify: SSRF blocked URL rejected

Run: `pnpm exec vitest run tests/api/api-sources/onboard.test.ts`
Expected: FAIL.

**Step 2: Implement `onboardApiSource()`**

This is the core orchestration function. It:
1. Validates URL (SSRF) or accepts inline content
2. Checks dedup on `spec_url`
3. Fetches spec (with spec_fetch credentials if provided)
4. Parses via `parseOpenApiSpec()`
5. Creates `api_source` row
6. Creates `api_credential` rows (encrypted)
7. Creates `api_memory` rows (operations, tag groups, overview)
8. Calls `embeddingService.embedBatch()` for all memory content
9. Updates embedding columns
10. Returns `OnboardResult`

Wrap in a transaction — if any step fails, roll back everything.

**Step 3: Enhance POST route**

Update `POST /api/api-sources` to accept `spec_url` or `spec_content`, plus optional `credentials` and `spec_auth` arrays. Call `onboardApiSource()`.

**Step 4: Run tests and commit**

Run: `pnpm exec vitest run tests/api/api-sources/onboard.test.ts`
Expected: PASS.

```bash
git add src/api/api-sources/service.ts src/api/api-sources/routes.ts tests/api/api-sources/onboard.test.ts
git commit -m "[#ISSUE] Add full onboard endpoint with spec parsing and memory generation"
```

---

## Phase 3: Search + Plugin Tools

### Task 16: API memory search service + endpoint

**Files:**
- Modify: `src/api/api-sources/service.ts` — add `searchApiMemories()`
- Modify: `src/api/api-sources/routes.ts` — add search routes
- Modify: `src/api/openapi/paths/api-sources.ts` — document search endpoints
- Test: `tests/api/api-sources/search.test.ts`

**Step 1: Write failing tests**

Test semantic + text search:
- Insert API memories with known content, generate embeddings (mock embedding service returns deterministic vectors)
- Search by query text → returns matching operations ranked by similarity
- Filter by `memory_kind` → only operations, or only tag groups
- Filter by `api_source_id` → scoped to one API
- Filter by tags → array containment
- Namespace scoping → only memories in authorized namespaces
- Excludes soft-deleted API sources
- Excludes disabled API sources
- Text fallback when embedding not available
- Search results include credentials (decrypted) from secondary query
- `GET /api/api-sources/:id/memories` lists all memories for a source

Run: `pnpm exec vitest run tests/api/api-sources/search.test.ts`
Expected: FAIL.

**Step 2: Implement search**

`searchApiMemories()` — hybrid search following the pattern in `src/api/embeddings/memory-integration.ts`:

1. Generate query embedding via `embeddingService.embed(query)`
2. Run semantic search SQL (cosine similarity on `api_memory.embedding`)
3. Run text search SQL (tsvector on `api_memory.search_vector`)
4. Combine results (50/50 weighting)
5. For each unique `api_source_id` in results, fetch credentials (decrypted)
6. Attach credentials to each result
7. Return ranked results

Routes:
- `GET /api/api-memories/search?q=...&limit=...&memory_kind=...&api_source_id=...&tags=...`
- `GET /api/api-sources/:id/memories`

**Step 3: Run tests and commit**

Run: `pnpm exec vitest run tests/api/api-sources/search.test.ts`
Expected: PASS.

```bash
git add src/api/api-sources/service.ts src/api/api-sources/routes.ts src/api/openapi/paths/api-sources.ts tests/api/api-sources/search.test.ts
git commit -m "[#ISSUE] Add API memory hybrid search with credential attachment"
```

---

### Task 17: Plugin API source service

**Files:**
- Create: `packages/openclaw-plugin/src/services/api-source-service.ts`

**Step 1: Write the service**

HTTP client wrapper using existing `ApiClient` pattern (see `notification-service.ts`):

```typescript
export class ApiSourceService {
  constructor(private client: ApiClient) {}

  async onboard(params, options): Promise<ApiResponse<OnboardResult>> { ... }
  async search(query, options): Promise<ApiResponse<SearchResult>> { ... }
  async get(id, options): Promise<ApiResponse<ApiSource>> { ... }
  async list(options): Promise<ApiResponse<ApiSource[]>> { ... }
  async update(id, params, options): Promise<ApiResponse<ApiSource>> { ... }
  async manageCredential(sourceId, action, params, options): Promise<ApiResponse<...>> { ... }
  async refresh(id, options): Promise<ApiResponse<RefreshResult>> { ... }
  async remove(id, options): Promise<ApiResponse<void>> { ... }
  async restore(id, options): Promise<ApiResponse<void>> { ... }
}
```

**Step 2: Typecheck**

Run: `cd packages/openclaw-plugin && pnpm run build` (or `pnpm run build` from root)
Expected: PASS.

**Step 3: Commit**

```bash
git add packages/openclaw-plugin/src/services/api-source-service.ts
git commit -m "[#ISSUE] Add plugin API source service client"
```

---

### Task 18: Plugin tools — `api_onboard` and `api_recall`

**Files:**
- Create: `packages/openclaw-plugin/src/tools/api-onboard.ts`
- Create: `packages/openclaw-plugin/src/tools/api-recall.ts`
- Test: `tests/openclaw-contract/api-tools.test.ts`

**Step 1: Write failing tests**

Test both tools following the contract test pattern:
- `api_onboard`: validates params (requires spec_url or spec_content), calls service, formats response with counts
- `api_recall`: validates query param, calls search, formats results with operation details and credentials

Run: `pnpm exec vitest run tests/openclaw-contract/api-tools.test.ts`
Expected: FAIL.

**Step 2: Implement both tools**

Follow exact pattern from `memory-store.ts`:
- Zod schema for params
- Success/Failure result types
- Factory function `createApiOnboardTool(options)` / `createApiRecallTool(options)`
- Use `ApiSourceService` for API calls

**Step 3: Run tests and commit**

Run: `pnpm exec vitest run tests/openclaw-contract/api-tools.test.ts`
Expected: PASS.

```bash
git add packages/openclaw-plugin/src/tools/api-onboard.ts packages/openclaw-plugin/src/tools/api-recall.ts tests/openclaw-contract/api-tools.test.ts
git commit -m "[#ISSUE] Add api_onboard and api_recall plugin tools"
```

---

### Task 19: Plugin tools — remaining 7 tools

**Files:**
- Create: `packages/openclaw-plugin/src/tools/api-get.ts`
- Create: `packages/openclaw-plugin/src/tools/api-list.ts`
- Create: `packages/openclaw-plugin/src/tools/api-update.ts`
- Create: `packages/openclaw-plugin/src/tools/api-credential-manage.ts`
- Create: `packages/openclaw-plugin/src/tools/api-refresh.ts`
- Create: `packages/openclaw-plugin/src/tools/api-remove.ts`
- Create: `packages/openclaw-plugin/src/tools/api-restore.ts`
- Modify: `tests/openclaw-contract/api-tools.test.ts` — add tests for all 7

**Step 1: Write failing tests for all 7 tools**

Each tool: validate params, call service, format response. Add to the existing test file.

Run: `pnpm exec vitest run tests/openclaw-contract/api-tools.test.ts`
Expected: FAIL for new tests.

**Step 2: Implement all 7 tools**

Same factory pattern. Each is a thin wrapper:
- `api_get` → `service.get(id)` — returns source details + credentials
- `api_list` → `service.list()` — returns summaries with operation counts
- `api_update` → `service.update(id, params)` — name, tags, status
- `api_credential_manage` → `service.manageCredential(id, action, params)` — add/update/remove
- `api_refresh` → `service.refresh(id)` — returns diff summary
- `api_remove` → `service.remove(id)` — soft delete
- `api_restore` → `service.restore(id)` — restore

**Step 3: Run tests and commit**

Run: `pnpm exec vitest run tests/openclaw-contract/api-tools.test.ts`
Expected: All PASS.

```bash
git add packages/openclaw-plugin/src/tools/api-*.ts tests/openclaw-contract/api-tools.test.ts
git commit -m "[#ISSUE] Add remaining 7 api plugin tools with contract tests"
```

---

### Task 20: Tool registration and barrel exports

**Files:**
- Modify: `packages/openclaw-plugin/src/tools/index.ts` — add barrel exports for all 9 tools
- Modify: `packages/openclaw-plugin/src/register-openclaw.ts` — register all 9 tools

**Step 1: Add exports to index.ts**

Add export blocks for all 9 api tools (matching existing pattern).

**Step 2: Register tools in register-openclaw.ts**

Add tool creation and registration calls (matching existing pattern for memory/project/todo tools).

**Step 3: Typecheck**

Run: `pnpm run build`
Expected: PASS.

**Step 4: Commit**

```bash
git add packages/openclaw-plugin/src/tools/index.ts packages/openclaw-plugin/src/register-openclaw.ts
git commit -m "[#ISSUE] Register all 9 api tools in plugin"
```

---

## Phase 4: Refresh + Links

### Task 21: Spec refresh and diff logic

**Files:**
- Modify: `src/api/api-sources/service.ts` — add `refreshApiSource()`
- Modify: `src/api/api-sources/routes.ts` — implement refresh endpoint
- Test: `tests/api/api-sources/refresh.test.ts`

**Step 1: Write failing tests**

Test refresh scenarios:
- Unchanged spec (same hash) → returns early, no changes
- New operation added → inserted with embedding
- Operation removed → deleted from api_memory
- Operation description changed → updated content + metadata, re-embedded
- Tag groups regenerated
- Overview regenerated
- `api_source` updated: spec_hash, spec_version, last_fetched_at, servers
- Returns diff summary: `{ added: [...], updated: [...], removed: [...] }`

Run: `pnpm exec vitest run tests/api/api-sources/refresh.test.ts`
Expected: FAIL.

**Step 2: Implement `refreshApiSource()`**

1. Fetch new spec
2. Hash and compare
3. Parse new spec
4. Load existing `api_memory` rows keyed by `operation_key`
5. Diff: new keys = INSERT, missing keys = DELETE, changed content = UPDATE
6. Always regenerate tag groups and overview
7. Batch-embed new/updated memories
8. Update `api_source` metadata
9. Return diff

**Step 3: Run tests and commit**

Run: `pnpm exec vitest run tests/api/api-sources/refresh.test.ts`
Expected: PASS.

```bash
git add src/api/api-sources/service.ts src/api/api-sources/routes.ts tests/api/api-sources/refresh.test.ts
git commit -m "[#ISSUE] Add spec refresh with diff logic"
```

---

### Task 22: Work item linkage

**Files:**
- Modify: `src/api/api-sources/service.ts` — add link/unlink functions
- Modify: `src/api/api-sources/routes.ts` — add link endpoints
- Test: `tests/api/api-sources/links.test.ts`

**Step 1: Write failing tests**

- Link API source to work item → row in `api_source_link`
- Duplicate link → idempotent (no error)
- Unlink → row removed
- List links for a source → returns work item IDs
- Cascade: delete API source → links removed

Run: `pnpm exec vitest run tests/api/api-sources/links.test.ts`
Expected: FAIL.

**Step 2: Implement**

Functions: `linkApiSourceToWorkItem`, `unlinkApiSourceFromWorkItem`, `getApiSourceLinks`.
Routes: `POST /api/api-sources/:id/links`, `DELETE /api/api-sources/:id/links/:work_item_id`.

**Step 3: Run tests and commit**

Run: `pnpm exec vitest run tests/api/api-sources/links.test.ts`
Expected: PASS.

```bash
git add src/api/api-sources/service.ts src/api/api-sources/routes.ts tests/api/api-sources/links.test.ts
git commit -m "[#ISSUE] Add work item linkage for API sources"
```

---

### Task 23: Inline spec support + deduplication

**Files:**
- Modify: `src/api/api-sources/service.ts` — enhance `onboardApiSource()` for `spec_content`
- Test: `tests/api/api-sources/dedup.test.ts`

**Step 1: Write failing tests**

- Onboard with `spec_content` (JSON string) → parses and creates memories
- Onboard with `spec_content` (YAML string) → parses correctly
- Deduplication: second POST with same `spec_url` in same namespace → returns existing source with message
- Different namespace, same `spec_url` → creates separate source

Run: `pnpm exec vitest run tests/api/api-sources/dedup.test.ts`
Expected: FAIL.

**Step 2: Implement**

In `onboardApiSource()`:
- If `spec_content` provided, skip URL fetch, parse directly
- If `spec_url` provided, check for existing active source in same namespace with same `spec_url`
- Return existing source with `{ already_onboarded: true }` flag

**Step 3: Run tests and commit**

Run: `pnpm exec vitest run tests/api/api-sources/dedup.test.ts`
Expected: PASS.

```bash
git add src/api/api-sources/service.ts tests/api/api-sources/dedup.test.ts
git commit -m "[#ISSUE] Add inline spec support and deduplication"
```

---

### Task 24: Final integration test + typecheck

**Step 1: Run all tests**

Run: `pnpm test`
Expected: All unit + integration tests PASS.

**Step 2: Typecheck**

Run: `pnpm run build`
Expected: PASS.

**Step 3: Lint**

Run: `pnpm run lint`
Expected: PASS (or fix issues).

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "[#ISSUE] Fix lint/type issues from final verification"
```

---

## Summary

| Phase | Tasks | New files | Test files |
|-------|-------|-----------|------------|
| 1: Data model + CRUD | 1-9 | 3 migrations + types + crypto + service + routes + openapi spec | crud, credentials, routes |
| 2: Parser + embedding | 10-15 | swagger-parser dep + sanitizer + operation-key + embedding-text + parser + fixtures | sanitizer, operation-key, embedding-text, parser, onboard |
| 3: Search + tools | 16-20 | search service + plugin service + 9 plugin tools + tool registration | search, api-tools contract |
| 4: Refresh + links | 21-24 | refresh logic + link logic + inline/dedup | refresh, links, dedup |

**Total: 24 tasks across 4 phases.**
