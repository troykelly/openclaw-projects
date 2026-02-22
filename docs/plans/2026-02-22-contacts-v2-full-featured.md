# Design: Contacts v2 — Full-Featured Contact Management

**Date:** 2026-02-22  
**Status:** Draft  
**Related:** Identity Model design (same epic), Google People API, Outlook Contacts  
**Goal:** Bring contacts to parity with Google Contacts / Outlook Contacts for both backend and frontend.

---

## 1. Current State

### 1.1 Backend Schema (What Exists)

**`contact` table:**
- `display_name` (text, required)
- `notes` (text)
- `organization` (text)
- `job_title` (text)
- `pronouns` (text)
- `language` (text, default 'en')
- `timezone` (text, IANA)
- `birthday` (date)
- `photo_url` (text)
- `contact_kind` (enum: person/organisation/group/agent)
- `preferred_endpoint_id` (FK → contact_endpoint)
- `preferred_channel` (enum: telegram/email/sms/voice)
- `quiet_hours_start/end` (time), `quiet_hours_timezone` (text)
- `urgency_override_channel` (enum)
- `notification_notes` (text)
- `relationship_type`, `relationship_notes` (legacy text fields, superseded by relationship table)
- `first_contact_date`, `last_contact_date` (auto-updated from messages)
- `namespace`, `search_vector`, `deleted_at`, timestamps
- Audit triggers, full-text search trigger

**`contact_endpoint` table:**
- `endpoint_type` (enum: phone/email/telegram/slack/github/webhook)
- `endpoint_value` (text), `normalized_value` (auto-computed by trigger)
- `metadata` (jsonb)
- `allow_privileged_actions` (boolean)
- Unique constraint: `(endpoint_type, normalized_value)`

**`contact_external_identity` table:**
- Provider sync (microsoft/google/linkedin/github)
- External ID, sync status, cursor, error, metadata

**`relationship` + `relationship_type` tables:**
- Full typed relationship graph (symmetric + directional)
- Pre-seeded types: partner_of, parent_of/child_of, sibling_of, friend_of, colleague_of, member_of, employs/employed_by, etc.
- Embeddings for semantic matching

### 1.2 Backend API (What Exists)

| Endpoint | Method | Notes |
|----------|--------|-------|
| `/api/contacts` | POST | Create (display_name, notes, contact_kind, comm prefs) |
| `/api/contacts/bulk` | POST | Bulk create with endpoints |
| `/api/contacts` | GET | List with search, pagination, namespace scoping |
| `/api/contacts/search` | GET | Search endpoint |
| `/api/contacts/suggest-match` | GET | Suggest matching contacts |
| `/api/contacts/:id` | GET | Get single contact |
| `/api/contacts/:id` | PATCH | Update (display_name, notes, contact_kind, comm prefs) |
| `/api/contacts/:id` | DELETE | Soft delete |
| `/api/contacts/:id/restore` | POST | Restore soft-deleted |
| `/api/contacts/:id/endpoints` | POST | Add endpoint |
| `/api/contacts/:id/work-items` | GET | Linked work items |
| `/api/contacts/:id/relationships` | GET | Relationships |
| `/api/contacts/:id/memories` | GET | Linked memories |
| `/api/relationships/set` | POST | Create/update relationship |

**Missing API endpoints:** Endpoint update/delete, address CRUD, date CRUD, URL CRUD, tag/label management, photo upload, contact merge, import/export (vCard/CSV).

### 1.3 Frontend (What Exists)

- **ContactForm**: name, email (single), company, role, phone (single), notes
- **ContactDetailSheet**: Header with avatar/initials, name, role, company. Info section with email, phone, company, role. Linked work items, linked communications.
- **ContactList**: Table with name, email, company, linked item count. Bulk selection with action bar.
- **ContactsPage**: List view with search, add button.
- **ContactDetailPage**: Full page with detail sheet.

