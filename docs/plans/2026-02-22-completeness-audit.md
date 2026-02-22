# openclaw-projects Completeness Audit
Date: 2026-02-22

## Critical (Broken/Non-functional)

### 1. HA Routes Plugin Built but Never Registered
- **Files:** `src/api/ha-routes.ts`
- **What's wrong:** A complete Fastify plugin (`haRoutesPlugin`) with 11 route handlers for `/api/ha/routines`, `/api/ha/anomalies`, and `/api/ha/observations` is exported but never imported or registered in `server.ts`. The file itself contains a TODO: `"TODO: Register this plugin in server.ts when wiring HA integration routes."`
- **Impact:** HA routine management, anomaly viewing, and observation browsing are completely inaccessible via API despite having full route handlers, service layer, and database tables.
- **Fix:** Add `app.register(haRoutesPlugin, { pool })` to `server.ts`, wire auth, and add to `authSkipPaths` if needed.

### 2. HA Dispatch Service Completely Disconnected
- **Files:** `src/api/ha-dispatch/service.ts`
- **What's wrong:** Bridges scored HA observations to the inbound routing system. The service is fully implemented but never imported by any other file (zero external references).
- **Fix:** Wire into the HA observation scorer output handler as described in the file's JSDoc.

### 3. Geolocation Provider Registration Functions Never Called
- **Files:**
  - `src/api/geolocation/providers/mqtt-provider.ts` → `registerMqttProvider()`
  - `src/api/geolocation/providers/webhook-provider.ts` → `registerWebhookProvider()`
  - `src/api/geolocation/providers/home-assistant.ts` → `registerHaProvider()`
- **What's wrong:** Each provider exports a `register*()` function that internally calls `registerProvider()` from the registry. But none of these registration functions are ever called from anywhere — the providers never register themselves at runtime.
- **Impact:** The geolocation provider CRUD API exists (routes in `server.ts`), but no provider implementations are available to actually process location data from MQTT, webhooks, or Home Assistant.
- **Fix:** Call `registerMqttProvider()`, `registerWebhookProvider()`, and `registerHaProvider()` during server startup (e.g., in a bootstrap module).

### 4. CommunicationsPage and ContactDetailPage Built but Unreachable
- **Files:**
  - `src/ui/pages/CommunicationsPage.tsx` — Full page with thread/message UI
  - `src/ui/pages/ContactDetailPage.tsx` — Full page with contact detail view
- **What's wrong:** Both pages are exported from `pages/index.ts` and `CommunicationsPage` is even referenced in `src/ui/lib/route-prefetch.ts`, but **neither is listed in `routes.tsx`**. Users cannot navigate to these pages.
- **Fix:** Add route entries in `routes.tsx` (e.g., `path: 'communications'` and `path: 'contacts/:id'`).


## Dead Code (Built but Never Wired)

### 5. Geolocation Analysis Subsystem (4 modules, ~1000+ lines)
- **Files:**
  - `src/api/geolocation/analysis/anomaly-detector.ts` — 0 external refs
  - `src/api/geolocation/analysis/automation-generator.ts` — 0 external refs
  - `src/api/geolocation/analysis/feedback-manager.ts` — 0 external refs
  - `src/api/geolocation/analysis/routine-detector.ts` — 0 external refs
- **What's wrong:** An entire HA observation analysis pipeline (detect routines, detect anomalies, generate automations, manage feedback) is implemented but never called. Contains TODOs referencing issues #1460, #1466.
- **Fix:** Wire into the HA event processing pipeline when the feedback loop (Epic) is ready.

### 6. Geolocation Tools (3 modules, gateway agent tools)
- **Files:**
  - `src/api/geolocation/tools/ha-anomalies-tool.ts` — 0 external refs
  - `src/api/geolocation/tools/ha-observations-tool.ts` — 0 external refs
  - `src/api/geolocation/tools/ha-routines-tool.ts` — 0 external refs
- **What's wrong:** Agent-facing tool wrappers for the HA subsystem. Never imported or registered.
- **Fix:** Register in the gateway plugin or tool registry when HA integration is wired.

