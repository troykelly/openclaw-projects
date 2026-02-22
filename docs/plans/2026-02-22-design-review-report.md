# Design Review: Identity Model & Contacts v2

**Reviewer:** Research Agent  
**Date:** 2026-02-22  
**Documents reviewed:**
1. `design-identity-model.md` — Identity Model & Namespace Permissions
2. `design-contacts-v2.md` — Contacts v2: Full-Featured Contact Management

**Existing schema cross-referenced:** contact, contact_endpoint, contact_external_identity, namespace_grant, user_setting, relationship, relationship_type

---

## 1. Security Issues

### 1.1 Email Enumeration via Dual-Path Login (Identity §2.3)

The two-step auth flow (try contact_endpoint lookup first, fall back to user_setting.email) leaks information. An attacker who tries different emails can distinguish "this email belongs to a contact with endpoints" vs "this email is only in user_setting" vs "this email doesn't exist" based on timing differences or response shape. 

**Recommendation:** Make both paths return identical timing and response structure. Consider always doing both lookups and merging results.

### 1.2 Contact Endpoint as Login Vector Creates a Trust Escalation (Identity §2.2, §2.3)

Currently, adding an email endpoint to a contact is a low-privilege data operation (any user with namespace access can do it). After the identity model change, adding an email endpoint to a **contact in `default` that's linked to a `user_setting`** becomes a **login credential operation** — it adds a new email address someone can authenticate with.

**The design doesn't address this at all.** There's no distinction between "add email to a random contact" and "add an email that becomes a login address." Any user who can create endpoints on auth-linked contacts in `default` can grant themselves or others login access.

**Recommendation:** 
- Require elevated permission to modify endpoints on auth-linked contacts.
- Or: only endpoints that existed at link-time count for auth (maintain an explicit allow-list).
- Or: auth resolution only uses `user_setting.email`, not arbitrary endpoints (simplest, but defeats multi-email login goal).

### 1.3 Cross-Namespace Data Leakage via Contact Merge (Contacts v2 §4.7)

The merge endpoint says "Verify both contacts exist and are in caller's namespace scope" — but what if the caller has access to two namespaces and merges a contact from namespace A into namespace B? The child records (endpoints, addresses, relationships) would move across namespace boundaries. The merge logic doesn't mention namespace validation for child records.

**Recommendation:** Merge should only work within a single namespace. Both contacts must be in the same namespace, and all child records must remain in that namespace.

### 1.4 Merge Endpoint Missing Authorization Model (Contacts v2 §4.7)

With roles removed (Identity §2.1), what permission is needed to merge contacts? Merge is destructive — it soft-deletes one contact and rewrites foreign keys. There's no discussion of which permission-namespace controls this. Any namespace member could potentially merge any contacts they can see.

**Recommendation:** Define a specific permission (e.g., `contacts_admin`) required for merge operations. Document this in the identity model's permission config.

### 1.5 M2M Token Still Has Full Access (Identity §2.7)

The design explicitly punts on agent scoping: "single M2M token with `api:full`, shared by all agents." Combined with the new auth flow where `X-Sender-Id` resolution determines the acting user, a malicious or buggy agent can send any `X-Sender-Id` it wants and act as any user. There's no validation that agent X is authorized to claim sender Y.

**Recommendation:** At minimum, document this as a known risk. Better: validate that the `X-Agent-Id` + `X-Sender-Id` combination is plausible (e.g., the sender is in a channel the agent serves).

### 1.6 `X-Sender-Id` Header Spoofing (Identity §4.2)

The server trusts `X-Sender-Id` from M2M-authenticated requests to resolve the acting human. Any process with the M2M token can impersonate any user by sending their Telegram ID. This is particularly dangerous for the namespace creation path where the resolved user becomes the namespace owner.

**Recommendation:** If sender resolution drives authorization decisions, it needs a stronger trust chain than an unauthenticated header. Consider signing the sender identity in the plugin, or limiting what actions can be taken via sender resolution.

### 1.7 vCard/CSV Import Injection Risks (Contacts v2 §4.8)

No mention of input sanitization for imported data. vCard fields can contain arbitrary text that could end up in:
- HTML rendering (XSS via display_name or notes)
- SQL (if any dynamic query construction exists)
- Search vectors (tsvector injection is unlikely but unsanitized input in triggers is a smell)

**Recommendation:** Explicitly document input sanitization requirements for import. All imported text fields should be sanitized identically to API-created fields.