**Frontend is at ~20% of target.** It treats contacts as having single email/phone, doesn't expose most backend fields, and has no relationship or communication preferences UI.

---

## 2. Gap Analysis: Google/Outlook Parity

### 2.1 Structured Name Fields

**Google People API**: `names[]` with `givenName`, `familyName`, `middleName`, `prefix`, `suffix`, `displayName`, `displayNameLastFirst`, `phoneticGivenName`, `phoneticMiddleName`, `phoneticFamilyName`.

**Current**: Only `display_name` (single text field).

**Needed**: Structured name fields. `display_name` is auto-computed from structured fields but can be overridden.

### 2.2 Multiple Addresses

**Google**: `addresses[]` with `type` (home/work/other), `formattedValue`, `streetAddress`, `extendedAddress`, `city`, `region`, `postalCode`, `country`, `countryCode`.

**Outlook**: Similar with `homeAddress`, `businessAddress`, `otherAddress`.

**Current**: None.

**Needed**: `contact_address` table with typed, structured addresses.

### 2.3 Multiple Dates

**Google**: `birthdays[]`, `events[]` (anniversary, custom).

**Current**: Single `birthday` date field.

**Needed**: `contact_date` table for multiple typed dates.

### 2.4 URLs / Web Presence

**Google**: `urls[]` with type (home, work, blog, profile, etc.).

**Current**: None (photo_url is a single field for the contact photo).

**Needed**: Either extend `contact_endpoint` types or create a `contact_url` table.

### 2.5 Endpoint Type Expansion

**Current enum**: phone, email, telegram, slack, github, webhook.

**Needed additions**: whatsapp, signal, discord, linkedin, twitter/x, mastodon, instagram, facebook, website, sip, custom.

Decision: Expand the `contact_endpoint_type` enum. The existing `metadata` jsonb field on `contact_endpoint` can carry type-specific data (e.g., label: "Work", "Personal", "Mobile").

### 2.6 Contact Tags/Labels

**Google**: `memberships[]` (contact group memberships). Contact groups = labels/tags.

**Outlook**: `categories[]`.

**Current**: No tagging system for contacts.

**Needed**: `contact_tag` junction table, or reuse the existing `label` table.

### 2.7 Photo Storage

**Current**: `photo_url` (text) — stores a URL but no upload/storage workflow.

**Needed**: Integration with `file_attachment` table. Upload endpoint that stores the image and sets `photo_url`.

### 2.8 Custom Fields

**Google**: `userDefined[]` with `key` and `value`.

**Outlook**: Extended properties.

**Current**: None (the `metadata` jsonb on `contact_endpoint` is per-endpoint, not per-contact).

**Needed**: `contact_custom_field` table, or a `custom_fields` jsonb column on `contact`.

### 2.9 Contact Merge

**Current**: No merge capability.

**Needed**: API endpoint that takes two contact IDs, merges all child records (endpoints, addresses, dates, relationships, work item links, memory links, external identities), deduplicates, and deletes the loser. If either contact is linked to a `user_setting`, repoint the link to the survivor.

### 2.10 Import/Export

**Current**: None.

**Needed**: vCard import/export (standard interchange), CSV import/export (spreadsheet users), Google/Microsoft sync (via existing `contact_external_identity` infrastructure).

---

## 3. Schema Changes

### 3.1 Structured Name Fields on `contact`

```sql
ALTER TABLE contact
  ADD COLUMN given_name text,
  ADD COLUMN family_name text,
  ADD COLUMN middle_name text,
  ADD COLUMN name_prefix text,       -- Mr, Ms, Dr, etc.
  ADD COLUMN name_suffix text,       -- Jr, Sr, III, PhD, etc.
  ADD COLUMN nickname text,
  ADD COLUMN phonetic_given_name text,
  ADD COLUMN phonetic_family_name text,
  ADD COLUMN file_as text,           -- Custom sort/file-as override
  ADD COLUMN display_name_locked boolean NOT NULL DEFAULT false;
    -- When true, display_name was manually set and won't be overwritten by the auto-compute trigger
```