### 7. Geolocation Processors (2 of 3 dead)
- **Files:**
  - `src/api/geolocation/processors/home-observer-processor.ts` — 0 refs (even within geo/)
  - `src/api/geolocation/processors/snapshot-writer.ts` — 0 refs (even within geo/)
- **What's wrong:** Processing pipeline stages that are implemented but never called.
- **Fix:** Wire into the HA event processing pipeline.

### 8. LLM Scorer for HA Observations
- **File:** `src/api/geolocation/scorers/llm-scorer.ts` — 0 external refs
- **What's wrong:** An LLM-based observation scorer (alternative to rule-based) is implemented but never imported.
- **Fix:** Register as an optional scorer strategy when LLM scoring is needed.

### 9. OAuth Gateway Plugin
- **File:** `src/api/oauth/gateway-plugin.ts`
- **What's wrong:** A complete OpenClaw gateway plugin that registers 7 gateway methods (`oauth.accounts.list`, `oauth.contacts.list`, `oauth.email.list`, etc.) for agent access to OAuth data. Never imported or referenced in `server.ts` or any gateway configuration.
- **Fix:** Register in the gateway plugin configuration.

### 10. 18 Orphaned UI Component Directories (99+ files)
None of these component directories are imported by any page, layout, or other component:

| Directory | Files | Description |
|-----------|-------|-------------|
| `components/dashboard/` | 10 | Dashboard grid, widgets, widget picker (DashboardPage implements its own inline) |
| `components/import-export/` | 8 | CSV import/export dialogs, column mapper, preview |
| `components/calendar-view/` | 7 | Calendar month/week views, calendar items |
| `components/watchers/` | 7 | Watch button, watcher list, add-watcher dialog |
| `components/activity-feed/` | 7 | Activity detail cards, filters, personalization |
| `components/keyboard-navigation/` | 6 | Arrow key navigation, focus management |
| `components/mobile/` | 6 | Mobile-specific navigation and touch handlers |
| `components/timeline-nav/` | 6 | Date navigation, zoom controls, today indicator |
| `components/custom-fields/` | 6 | Custom field inputs, manager, validation |
| `components/templates/` | 6 | Work item template selector, save/manager |
| `components/baselines/` | 5 | Baseline comparison, list, create dialog |
| `components/workload/` | 5 | Workload bars, capacity indicators, team cards |
| `components/performance/` | 5 | Virtual list, infinite scroll, lazy load |
| `components/recipes/` | 4 | Recipe UI components |
| `components/meal-log/` | 4 | Meal logging UI components |
| `components/dev-sessions/` | 4 | Dev session list, card, detail views |
| `components/a11y/` | 3 | Route announcer, skip link |
| `components/notifications/` | 2 | Notification bell (never mounted in any layout) |

**Total: ~99 orphaned component files.**

### 11. 6 Orphaned React Query Hooks
- **Files:**
  - `src/ui/hooks/queries/use-dev-sessions.ts`
  - `src/ui/hooks/queries/use-meal-log.ts`
  - `src/ui/hooks/queries/use-recipes.ts`
  - `src/ui/hooks/queries/use-notifications.ts`
  - `src/ui/hooks/queries/use-communications.ts`
  - `src/ui/hooks/queries/use-global-communications.ts`
- **What's wrong:** Query hooks that fetch from APIs but are never used by any component or page.
- **Fix:** Remove or wire into the corresponding page components.

### 12. 3 Orphaned Zustand Stores
- **Files:**
  - `src/ui/stores/preference-store.ts` — `usePreferenceStore` — 0 external refs
  - `src/ui/stores/selection-store.ts` — `useSelectionStore` — 0 external refs
  - `src/ui/stores/ui-store.ts` — `useUiStore` — 0 external refs
- **What's wrong:** Three complete Zustand stores (preferences, selection state, UI modals) are defined but never imported or used. The app likely uses inline state or different state management.
- **Fix:** Remove or integrate into the app shell/pages.


