# Plugin Tool Documentation, Discovery & Organization — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve agent tool discovery across 96+ tools by marking optional groups, rewriting all descriptions, adding a `tool_guide` meta-tool, fixing auto-recall bugs, adding bundled skills, and updating stale docs.

**Architecture:** Seven independent workstreams (A–G) targeting the plugin at `packages/openclaw-plugin/`. Workstreams are designed for parallel multi-agent delivery in isolated worktrees. Each workstream maps to 1–2 GitHub issues and PRs.

**Tech Stack:** TypeScript, Zod, Vitest, OpenClaw Plugin API

---

## Current State

- **88 tools registered** (63 inline in `register-openclaw.ts`, 25 via factory loops for terminal/dev-session)
- **8 tools unregistered** — `note_create/get/update/delete/search` and `notebook_list/create/get` have factories in `src/tools/notes.ts` and `src/tools/notebooks.ts` but are not wired into `register-openclaw.ts`
- **README says "27 tools"** — critically stale
- **`minRecallScore`** configured (default 0.7) but never enforced in hooks
- **`ToolDefinition`** interface has no `optional` field
- **Tool count test** at `tests/register-openclaw.test.ts:74` asserts `88`

---

## Workstream A — Optional Tool Groups + Note/Notebook Registration

**Issue title:** `Register note/notebook tools and add optional tool group support`

**Files:**
- Modify: `src/types/openclaw-api.ts:103-112` (ToolDefinition interface)
- Modify: `src/register-openclaw.ts:4147-4816` (tool registration)
- Modify: `tests/register-openclaw.test.ts:74` (tool count assertion)
- Modify: `tests/gateway/setup.ts:139` (EXPECTED_TOOLS — stale at 33)

### Step 1: Extend ToolDefinition

Add `optional?: boolean` and `group?: string` to the interface at `src/types/openclaw-api.ts:103`:

```typescript
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: AgentToolExecute;
  /** When true, tool requires explicit opt-in via agent tools.allow config */
  optional?: boolean;
  /** Logical group for discovery (e.g. "terminal", "api_management") */
  group?: string;
}
```

### Step 2: Register note and notebook tools

In `register-openclaw.ts`, add a factory registration loop for notes and notebooks, analogous to the dev-session pattern at lines 4791-4812. Import the 8 factory functions from `./tools/index.js`.

### Step 3: Mark optional tool groups

Set `optional: true` on these groups in `register-openclaw.ts`:

| Group | Tools | Count |
|-------|-------|-------|
| Terminal connections | `terminal_connection_*`, `terminal_credential_*` | 8 |
| Terminal sessions | `terminal_session_*`, `terminal_send_*`, `terminal_capture_*` | 7 |
| Terminal tunnels | `terminal_tunnel_*` | 3 |
| Terminal search | `terminal_search`, `terminal_annotate` | 2 |
| API management | `api_onboard`, `api_recall`, `api_get`, `api_list`, `api_update`, `api_credential_manage`, `api_refresh`, `api_remove`, `api_restore` | 9 |
| Dev sessions | `dev_session_*` | 5 |
| Outbound comms | `sms_send`, `email_send` | 2 |
| Prompt templates | `prompt_template_*` | 5 |
| Inbound routing | `inbound_destination_*` | 3 |
| Channel defaults | `channel_default_*` | 3 |
| Namespaces | `namespace_*` | 5 |
| Notes | `note_*` | 5 |
| Notebooks | `notebook_*` | 3 |
| File share | `file_share` | 1 |
| **Total optional** | | **61** |

**Required (always loaded):** memory (3), projects (4), todos (4), contacts (8), context_search (1), skill_store (7), relationships (2), entity links (3), threads (2), message_search (1), tool_guide (1 — workstream C) = **36 required**

### Step 4: Update test assertions

- `tests/register-openclaw.test.ts:74` — update tool count from `88` to `97` (88 + 8 notes/notebooks + 1 tool_guide from workstream C; coordinate with C)
- `tests/gateway/setup.ts:139` — update EXPECTED_TOOLS to include new tools

### Step 5: Run tests, verify, commit

```bash
cd /tmp/worktree-issue-N-optional-tool-groups
pnpm install --frozen-lockfile
pnpm run build
pnpm exec vitest run tests/register-openclaw.test.ts
```

---

## Workstream B1 — Improve Inline Tool Descriptions (63 tools)

**Issue title:** `Improve descriptions for 63 inline-registered tools`

**Files:**
- Modify: `src/register-openclaw.ts:4147-4737` (all `description:` fields on inline tools)

### Description Template