**`display_name` computation rules:**

- If `display_name` is explicitly provided, it takes precedence (no auto-compute).
- If only structured fields are provided, `display_name` is auto-computed based on the contact's `language`/locale:
  - CJK locales (ja, zh, ko): `{family_name}{given_name}` (no space)
  - Hungarian (hu): `{family_name} {given_name}`
  - Most other locales: `{given_name} {family_name}`
  - With prefix/suffix: `{prefix} {computed_name}, {suffix}` where appropriate
- The structured fields are the source of truth. `display_name` is a computed convenience field. The UI should always display `display_name` but edit the structured fields.
- `file_as` allows a manual sort-key override (e.g., "Kelly, Troy" for Western alphabetical sorting regardless of display order).

Update the search trigger to index all structured name fields (given_name, family_name, nickname, phonetic variants).

Additional indexes for the new name fields:
```sql
CREATE INDEX idx_contact_family_name ON contact(family_name) WHERE family_name IS NOT NULL;
CREATE INDEX idx_contact_given_name ON contact(given_name) WHERE given_name IS NOT NULL;
```

### 3.2 `contact_address` Table

```sql
CREATE TYPE contact_address_type AS ENUM ('home', 'work', 'other');

CREATE TABLE contact_address (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  contact_id uuid NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  address_type contact_address_type NOT NULL DEFAULT 'home',
  label text,                         -- Custom label override
  street_address text,                -- Line 1
  extended_address text,              -- Line 2 (unit, suite, etc.)
  city text,
  region text,                        -- State/province
  postal_code text,
  country text,                       -- Country name
  country_code text                   -- ISO 3166-1 alpha-2
    CHECK (country_code IS NULL OR length(country_code) = 2),
  formatted_address text,             -- Auto-computed or manual override
  latitude double precision,
  longitude double precision,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contact_address_contact ON contact_address(contact_id);

-- Ensure at most one primary address per contact
CREATE UNIQUE INDEX idx_contact_address_primary
  ON contact_address(contact_id) WHERE is_primary = true;
```

### 3.3 `contact_date` Table

```sql
CREATE TYPE contact_date_type AS ENUM ('birthday', 'anniversary', 'other');

CREATE TABLE contact_date (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  contact_id uuid NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  date_type contact_date_type NOT NULL DEFAULT 'other',
  label text,                          -- Custom label (e.g., "Wedding anniversary")
  date_value date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contact_date_contact ON contact_date(contact_id);
CREATE INDEX idx_contact_date_date ON contact_date(date_value);
CREATE INDEX idx_contact_date_type_date ON contact_date(date_type, date_value);

-- Migrate existing birthday data
INSERT INTO contact_date (contact_id, date_type, date_value, namespace)
SELECT id, 'birthday', birthday, namespace FROM contact WHERE birthday IS NOT NULL;
```

After migration, drop the `contact.birthday` column to avoid dual source of truth:

```sql
ALTER TABLE contact DROP COLUMN birthday;
```

The API response includes a computed `birthday` field derived from `contact_date WHERE date_type = 'birthday' ORDER BY created_at LIMIT 1` for backward compatibility, but the column no longer exists on the table. All writes go through `contact_date`.

### 3.4 Endpoint Type Expansion