### 1.8 Photo Upload — Missing File Type Validation (Contacts v2 §4.6)

The photo upload endpoint has no documented validation. Could someone upload a .html file as a "photo" and have it served with a permissive Content-Type?

**Recommendation:** Validate MIME type (image/* only), file size limit, and ideally re-encode the image to strip EXIF data and embedded payloads.

---

## 2. Blind Spots

### 2.1 The `display_name` Auto-Compute Trigger Edge Cases (Contacts v2 §3.1)

The design says: "if structured fields are provided, auto-compute `display_name` from them. If `display_name` is explicitly set, it takes precedence."

**Unanswered questions:**
- What does "explicitly set" mean in a PATCH? If I send `{ given_name: "Troy", display_name: null }`, is that explicit? 
- What if only `given_name` is set but `family_name` is null? Is `display_name` just "Troy"?
- What about organizations (`contact_kind = 'organisation'`)? They don't have given/family names — does the trigger ignore structured fields for non-person contacts?
- What about agents (`contact_kind = 'agent'`)? Same question.
- What's the computation order? `prefix given middle family suffix`? With or without commas? `file_as` is described as "custom sort/file-as override" — does it affect `display_name` or only sort order?
- If a user sets `display_name` manually, then later updates `given_name`, does the manual override persist or get clobbered?

**Recommendation:** Specify the exact trigger logic with truth table for all contact_kind values and all combinations of null/non-null structured fields. Add a `display_name_locked` boolean or similar to distinguish manual override from computed.

### 2.2 Endpoint Normalization for New Types (Contacts v2 §3.4)

The current normalization trigger handles phone (E.164) and email (lowercase). The design adds: whatsapp, signal, discord, linkedin, twitter, mastodon, instagram, facebook, website, sip.

**Each of these has different normalization rules:**
- WhatsApp: phone number (same as phone)
- Signal: phone number  
- Discord: username#discriminator (deprecated) or just username
- LinkedIn: profile URL or vanity name
- Twitter/X: handle with or without @
- Mastodon: user@instance format
- Instagram: handle
- Facebook: profile URL or numeric ID
- Website: URL normalization (trailing slash, www prefix, protocol)
- SIP: URI normalization

**The design says "Update the normalization trigger to handle new types" but doesn't specify rules.** This is a non-trivial amount of work hiding behind one sentence.

**Recommendation:** Document normalization rules for each new type. Consider whether the unique constraint `(endpoint_type, normalized_value)` makes sense for all types (e.g., should two contacts really not be able to both have a `website` endpoint of `https://google.com`?).

### 2.3 Concurrent Merge Race Condition (Contacts v2 §4.7)

Two simultaneous merge requests involving the same contact (e.g., merge A+B and merge A+C) could corrupt data. The 13-step merge process isn't atomic unless wrapped in a serializable transaction.

**Recommendation:** The merge endpoint must use `SELECT ... FOR UPDATE` on both contacts, or run in a SERIALIZABLE transaction. Document this explicitly.

### 2.4 What Happens to the `birthday` Column? (Contacts v2 §3.3)

The migration copies `birthday` into `contact_date`, then says "can be deprecated or dropped in a subsequent release." But:
- The existing API exposes `birthday` as a top-level field
- The existing frontend reads `birthday`
- Agent tools may reference `birthday`

If it's kept for backward compat, you now have **two sources of truth** for birthday data. If someone updates `contact_date` birthday, does the `contact.birthday` column stay in sync? If someone updates `contact.birthday`, does the `contact_date` row update?

**Recommendation:** Either drop `birthday` immediately (breaking change, but clean) or add a bidirectional sync trigger (complex, dual source of truth). Don't leave both writable.

### 2.5 The `custom_fields` JSONB vs Table Tradeoff (Contacts v2 §3.6)

The design chose jsonb `[{"key": "Loyalty Number", "value": "ABC123"}]` on the contact row. Tradeoffs not discussed:

**JSONB pros:** Simple, no joins, fast for small datasets, schema-free.

**JSONB cons:**
- No indexing on individual custom field keys/values without GIN (not mentioned)
- No validation — duplicate keys, empty keys, non-string values all possible
- No search across contacts by custom field ("find all contacts with Loyalty Number = ABC123") without `jsonb_path_query` or GIN
- Max size is unbounded — someone could stuff megabytes into custom_fields
- No audit trail on individual field changes (the entire jsonb blob changes)
- `DEFAULT '[]'::jsonb` on existing rows — will this trigger a table rewrite? Depends on the PG version but `NOT NULL DEFAULT` on `ALTER TABLE ADD COLUMN` should be metadata-only in PG 11+.

**Recommendation:** If custom fields are "nice to have" for Google parity, jsonb is fine. If they'll be queried/filtered, you need a GIN index and size limits. Add a CHECK constraint: `jsonb_array_length(custom_fields) <= 50` and validate the shape in application code.

### 2.6 No Audit Trail for Contact Merge (Contacts v2 §4.7)

Merge is destructive: it moves records and soft-deletes a contact. There's no mention of:
- Recording which contacts were merged and when
- Who initiated the merge
- What the pre-merge state looked like
- How to undo a merge

The existing audit triggers will capture the individual row changes, but they won't capture the **semantic** action "these two contacts were merged."

**Recommendation:** Create a `contact_merge_log` table or at minimum store merge metadata in the survivor's `notes` or a new `merge_history` jsonb field.

### 2.7 Relationship Merge Collision (Contacts v2 §4.7 step 5)

"Move all relationship records (update contact_a_id and contact_b_id references)"

What if contacts A (survivor) and B (loser) both have a relationship to contact C? After merge, there would be duplicate relationships: A↔C (original) and A↔C (moved from B↔C). The dedup logic isn't specified.

Worse: what if A has `friend_of` with C and B has `colleague_of` with C? Which wins?

**Recommendation:** Define explicit merge rules for relationships. Options: keep both (different types), keep the one with more metadata, require user choice.

### 2.8 Work Item and Memory Link Deduplication (Contacts v2 §4.7 steps 8-9)

Same problem as relationships. If both contacts are linked to the same work item or memory, you get duplicate links after merge. The design says "Move all" but doesn't mention dedup.

**Recommendation:** Use `ON CONFLICT DO NOTHING` or explicit dedup for link tables.

### 2.9 No Discussion of Rate Limiting on Import (Contacts v2 §4.8)

A vCard file could contain 100,000 contacts. There's no mention of:
- Maximum import size
- Async processing for large imports
- Progress reporting
- Partial failure handling (what if contact 50,000 fails?)

**Recommendation:** Set a reasonable limit (e.g., 10,000 contacts per import), process asynchronously for >100 contacts, return a job ID for polling progress.

### 2.10 Namespace on Child Records (Contacts v2 §3.2, §3.3, §3.5)

`contact_address`, `contact_date`, and `contact_tag` all have their own `namespace` column. But they also have `contact_id` FK. **The namespace is redundant** — the namespace is determined by the parent contact. Having it on child records creates a consistency risk: what if the child's namespace differs from the parent's?

**Recommendation:** Either remove `namespace` from child tables (derive it from the parent contact via JOIN) or add a CHECK constraint / trigger that enforces child.namespace = parent.namespace. The existing `contact_endpoint` table does NOT have a namespace column — this is an inconsistency with the new tables.

---

## 3. Consistency Issues

### 3.1 `is_default` vs `is_home` Naming Conflict (Identity §2.5 vs existing schema)

Identity doc renames `namespace_grant.is_default` to `is_home`. But:
- The existing codebase uses `is_default` everywhere
- The unique partial index is `idx_namespace_grant_default`
- The document says rename the index to `idx_namespace_grant_home`

**But:** `namespace_grant` is also referenced in the Contacts v2 document implicitly (namespace scoping). Neither doc discusses updating the API response shape — clients that read `is_default` from the API will break.

**Recommendation:** Document the API response change. Consider keeping `is_default` as an alias in the API response for one release cycle.

### 3.2 Role Removal vs Permission Model Sufficiency (Identity §2.4 vs existing)

The Identity doc removes `namespace_grant.role` entirely and replaces it with a permission-namespace model. But:

**What `role` currently controls (inferred from schema):**
- `owner`: Can delete the namespace, manage grants, full CRUD on all entities
- `admin`: Same as owner minus namespace deletion
- `member`: Full CRUD on their own data within the namespace
- `observer`: Read-only access

**The permission-namespace model replaces this with binary membership.** This means:
- There's no read-only access anymore (every member is full CRUD)
- There's no distinction between "can manage other users' grants" and "can only manage their own data"
- The `platform_admin` permission namespace gives full admin, but there's no equivalent of `observer` for data namespaces

**This is a significant downgrade in access control granularity.** The document doesn't address this.

**Recommendation:** Either:
1. Keep a minimal role set (member/observer at minimum) on namespace_grant
2. Or explicitly document that all namespace members have full CRUD and the observer use case is dropped
3. Or add permission namespaces like `{ns}-readonly` for each data namespace (doesn't scale)

### 3.3 `contact_endpoint` Has No `namespace` Column (Existing vs Contacts v2 §3.2)

The existing `contact_endpoint` table has no `namespace` column. The new `contact_address`, `contact_date`, and `contact_tag` tables all add `namespace`. This is inconsistent.

Either all child tables should have `namespace` (and `contact_endpoint` needs it added) or none should (see §2.10 above for why it's redundant anyway).

### 3.4 `contact_endpoint` Unique Constraint vs Multi-Namespace (Existing schema)

`contact_endpoint` has `UNIQUE(endpoint_type, normalized_value)`. This is a **global** uniqueness constraint — no two contacts anywhere can have the same email, even in different namespaces.

The Identity doc relies on this for auth (§2.3): lookup by normalized_value in `default`. But:
- If a contact in namespace `troy` has email `troy@troykelly.com`, can another contact in namespace `tmt` also have it? Currently: **no** (the unique constraint prevents it).
- Is this intentional? It means an email address globally identifies a single contact across all namespaces.

The Contacts v2 doc doesn't discuss this, but the merge logic and import logic both need to be aware of it.

**Recommendation:** Document whether this global uniqueness is intentional and desired. If multi-namespace contacts should be allowed to share endpoints, the constraint needs to become `UNIQUE(endpoint_type, normalized_value, namespace)` — but then the Identity doc's auth flow breaks (which contact does an email resolve to?).

### 3.5 Auth-Linked Contact Must Be in `default` vs Contact Merge (Identity §2.2 vs Contacts v2 §4.7)

What if someone merges an auth-linked contact (in `default`) with a non-default-namespace contact? The merge logic says "repoint user_setting.contact_id to survivor" — but what if the survivor is in a non-default namespace? This violates the constraint from Identity §2.2.

**Recommendation:** Merge logic must validate that if either contact is auth-linked, the survivor must be in `default`. Preferably, the auth-linked contact should always be the survivor.

### 3.6 Contacts v2 Doesn't Reference the Identity Model Changes

The Contacts v2 doc was written alongside the Identity doc but doesn't reference:
- `user_setting.contact_id` (the new FK)
- The `default` namespace constraint for auth-linked contacts
- The removal of `namespace_grant.role`
- The permission-namespace model

This means the Contacts v2 API endpoints don't discuss what permission checks replace the current role checks. Every CRUD endpoint implicitly depends on authorization, but the authorization model is changing underneath.

**Recommendation:** Add a section to Contacts v2 that maps each endpoint to the required permissions under the new model.

---

## 4. Completeness Gaps

### 4.1 Missing API: Endpoint Update/Delete Needs Cascade Awareness

The new endpoint PATCH/DELETE (Contacts v2 §4.4) doesn't discuss:
- What happens when you delete the `preferred_endpoint_id`? Does the FK on `contact` go null?
- What happens when you delete an email endpoint that's someone's login email? (See §1.2)
- Can you change `endpoint_type` on an existing endpoint? (phone → email would be weird)

### 4.2 Missing: Contact Un-Merge / Undo

There's no way to undo a merge. Once contacts are merged, the loser is soft-deleted and all records are moved. If the merge was wrong, the admin has to manually restore and reassign everything.

### 4.3 Missing: Contact Transfer Between Namespaces

Neither document addresses moving a contact from one namespace to another. This comes up when:
- A contact was created in the wrong namespace
- Organizational restructuring
- A contact needs to be promoted to `default` for auth linking

### 4.4 Missing: Bulk Operations for New Entities

There's `/api/contacts/bulk` for bulk create, but no bulk operations for:
- Addresses (add home+work address in one call)
- Dates (add birthday+anniversary in one call)
- Endpoints (already exists via bulk create, but not for existing contacts)
- Tags (the POST endpoint accepts array, which is good)

### 4.5 Missing: Pagination on Child Endpoints

`GET /api/contacts/:id/addresses`, `/dates`, `/endpoints` — no mention of pagination. A contact unlikely has hundreds of addresses, but the pattern should be consistent with the rest of the API.

### 4.6 Missing: Error Response for Merge Conflicts

What does the merge endpoint return when:
- Both contacts have a `user_setting` link? (Can't have two humans become one)
- The contacts are in different namespaces? (See §1.3)
- The loser has active work items assigned?

### 4.7 Missing: Frontend — Contact Kind-Specific Forms

The form redesign (§5.2) is person-centric (given name, family name, etc.). What does the form look like for:
- `organisation`: No given/family name, but has a name. Should show different fields.
- `group`: Similar to org but conceptually different.
- `agent`: Probably needs endpoint config more than name fields.

### 4.8 Missing: Search Index Updates for New Fields

The design mentions updating the search trigger to index structured name fields (§3.1) but doesn't mention indexing:
- Tags (commonly searched)
- Custom field keys/values
- Address city/country (useful for "find all contacts in Sydney")
- Endpoint labels

### 4.9 Missing: OpenAPI Schemas for New Types

Section 4.9 says "All new endpoints must have complete OpenAPI path definitions" but doesn't provide them. The implementation order puts OpenAPI docs at step 11 (after all API work). This means 10 implementation steps happen without API contracts defined.

**Recommendation:** Move OpenAPI schema definition to step 1 or 2. Design the API contract first, implement second.

### 4.10 Missing: What Happens to `allow_schedule` and `allow_auto_reply_safe_only`?

These columns exist on the current `contact` table but aren't mentioned in either document. Are they being kept? Deprecated? They seem important for agent behavior.

---

## 5. Data Integrity Risks

### 5.1 Bootstrap Migration May Link Wrong Contacts (Identity §3.3)

The migration matches `user_setting.email` to `contact_endpoint.normalized_value` in `default`. But:
- What if there are multiple contacts with the same email in `default`? The migration picks "most recently updated" — but what if the wrong one is picked?
- What if the email exists on a contact that's an `organisation` or `group` kind? You'd link a human to a non-person contact.

**Recommendation:** Add `AND c.contact_kind = 'person'` to the migration query. Consider logging all auto-links for manual review.

### 5.2 `ON DELETE SET NULL` on `user_setting.contact_id` (Identity §3.1)

If a contact is deleted (hard delete), the user_setting.contact_id goes null. The user can still log in via the bootstrap flow. But:
- There's no notification that the link was broken
- The user's contact data is gone but their auth still works
- Soft delete (`deleted_at IS NOT NULL`) doesn't trigger `ON DELETE SET NULL` — so a soft-deleted contact still appears linked

**Recommendation:** Contact deletion should explicitly check for and handle auth-linked contacts. Probably: refuse to delete an auth-linked contact, or unlink first.

### 5.3 `contact_date` Migration Duplicates (Contacts v2 §3.3)

The birthday migration is:
```sql
INSERT INTO contact_date (contact_id, date_type, date_value, namespace)
SELECT id, 'birthday', birthday, namespace FROM contact WHERE birthday IS NOT NULL;
```

If run twice (e.g., failed migration retry), it creates duplicate rows. There's no unique constraint on `(contact_id, date_type)` — the design intentionally allows multiple dates of the same type (multiple anniversaries).

**Recommendation:** Add idempotency: `WHERE NOT EXISTS (SELECT 1 FROM contact_date cd WHERE cd.contact_id = contact.id AND cd.date_type = 'birthday')` or make the migration a one-shot with a migration version guard.

### 5.4 Enum Expansion Is Non-Reversible in PostgreSQL (Contacts v2 §3.4)

`ALTER TYPE contact_endpoint_type ADD VALUE` cannot be rolled back in a transaction. If the migration fails after adding some types but before completing, you're in an inconsistent state.

**Recommendation:** Document that enum expansion migrations must be run outside a transaction (`ALTER TYPE ... ADD VALUE` requires this in PG anyway). Consider switching to text + CHECK constraint instead of enum for endpoint_type, which is more flexible.

### 5.5 `is_primary` Constraint Only Prevents Multiple Primaries (Contacts v2 §3.2)

`UNIQUE INDEX ... WHERE is_primary = true` prevents two primary addresses per contact, but doesn't ensure there IS a primary. A contact with 3 addresses and no primary is valid by the schema but probably a UI bug.

**Recommendation:** Either enforce "first added is primary" via trigger, or handle "no primary" gracefully in the UI (treat the first as de facto primary).

### 5.6 Merge Step 10 — Repointing `user_setting.contact_id` (Contacts v2 §4.7)

"If loser has a `user_setting.contact_id` pointing to it → repoint to survivor"

But what if BOTH contacts have a `user_setting.contact_id`? You'd be merging two humans into one — two auth identities pointing to the same contact. The unique index on `user_setting.contact_id` would prevent this and the operation would fail.

**Recommendation:** Merge must reject (400 error) if both contacts are auth-linked.

---

## 6. Scalability Concerns

### 6.1 Auth Resolution: Two Lookups Per Request (Identity §2.3)

Every authenticated API request now does:
1. JWT verification
2. `contact_endpoint` lookup by email in `default` 
3. `contact` lookup by ID
4. `user_setting` lookup by contact_id
5. `namespace_grant` lookup for all memberships

Steps 2-5 are new overhead per request. Currently it's just JWT → user_setting.

**Recommendation:** Cache the resolved identity (email → contact → user_setting → grants) with short TTL (e.g., 60s). The contact-endpoint-to-user mapping changes very rarely.

### 6.2 Missing Indexes on New Tables

- `contact_address`: Has index on `contact_id` and `namespace` but not on `country_code` or `city` (common filter targets)
- `contact_date`: Has index on `contact_id` and `date_value` but not on `(date_type, date_value)` — searching "all birthdays this month" needs both
- `contact_tag`: Has index on `tag` and `namespace` but not on `(namespace, tag)` composite (for "all contacts with tag X in namespace Y")
- `contact.given_name`, `contact.family_name`: No indexes mentioned for the new name fields (sorting by family name is a common operation)

### 6.3 Unbounded Tag List (Contacts v2 §4.5)

`GET /api/tags` returns "all tags with contact counts." If there are thousands of tags, this is an unbounded query with aggregation. No pagination mentioned.

**Recommendation:** Add pagination and search/prefix filtering to the tags list endpoint.

### 6.4 N+1 on Contact Detail (Contacts v2 §5.3)

The contact detail view now loads: contact + endpoints + addresses + dates + tags + relationships + activity timeline + custom fields. If fetched as separate API calls, that's 7+ round trips. If fetched with eager loading, the query could be heavy.

**Recommendation:** Define a `GET /api/contacts/:id?include=endpoints,addresses,dates,tags,relationships` that does a single query with joins, or use a GraphQL-style approach.

### 6.5 Contact Search Across All Fields (Contacts v2 §5.4, §6.2)

"Search across all fields (not just display_name)" — if this means full-text search across `display_name`, `given_name`, `family_name`, `organization`, `job_title`, `notes`, plus endpoint values, plus addresses, plus tags, plus custom fields... the search vector and trigger logic becomes complex and potentially slow.

**Recommendation:** Define exactly which fields are in the tsvector. Consider separate search scopes (name search, full search) for performance.

---

## 7. Backward Compatibility

### 7.1 Role Removal is Catastrophically Breaking (Identity §3.2)

`ALTER TABLE namespace_grant DROP COLUMN role` will break:
- Every API endpoint that returns namespace_grant data including `role`
- Every frontend component that displays or checks roles
- Every permission check in the codebase that reads `role`
- The OpenAPI schema definitions
- Any external integrations reading the API

The document's open question #3 asks about keeping the column as deprecated — this should be the **strong default**, not an open question.

**Recommendation:** Phase 1: Add new permission checks alongside old role checks. Phase 2: Migrate all code to use permission checks. Phase 3: Deprecate role (stop writing it). Phase 4: Drop column. This should be at minimum a 2-release process.

### 7.2 `is_default` → `is_home` Rename (Identity §3.2)

Every query, API response, and frontend reference to `is_default` breaks. This includes:
- API clients that read/write `is_default`
- Frontend code referencing the field
- Any OpenClaw plugins or tools that use namespace selection

**Recommendation:** Keep `is_default` as an alias (computed column or API-level mapping) for at least one release.

### 7.3 `birthday` Field Dual Source of Truth (Contacts v2 §3.3)

If both `contact.birthday` and `contact_date(type='birthday')` exist, API consumers don't know which to read/write. The API response should either:
- Continue returning `birthday` as a top-level field (computed from `contact_date`)
- Or clearly document that `birthday` is deprecated and `dates[]` is the new source

### 7.4 Endpoint Type Enum Expansion (Contacts v2 §3.4)

Adding new enum values is forward-compatible (old code ignores unknown types) but:
- Old code with switch/case on endpoint_type will hit default/error cases
- Old validation that checks `IN ('phone', 'email', 'telegram', 'slack', 'github', 'webhook')` will reject new types
- The normalization trigger may throw on unrecognized types

### 7.5 `label` and `is_primary` on `contact_endpoint` (Contacts v2 §3.4)

These are new nullable columns — backward compatible for reads. But:
- If old code creates endpoints without `is_primary`, they default to `false`. A contact could have no primary endpoint.
- The UI needs to handle the transition period where old endpoints have no labels.

---

## 8. Naming/Convention Issues

### 8.1 `is_default` vs `is_home` vs `is_primary`

Three different boolean flags across the schema:
- `namespace_grant.is_default` → being renamed to `is_home`
- `contact_address.is_primary` → new
- `contact_endpoint.is_primary` → new

"Home" and "primary" mean similar things. Consider unifying the naming: either all use `is_primary` or all use `is_default`.

### 8.2 `contact_kind` Enum vs Contact Types in Design

The existing enum is: `person`, `organisation`, `group`, `agent`.
- `organisation` uses British spelling — consistent? The rest of the codebase should be checked.

### 8.3 `contact_date.date_value` vs Just `date`

`date_value` is redundant naming (it's in a date table, the column is obviously a date). Compare: `contact_address` doesn't use `address_street_address`, it uses `street_address`.

### 8.4 `contact_address_type` Enum is Too Restrictive

Only: `home`, `work`, `other`. Google Contacts also supports: `school`, `custom`. The existing `contact_date_type` has `other` for custom, but the `label` field is the escape hatch. This is fine but should be documented.

### 8.5 Table Naming: `contact_tag` vs Pattern

Existing pattern: `contact_endpoint`, `contact_external_identity`, `relationship`. New tables: `contact_address`, `contact_date`, `contact_tag`. The naming is consistent (entity_subentity) — this is fine.

### 8.6 `custom_fields` Default Shape

`DEFAULT '[]'::jsonb` — the structure is `[{"key": "...", "value": "..."}]` but there's no CHECK constraint validating the shape. Consider using an object `{}` instead of an array, which naturally prevents duplicate keys: `{"Loyalty Number": "ABC123"}`. The array format is more Google-like but less ergonomic for lookups.

### 8.7 `file_as` vs `display_name` vs `nickname`

Three human-readable name fields with overlapping purposes:
- `display_name`: What to show in the UI
- `file_as`: How to sort/file (e.g., "Kelly, Troy" vs "Troy Kelly")  
- `nickname`: Informal name

This is correct for Google/Outlook parity but should be documented: `display_name` is for display, `file_as` is for sorting, `nickname` is for informal reference.

---

## 9. Summary of Critical Items

### Must Fix Before Implementation

| # | Issue | Severity | Section |
|---|-------|----------|---------|
| 1 | Endpoint addition as login credential escalation | **Critical** | §1.2 |
| 2 | Cross-namespace data leakage via merge | **Critical** | §1.3 |
| 3 | Role removal is catastrophically breaking — needs phased approach | **Critical** | §7.1 |
| 4 | Observer/read-only access lost with role removal | **High** | §3.2 |
| 5 | Auth-linked contact merge into non-default namespace | **High** | §3.5 |
| 6 | `X-Sender-Id` spoofing allows user impersonation | **High** | §1.6 |
| 7 | Merge race condition needs transaction isolation | **High** | §2.3 |
| 8 | Both contacts auth-linked during merge | **High** | §5.6 |
| 9 | `birthday` dual source of truth | **Medium** | §2.4 |
| 10 | Namespace on child records inconsistent and redundant | **Medium** | §2.10, §3.3 |

### Should Address Before Implementation

| # | Issue | Section |
|---|-------|---------|
| 11 | `display_name` trigger logic unspecified | §2.1 |
| 12 | Endpoint normalization rules for new types unspecified | §2.2 |
| 13 | No audit trail for merge | §2.6 |
| 14 | Relationship merge collision handling | §2.7 |
| 15 | vCard import limits and async processing | §2.9 |
| 16 | Bootstrap migration may link wrong contacts | §5.1 |
| 17 | Auth resolution adds per-request overhead — needs caching | §6.1 |
| 18 | Missing indexes on new tables | §6.2 |
| 19 | Contacts v2 doesn't reference Identity model changes | §3.6 |
| 20 | OpenAPI schemas should be designed before implementation | §4.9 |

---

*End of review.*