Every description MUST follow this format (target 150–250 characters):

```
<What it does>. <When to use / typical trigger>. <Prefer X when Y>. <Side effects>. <Prerequisites>.
```

### Priority Rewrites (worst first)

**POOR — complete rewrite needed:**

| Tool | Current | Proposed |
|------|---------|----------|
| `project_list` | "List projects for the user..." | "List all projects, optionally filtered by status (active/completed/archived). Use when browsing projects by status. For natural-language project searches, prefer project_search. Read-only." |
| `project_get` | "Get details about a specific project..." | "Get full details of a project by ID including description, status, and linked items. Use after finding a project via project_list or project_search. Read-only." |
| `project_create` | "Create a new project..." | "Create a new project with a name and optional description. Creates a work_item record. Use when the user wants to start tracking a new initiative or goal." |
| `todo_list` | "List todos, optionally filtered..." | "List todos filtered by project, status, or due date. Use for structured browsing. For natural-language task searches, prefer todo_search. For broad cross-entity context, prefer context_search. Read-only." |
| `todo_create` | "Create a new todo item..." | "Create a todo with title and optional project, due date, and priority. Creates a work_item record. Use when the user asks to track, remember, or schedule a specific task." |
| `todo_complete` | "Mark a todo as complete..." | "Mark a todo as completed by ID. Idempotent — safe to call multiple times. Cannot be undone. Use when the user confirms a task is done." |
| `contact_search` | "Search contacts by name..." | "Search contacts by name, email, phone, or tag. Use to find existing contacts before creating new ones. For resolving an inbound sender identity, prefer contact_resolve." |
| `contact_get` | "Get details about a specific contact..." | "Get full details of a contact by ID including endpoints, tags, notes, and relationships. Use after finding a contact via contact_search or contact_resolve. Read-only." |
| `contact_tag_add` | "Add tags to a contact..." | "Add one or more tags to a contact for categorization and filtering. Tags are used by contact_search for structured filtering. Idempotent for existing tags." |
| `contact_tag_remove` | "Remove a tag from a contact." | "Remove a tag from a contact. The tag must exist on the contact. Use to clean up incorrect or outdated categorization." |

**ADEQUATE — enhance with alternatives and side effects (all remaining inline tools).** Apply the same template. Key patterns:

- All `*_create` tools: add "Creates a [record type]"
- All `*_update` tools: add "Partial update — only provided fields change"
- All `*_delete` tools: add "Soft-delete — can be restored" or "Permanent — cannot be undone"
- All `*_search` tools: add "For broader cross-entity search, prefer context_search"
- `sms_send`: add "Requires Twilio configuration. Sends an actual SMS — irreversible."
- `email_send`: add "Requires Postmark configuration. Sends an actual email — irreversible."
- `contact_resolve`: already good — keep
- `contact_merge`: add "Irreversible — loser contact is soft-deleted"
- All `prompt_template_*`: add "Requires agentadmin access" where applicable
- All `channel_default_*`: add "Requires agentadmin access" where applicable
- All `namespace_*`: add "Requires owner or admin role" where applicable

### Step-by-step

1. Write a test that asserts every registered tool's description contains at least 2 sentences (basic quality gate)
2. Run it — expect failures for ~50 tools
3. Update all 63 inline descriptions in `register-openclaw.ts`
4. Run test — expect pass
5. Run full suite: `pnpm exec vitest run tests/register-openclaw.test.ts`
6. Commit

---

## Workstream B2 — Improve Factory Tool Descriptions (33 tools)

**Issue title:** `Improve descriptions for factory-registered tools (terminal, dev-session, notes, notebooks)`

**Files:**
- Modify: `src/tools/terminal-connections.ts` (8 tools)
- Modify: `src/tools/terminal-sessions.ts` (7 tools)
- Modify: `src/tools/terminal-tunnels.ts` (3 tools)
- Modify: `src/tools/terminal-search.ts` (2 tools)
- Modify: `src/tools/dev-sessions.ts` (5 tools)
- Modify: `src/tools/notes.ts` (5 tools)
- Modify: `src/tools/notebooks.ts` (3 tools)

### Same template as B1

Key patterns for this group:
- All `terminal_*` tools: add "Requires an active terminal connection" or "Requires an active terminal session" as prerequisite
- `terminal_send_command`: add "Executes a shell command on the remote host. Default 30s timeout."
- `terminal_send_keys`: add "Sends raw keystrokes — may trigger interactive prompts"
- `dev_session_create`: add "Creates a session record — use to track coding context across turns"
- `dev_session_complete`: add "Marks session as completed. Use when work is done, not for pausing"
- `note_create` vs `memory_store`: add "Use notes for long-form documents. Use memory_store for discrete facts and preferences"
- `note_delete`: add "Soft-delete — can be restored"