```sql
-- Add new endpoint types
ALTER TYPE contact_endpoint_type ADD VALUE IF NOT EXISTS 'whatsapp';
ALTER TYPE contact_endpoint_type ADD VALUE IF NOT EXISTS 'signal';
ALTER TYPE contact_endpoint_type ADD VALUE IF NOT EXISTS 'discord';
ALTER TYPE contact_endpoint_type ADD VALUE IF NOT EXISTS 'linkedin';
ALTER TYPE contact_endpoint_type ADD VALUE IF NOT EXISTS 'twitter';
ALTER TYPE contact_endpoint_type ADD VALUE IF NOT EXISTS 'mastodon';
ALTER TYPE contact_endpoint_type ADD VALUE IF NOT EXISTS 'instagram';
ALTER TYPE contact_endpoint_type ADD VALUE IF NOT EXISTS 'facebook';
ALTER TYPE contact_endpoint_type ADD VALUE IF NOT EXISTS 'website';
ALTER TYPE contact_endpoint_type ADD VALUE IF NOT EXISTS 'sip';

-- Add label field for endpoint sub-type (Home, Work, Mobile, etc.)
ALTER TABLE contact_endpoint ADD COLUMN label text;
-- Add is_primary flag
ALTER TABLE contact_endpoint ADD COLUMN is_primary boolean NOT NULL DEFAULT false;
-- Auth: only login-eligible email endpoints can be used for authentication
-- (see Identity Model design doc). Setting this is a privileged operation.
ALTER TABLE contact_endpoint ADD COLUMN is_login_eligible boolean NOT NULL DEFAULT false;
```

Update the normalization trigger to handle new types.

### 3.5 `contact_tag` Table

```sql
CREATE TABLE contact_tag (
  contact_id uuid NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
  tag text NOT NULL CHECK (length(trim(tag)) > 0 AND length(tag) <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, tag)
);

CREATE INDEX idx_contact_tag_tag ON contact_tag(tag);

-- Note: No namespace column on new child tables (contact_address, contact_date, contact_tag).
-- Namespace is inherited from the parent contact via JOIN. This avoids
-- inconsistency between child and parent namespace values.
-- The existing contact_endpoint table has a namespace column (added in migration 090),
-- which is technically redundant but kept for backward compatibility.
-- New child tables should NOT add namespace — query via JOIN to parent contact.
```

### 3.6 Custom Fields

Using a jsonb column on `contact` rather than a separate table, for simplicity:

```sql
ALTER TABLE contact ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_array_length(custom_fields) <= 50);
-- Structure: [{"key": "Loyalty Number", "value": "ABC123"}, ...]
-- Max 50 custom fields per contact. Shape validation (key/value strings) in application code.
-- GIN index for querying by custom field values:
CREATE INDEX idx_contact_custom_fields ON contact USING GIN (custom_fields jsonb_path_ops);
```

### 3.7 Legacy Field Cleanup

```sql
-- relationship_type and relationship_notes are superseded by the relationship table
-- Deprecate but don't drop yet
COMMENT ON COLUMN contact.relationship_type IS 'DEPRECATED: Use relationship table instead';
COMMENT ON COLUMN contact.relationship_notes IS 'DEPRECATED: Use relationship table instead';
```

---

## 4. API Changes

### 4.0 Contact Detail — Eager Loading

`GET /api/contacts/:id` supports an `include` query parameter to fetch related data in a single request:

```
GET /api/contacts/:id?include=endpoints,addresses,dates,tags,relationships
```

Without `include`, returns the contact only (backward compatible). With `include`, returns the contact plus the requested child collections. This avoids N+1 round trips from the frontend detail view.

### 4.1 Contact CRUD Updates

**POST /api/contacts** and **PATCH /api/contacts/:id** — Add fields:

- `given_name`, `family_name`, `middle_name`, `name_prefix`, `name_suffix`, `nickname`, `phonetic_given_name`, `phonetic_family_name`, `file_as`
- `custom_fields` (jsonb array)
- `tags` (string array — creates/syncs `contact_tag` rows)