## Partial Implementation (Missing Pieces)

### 13. HA Integration: Backend Pipeline Wired, Frontend Missing
- **Status:** The core HA event processing pipeline IS wired (`ha-event-processor` → `ha-event-router` → `ha-observation-scorer` → `ha-entity-tiers`). The pipeline appears functional for ingesting and scoring observations.
- **Missing:**
  - Routes (`ha-routes.ts`) are not registered → no API access
  - Analysis layer (routine detection, anomaly detection, feedback) → not wired
  - Dispatch layer (`ha-dispatch`) → not wired
  - Tools for agents → not registered
  - No UI components for HA data

### 14. Recipes & Meal Log: Full Backend, No UI
- **Backend:** API routes for recipes (`/api/recipes/*`) and meal log (`/api/meal-log/*`) are fully registered in `server.ts` with CRUD endpoints.
- **Frontend:** Component directories exist (`components/recipes/`, `components/meal-log/`) and query hooks exist (`use-recipes.ts`, `use-meal-log.ts`) but:
  - No page in `routes.tsx` routes to these components
  - The hooks are never called
  - The components are never rendered

### 15. Dev Sessions: Full Backend, No UI Route
- **Backend:** Full CRUD at `/api/dev-sessions/*` is registered in `server.ts`.
- **Frontend:** Components exist (`components/dev-sessions/`), hook exists (`use-dev-sessions.ts`), but no route exposes them.

### 16. Notifications: API Exists, Bell Never Mounted
- **Backend:** Notification endpoints exist in `server.ts` (~53 references to notification tables).
- **Frontend:** `NotificationBell` component exists, query hook exists (`use-notifications.ts`), but the bell component is **never imported** in any layout or page. Users have no way to see notifications in the UI.
- **Fix:** Mount `NotificationBell` in the app layout header.

### 17. Database Tables with No API Surface
The following tables exist in migrations but have no CRUD endpoints:
- `ha_anomalies` — 0 refs in server.ts (blocked by ha-routes not being registered)
- `ha_observations` — 0 refs in server.ts (blocked by ha-routes not being registered)
- `ha_routine_feedback` — 0 refs in server.ts
- `ha_routines` — 0 refs in server.ts (blocked by ha-routes not being registered)
- `ha_state_snapshots` — 0 refs in server.ts
- `ha_entity_tier_config` — 0 refs in server.ts


## TODO/FIXME Items

### Missing Functionality
1. **`src/api/ha-routes.ts:7`** — `TODO: Register this plugin in server.ts when wiring HA integration routes.`
   - **Severity:** High — blocking all HA route access
2. **`src/api/geolocation/analysis/feedback-manager.ts:210`** — `TODO: The routine API confirm/reject endpoints (#1460) should call...`
   - **Severity:** Medium — feedback loop not integrated
3. **`src/api/geolocation/analysis/feedback-manager.ts:214`** — `TODO: The routine detector (#1456) should apply organic growth (+0.02...`
   - **Severity:** Medium — routine confidence scoring incomplete
4. **`src/api/geolocation/tools/ha-routines-tool.ts:286`** — `TODO: When #1466 feedback loop is integrated, record feedback here`
   - **Severity:** Medium — tool feedback not connected
5. **`src/api/embeddings/work-item-integration.ts:23`** — `TODO: If two concurrent updates race on the same work item, the slower...`
   - **Severity:** Low — potential race condition, but unlikely to cause data loss

### Cleanup
6. **`src/ui/pages/NotesPage.tsx:58`** — `TODO: Add error reporting service integration (#664)`
   - **Severity:** Low — error reporting nice-to-have


## Documentation Gaps

### Undocumented Environment Variables (14)
The following `process.env.*` references exist in source code but are NOT in `.env.example`:

| Variable | Location | Description |
|----------|----------|-------------|
| `GEO_TOKEN_ENCRYPTION_KEY` | geolocation/crypto.ts | Encryption key for geo provider credentials |
| `FILE_SHARE_MODE` | file-storage/ | File sharing mode configuration |
| `INBOUND_DEFAULT_AGENT_EMAIL` | server.ts/bootstrap | Default agent for email inbound |
| `INBOUND_DEFAULT_AGENT_HA` | server.ts/bootstrap | Default agent for HA inbound |
| `INBOUND_DEFAULT_AGENT_SMS` | server.ts/bootstrap | Default agent for SMS inbound |
| `INBOUND_DEFAULT_PROMPT_EMAIL` | server.ts/bootstrap | Default prompt template for email |
| `INBOUND_DEFAULT_PROMPT_HA` | server.ts/bootstrap | Default prompt template for HA |
| `INBOUND_DEFAULT_PROMPT_SMS` | server.ts/bootstrap | Default prompt template for SMS |
| `NOTE_PRESENCE_TIMEOUT_MINUTES` | notes/ | Collaborative presence timeout |
| `OAUTH_SYNC_CONTACTS_INTERVAL` | oauth/ | Contact sync interval |
| `OPENCLAW_HOOK_TOKEN` | webhooks/ | Webhook authentication token |
| `WORKER_HEALTH_PORT` | worker/ | Worker health check port |
| `WORKER_POLL_INTERVAL_MS` | worker/ | Job polling interval |
| `WORKER_POOL_MAX` | worker/ | Max worker pool connections |

### Missing Test Files (21 API directories)
The following `src/api/` directories have no test files:
- `audit/`, `bootstrap/`, `cloudflare-email/`, `context/`, `embeddings/`, `file-storage/`, `jobs/`, `notebooks/`, `notes/`, `openapi/`, `postmark/`, `rate-limit/`, `realtime/`, `recurrence/`, `relationship-types/`, `relationships/`, `soft-delete/`, `static/`, `threads/`, `twilio/`, `utils/`

### OpenAPI Documentation
The OpenAPI spec assembly (`src/api/openapi/`) appears comprehensive with 40 path modules covering all major route groups. The `home-automation.ts` OpenAPI path module exists documenting the HA routes — but the actual routes aren't registered, so the docs describe endpoints that don't exist at runtime.

### CI/CD Coverage
All 6 production Dockerfiles in `docker/` (api, app, migrate, postgres, prompt-guard, worker) are built by `.github/workflows/containers.yml`. No gaps found.


## Summary

### Totals
| Category | Count |
|----------|-------|
| **Critical (Broken/Non-functional)** | 4 issues |
| **Dead Code (Built but Never Wired)** | 12 categories (~150+ files) |
| **Partial Implementation** | 5 features |
| **TODO/FIXME** | 6 items |
| **Undocumented Env Vars** | 14 variables |
| **API Dirs Without Tests** | 21 directories |

### Recommended Priority Order

1. **Register `ha-routes.ts` in server.ts** — Quick win, unlocks the entire HA integration backend that's already built and tested.
2. **Call geo provider registration functions** — Without this, the geo provider CRUD API creates records but no provider implementation processes them.
3. **Add CommunicationsPage and ContactDetailPage to routes.tsx** — Pages are fully built, just need route entries.
4. **Mount NotificationBell in app layout** — Component exists, just needs to be imported in the header.
5. **Wire HA dispatch service** — Connects scored observations to the inbound routing system.
6. **Register OAuth gateway plugin** — Enables agent access to connected account data.
7. **Add routes for recipes, meal-log, dev-sessions pages** — Backend APIs work, UI components exist, just need router wiring.
8. **Document 14 missing env vars in .env.example** — Configuration documentation gap.
9. **Wire geo analysis subsystem** — Larger effort, connects routine detection and anomaly detection.
10. **Remove or integrate orphaned UI components** — 99+ dead files creating maintenance burden. Either integrate into pages or remove to reduce codebase size.
11. **Remove or integrate orphaned stores/hooks** — 3 Zustand stores and 6 query hooks contributing nothing.
12. **Add tests for 21 untested API directories** — Test coverage gap for significant backend surface area.