### Steps

1. Update all 33 factory tool descriptions
2. Run: `pnpm exec vitest run tests/` (full suite — factory tools may have individual test files)
3. Commit

---

## Workstream C — `tool_guide` Meta-Tool

**Issue title:** `Add tool_guide meta-tool for on-demand tool documentation`

**Files:**
- Create: `src/tool-guidance/catalog.ts`
- Create: `src/tools/tool-guide.ts`
- Modify: `src/tools/index.ts` (export)
- Modify: `src/register-openclaw.ts` (register)
- Create: `tests/tools/tool-guide.test.ts`

### Step 1: Write failing tests

```typescript
// tests/tools/tool-guide.test.ts
describe('tool_guide', () => {
  it('returns guidance for a specific tool name', async () => { ... });
  it('returns group overview with tool list', async () => { ... });
  it('returns task-based recommendations for a natural language task', async () => { ... });
  it('returns full catalog overview when no params given', async () => { ... });
  it('returns error for unknown tool name', async () => { ... });
  it('returns error for unknown group name', async () => { ... });
  it('catalog covers all registered tool names', async () => { ... });
});
```

### Step 2: Create the guidance catalog

`src/tool-guidance/catalog.ts`:

```typescript
export interface ToolGuidance {
  group: string;
  when_to_use: string;
  when_not_to_use: string;
  alternatives: string[];
  side_effects: string[];
  prerequisites: string[];
  example_calls: Array<{ description: string; params: Record<string, unknown> }>;
}

export interface GroupGuidance {
  description: string;
  tools: string[];
  workflow_tips: string;
  related_skills: string[];
}

export const TOOL_CATALOG: Record<string, ToolGuidance> = { ... };
export const GROUP_CATALOG: Record<string, GroupGuidance> = { ... };
```

**Groups (23):** memory, projects, todos, contacts, search, communication, threads, notes, notebooks, relationships, entity_links, skill_store, file_share, terminal_connections, terminal_sessions, terminal_tunnels, terminal_search, dev_sessions, api_management, prompt_templates, inbound_routing, channel_defaults, namespaces.

### Step 3: Create `tool_guide` tool factory

`src/tools/tool-guide.ts`:

```typescript
const ToolGuideParamsSchema = z.object({
  group: z.string().optional().describe('Tool group name (e.g. "memory", "terminal_sessions")'),
  tool: z.string().optional().describe('Specific tool name (e.g. "memory_store")'),
  task: z.string().optional().describe('Natural language task description to find matching tools'),
});
```

Logic:
- `tool` provided → return `TOOL_CATALOG[tool]`
- `group` provided → return `GROUP_CATALOG[group]`
- `task` provided → keyword match against descriptions, return top 5 tools
- Nothing provided → return list of all groups with tool counts

This tool is **purely local** — no API calls, no client needed.

### Step 4: Register in `register-openclaw.ts`

Register as a **required** tool (always available). Add to the inline tools section.

### Step 5: Run tests, verify, commit

---

## Workstream D — Update README.md

**Issue title:** `Update README to reflect all 97 tools and current feature set`

**Files:**
- Modify: `packages/openclaw-plugin/README.md`

### Changes

1. **Line 99, 313:** Fix tool count to actual number
2. **Lines 315–381:** Add all missing tool groups as tables (see workstream A group list)
3. **Line 133 (Features):** Add: Notes & Notebooks, Entity Links, Terminal Management, Dev Sessions, API Onboarding, Namespace Management, Inbound Routing, Prompt Templates, tool_guide
4. **Line 426 (Hooks):** Document graph-aware recall, minRecallScore enforcement, boundary wrapping

**Depends on:** A and C (need final tool count)

---

## Workstream E — Update Plugin Manifest

**Issue title:** `Update plugin manifest description and metadata`

**Files:**
- Modify: `packages/openclaw-plugin/openclaw.plugin.json`

### Changes

1. **Line 5 (description):** Change from "Memory provider with projects, todos, and contacts integration" to "Full-lifecycle agent backend: memory, projects, todos, contacts, terminal management, API integration, dev sessions, notes, communication, and namespace scoping"
2. Consider adding capability tags if the OpenClaw manifest schema supports them (file upstream issue if not)

**Can be bundled with D.**

---

## Workstream F — Add Bundled Skills (7 new skills)

**Issue title:** `Add 7 bundled skills for multi-tool workflows`