### 4.2 Address CRUD

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/contacts/:id/addresses` | GET | List addresses |
| `/api/contacts/:id/addresses` | POST | Add address |
| `/api/contacts/:id/addresses/:addr_id` | PATCH | Update address |
| `/api/contacts/:id/addresses/:addr_id` | DELETE | Remove address |

### 4.3 Date CRUD

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/contacts/:id/dates` | GET | List dates |
| `/api/contacts/:id/dates` | POST | Add date |
| `/api/contacts/:id/dates/:date_id` | PATCH | Update date |
| `/api/contacts/:id/dates/:date_id` | DELETE | Remove date |

### 4.4 Endpoint Management (Expand Existing)

Currently only POST exists. Add:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/contacts/:id/endpoints` | GET | List endpoints |
| `/api/contacts/:id/endpoints/:ep_id` | PATCH | Update endpoint (label, metadata, is_primary) |
| `/api/contacts/:id/endpoints/:ep_id` | DELETE | Remove endpoint |

### 4.5 Tag Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/contacts/:id/tags` | GET | List tags |
| `/api/contacts/:id/tags` | POST | Add tag(s) |
| `/api/contacts/:id/tags/:tag` | DELETE | Remove tag |
| `/api/tags` | GET | List all tags with contact counts (for tag picker) |

### 4.6 Photo Upload

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/contacts/:id/photo` | POST | Upload photo (multipart/form-data) → stores in file_attachment, sets photo_url |
| `/api/contacts/:id/photo` | DELETE | Remove photo |

### 4.7 Contact Merge

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/contacts/merge` | POST | Merge two contacts. Body: `{ survivor_id, loser_id }` |

Merge logic:

**Pre-checks:**
- Both contacts must exist and be in the **same namespace** (no cross-namespace merges)
- If both contacts are auth-linked (`user_setting.contact_id`), reject with 400 (cannot merge two humans into one)
- If either contact is auth-linked, the auth-linked contact must be the survivor (swap if needed)
- Acquire `SELECT ... FOR UPDATE` on both contacts to prevent concurrent merges

**Steps:**
1. Verify pre-checks pass
2. Move all `contact_endpoint` records from loser → survivor (skip duplicates by normalized_value)
3. Move all `contact_address` records from loser → survivor
4. Move all `contact_date` records from loser → survivor (skip duplicate date_type+date_value)
5. Move all `relationship` records (update contact_a_id and contact_b_id references)
6. Move all `contact_tag` records (skip duplicates)
7. Move all `contact_external_identity` records (skip duplicate provider)
8. Move all `work_item_contact` links
9. Move all `memory_contact` links
10. If loser has a `user_setting.contact_id` pointing to it → repoint to survivor
11. Merge `custom_fields` arrays (union, dedup by key)
12. Backfill survivor's fields from loser where survivor is null (e.g., if survivor has no organization but loser does)
13. Record merge in `contact_merge_log` (survivor_id, loser_id, merged_by, merged_at, pre-merge snapshot of both contacts as jsonb)
14. Soft-delete the loser
15. Return the merged survivor contact

**Relationship merge rules:**
- If survivor and loser both have a relationship to the same contact with the **same** relationship type → keep survivor's, discard loser's duplicate
- If survivor and loser both have a relationship to the same contact with **different** relationship types → keep both (they represent different relationship aspects)
- Same dedup logic applies to work_item_contact and memory_contact links: skip duplicates by (contact_id, target_id)

**Audit:**
```sql
CREATE TABLE contact_merge_log (
  id uuid PRIMARY KEY DEFAULT new_uuid(),
  survivor_id uuid NOT NULL REFERENCES contact(id),
  loser_id uuid NOT NULL,  -- No FK since loser is soft-deleted
  merged_by text,           -- Email of human or agent ID that initiated
  survivor_snapshot jsonb NOT NULL,  -- Pre-merge state
  loser_snapshot jsonb NOT NULL,     -- Pre-merge state
  merged_at timestamptz NOT NULL DEFAULT now()
);
```

### 4.8 Import/Export

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/contacts/export` | GET | Export contacts as vCard 4.0 or CSV. Query param: `format=vcard\|csv` |
| `/api/contacts/import` | POST | Import from vCard or CSV. Multipart upload. Max 10,000 contacts per import. For >100 contacts, processes asynchronously and returns a job ID for polling. Returns created/updated/skipped/failed counts. Duplicate detection by normalized email endpoint. All imported fields sanitized identically to API-created fields. |

### 4.9 OpenAPI Documentation

All new and modified endpoints must have complete OpenAPI path definitions in `src/api/openapi/paths/`. This includes:

- Request/response schemas with examples
- Error responses (400, 401, 403, 404, 409)
- Query parameter documentation
- Tag grouping

---

## 5. Frontend Changes

### 5.1 Locale-Aware Name Rendering

The frontend must implement a `formatContactName(contact, locale?)` utility used **everywhere** a contact name is displayed — list views, detail views, search results, relationship labels, activity feeds, popovers, mentions, etc. This is not optional decoration; it's a core rendering function.

Behavior:
- Accepts structured name fields + the contact's `language` field (or falls back to the current user's locale, then platform default)
- Renders name in culturally correct order for that locale (e.g., `家族名 名前` for Japanese, `Given Family` for English)
- Falls back gracefully: if only `display_name` is set (no structured fields), use that as-is
- If only `given_name` is set, use just that — don't show "undefined" or empty family name
- The `display_name` stored in the DB is the canonical computed form, but the UI should prefer rendering from structured fields when available (they may be more up-to-date if the trigger hasn't fired yet, e.g., in optimistic updates)

This utility should be shared — not reimplemented per-component.

### 5.2 Contact Types Update

Update `src/ui/components/contacts/types.ts` to reflect full schema:

```typescript
interface Contact {
  id: string;
  display_name: string;
  given_name?: string;
  family_name?: string;
  middle_name?: string;
  name_prefix?: string;
  name_suffix?: string;
  nickname?: string;
  organization?: string;
  job_title?: string;
  pronouns?: string;
  language?: string;
  timezone?: string;
  contact_kind: 'person' | 'organisation' | 'group' | 'agent';
  photo_url?: string;
  
  // Multi-value fields
  endpoints: ContactEndpoint[];
  addresses: ContactAddress[];
  dates: ContactDate[];
  tags: string[];
  custom_fields: Array<{ key: string; value: string }>;
  
  // Communication prefs
  preferred_channel?: string;
  preferred_endpoint_id?: string;
  quiet_hours_start?: string;
  quiet_hours_end?: string;
  quiet_hours_timezone?: string;
  urgency_override_channel?: string;
  notification_notes?: string;
  
  // Metadata
  first_contact_date?: string;
  last_contact_date?: string;
  namespace: string;
  created_at: string;
  updated_at: string;
}

interface ContactEndpoint {
  id: string;
  endpoint_type: string;
  endpoint_value: string;
  label?: string;
  is_primary: boolean;
  metadata: Record<string, unknown>;
}

interface ContactAddress {
  id: string;
  address_type: 'home' | 'work' | 'other';
  label?: string;
  street_address?: string;
  extended_address?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
  country_code?: string;
  formatted_address?: string;
  latitude?: number;
  longitude?: number;
  is_primary: boolean;
}