**Files (all new):**
- `skills/terminal-setup/SKILL.md`
- `skills/api-integration/SKILL.md`
- `skills/dev-session-report/SKILL.md`
- `skills/note-meeting/SKILL.md`
- `skills/namespace-audit/SKILL.md`
- `skills/contact-relationship-map/SKILL.md`
- `skills/weekly-review/SKILL.md`

### Skill template

```markdown
---
name: skill-name
description: One-line description
args:
  - name: arg_name
    description: What it is
    required: true/false
---

Step-by-step instructions using specific tool names...
```

Each skill should reference 3–5 tools and explain the workflow order.

**Depends on:** A (note/notebook tools registered) and B (descriptions make sense in skill context)

---

## Workstream G — Fix Auto-Recall Hooks

**Issue title:** `Enforce minRecallScore threshold and add provenance to recalled context`

**Files:**
- Modify: `src/hooks.ts:185-233` (fetchContext)
- Modify: `src/hooks.ts:375-460` (fetchGraphAwareContext)
- Modify: `tests/hooks.test.ts`

### Step 1: Write failing tests

```typescript
it('filters memories below minRecallScore', async () => { ... });
it('includes provenance markers in recalled context', async () => { ... });
it('includes context handling guidance note', async () => { ... });
```

### Step 2: Enforce minRecallScore in fetchContext()

At `hooks.ts:212`, after receiving memories:
```typescript
const minScore = config.minRecallScore ?? 0.7;
const filtered = memories.filter(m => (m.score ?? 0) >= minScore);
if (filtered.length === 0) return null;
```

Pass `config` (or `minRecallScore`) to `fetchContext()` — currently it only receives `max_results`.

### Step 3: Add provenance markers

At `hooks.ts:223`, change format from plain wrapped text to:
```
- [memory_type] (relevance: XX%) [boundary-wrapped content]
```

### Step 4: Add context handling guidance note

Prepend to the `prependContext` return:
```
[Recalled from long-term memory. For deeper investigation, use memory_recall, context_search, or tool_guide.]
```

### Step 5: Run tests, verify, commit

---

## Multi-Agent Delivery Matrix

| Agent | Workstream | Worktree Branch | Key Files | Blocked By |
|-------|-----------|----------------|-----------|------------|
| Agent 1 | **A** | `issue/N-optional-tool-groups` | `types/openclaw-api.ts`, `register-openclaw.ts`, tests | Nothing |
| Agent 2 | **B2** | `issue/N-factory-tool-descriptions` | `src/tools/*.ts` (7 files) | Nothing |
| Agent 3 | **G** | `issue/N-auto-recall-fixes` | `src/hooks.ts`, `tests/hooks.test.ts` | Nothing |
| Agent 4 | **C** | `issue/N-tool-guide-meta-tool` | new `src/tool-guidance/`, `src/tools/tool-guide.ts` | Nothing |
| Agent 5 | **E** | `issue/N-plugin-manifest-update` | `openclaw.plugin.json` | Nothing |

**After first wave merges:**

| Agent | Workstream | Blocked By |
|-------|-----------|------------|
| Agent 1 | **B1** (inline descriptions) | A merged (same file) |
| Agent 2 | **F** (bundled skills) | A merged (note/notebook tools) |
| Agent 3 | **D** (README) | A + C merged (final tool count) |

### Merge Order

```
Wave 1 (parallel):  A, B2, C, E, G
Wave 2 (after A):   B1, F
Wave 3 (after A+C): D
```

### Conflict Zones

- `register-openclaw.ts` — touched by A, B1, and C. **A merges first**, then B1 rebases, then C rebases.
- `tests/register-openclaw.test.ts` — tool count assertion touched by A and C. Coordinate: A sets to 96, C bumps to 97.

---

## Verification

After all PRs merged:

```bash
# Build
pnpm run build

# Full test suite
pnpm exec vitest run

# Verify tool count
pnpm exec vitest run tests/register-openclaw.test.ts

# Verify hook behavior
pnpm exec vitest run tests/hooks.test.ts

# Manual: Start plugin, verify tool_guide returns catalog
# Manual: Verify optional tools don't appear without opt-in
```

---

## Token Economics

| Change | Token Impact |
|--------|-------------|
| Description improvements (+60 chars avg x 96 tools) | +~1,440 tokens/session |
| Optional tools (61 tools hidden by default) | -~6,100 tokens/session for default agents |
| **Net for default agents** | **-~4,660 tokens/session** |
| tool_guide catalog (loaded on-demand) | 0 tokens (not in system prompt) |