interface ContactDate {
  id: string;
  date_type: 'birthday' | 'anniversary' | 'other';
  label?: string;
  date_value: string;
}
```

### 5.3 Contact Form Redesign

Replace the simple 6-field form with a sectioned editor:

1. **Name section**: Given name, Family name, Middle name, Prefix, Suffix, Nickname, Pronouns. Field order in the form should adapt to the contact's language/locale (family name first for CJK/Hungarian locales). Display name shown as a read-only preview that updates as fields change.
2. **Organization section**: Company, Job title
3. **Endpoints section**: Dynamic list — add/remove emails, phones, social accounts. Each with type selector and label. Primary indicator.
4. **Addresses section**: Dynamic list — structured address fields with type selector. Map preview (optional).
5. **Dates section**: Dynamic list — birthday, anniversary, custom dates.
6. **Tags section**: Tag input with autocomplete from existing tags.
7. **Communication prefs section**: Preferred channel, quiet hours, urgency override.
8. **Notes section**: Free text.
9. **Custom fields section**: Dynamic key-value pairs.

### 5.4 Contact Detail View

Redesign the detail sheet/page to show:

1. **Header**: Photo (with upload), name, pronouns, job title, organization
2. **Quick actions**: Call, email, message (using primary endpoints)
3. **Contact info sections**: Endpoints (grouped by type), Addresses, Dates
4. **Relationships section**: Visual display of relationships with other contacts
5. **Activity timeline**: Merged chronological view of messages, meetings, linked work items, memories
6. **Tags**: Displayed as badges
7. **Communication prefs**: Quiet hours, preferred channel
8. **Notes**: Expandable
9. **Custom fields**: Displayed as key-value pairs
10. **Metadata footer**: Created, last updated, last contact date, namespace

### 5.5 Contact List Enhancements

- Column customization (show/hide columns)
- Filter by: tag, organization, contact_kind, namespace, has phone/email
- Sort by: name, organization, last contact date, created date
- Search across all fields (not just display_name)
- Contact kind icons (person, org, group, agent)
- Quick-view popover on hover

### 5.6 Contact Merge UI

- Select two contacts → "Merge" action
- Side-by-side comparison showing which fields come from each
- Choose survivor or let the system pick (more data wins)
- Preview merged result before confirming

### 5.7 Import/Export UI

- Export: Button in contacts list toolbar, format picker (vCard/CSV)
- Import: Upload dialog accepting .vcf or .csv files, preview of contacts to be imported, conflict resolution (skip/update/create new)

---

## 6. Plugin/Agent Tool Changes

### 6.1 `contact_create` Tool

Add parameters for structured name fields, addresses, dates, tags, custom fields. The agent should be able to create a fully detailed contact in one call.

### 6.2 `contact_search` Tool

Add filters for tag, organization, contact_kind. Support search across all fields.

### 6.3 `contact_get` Tool

Return full contact detail including endpoints, addresses, dates, tags, relationships.

### 6.4 New Tools

- `contact_update` — update any contact field (currently the plugin doesn't expose PATCH)
- `contact_merge` — merge two contacts by ID
- `contact_endpoint_add/remove` — manage endpoints
- `contact_address_add/remove` — manage addresses

---

## 7. Implementation Order

This is designed to be incremental. Each step produces working, shippable code.

1. **Schema: Structured names + search** — Add name fields to contact, update search trigger
2. **Schema: contact_address table** — Create table, migration, API CRUD
3. **Schema: contact_date table** — Create table, migration with birthday data migration, API CRUD
4. **Schema: Endpoint expansion** — New types, label, is_primary. Endpoint update/delete API.
5. **Schema: contact_tag** — Create table, API. Tag management endpoints.
6. **Schema: custom_fields** — Add jsonb column, include in CRUD
7. **API: Contact CRUD updates** — Full-field create/update with all new fields
8. **API: Contact merge** — Merge endpoint with full child record handling
9. **API: Photo upload** — Integration with file_attachment
10. **API: Import/Export** — vCard and CSV
11. **API: OpenAPI docs** — Complete path definitions for all new/modified endpoints
12. **Frontend: Types + API hooks** — Update TypeScript types, add React Query hooks
13. **Frontend: Contact form redesign** — Sectioned editor with all fields
14. **Frontend: Contact detail view** — Full detail page with all sections
15. **Frontend: Contact list enhancements** — Columns, filters, sort, search
16. **Frontend: Merge UI** — Side-by-side comparison and merge
17. **Frontend: Import/Export UI** — Upload, preview, export
18. **Plugin: Tool updates** — Expand contact_create, add new tools
