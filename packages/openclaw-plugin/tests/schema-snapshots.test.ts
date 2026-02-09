/**
 * Snapshot tests for JSON schema exports.
 *
 * These tests protect against unintended changes to the plugin's API contract.
 * If a schema change is intentional, update snapshots by running:
 *
 *   pnpm exec vitest run packages/openclaw-plugin/tests/schema-snapshots.test.ts -u
 *
 * Review the snapshot diff carefully before committing.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { zodToJsonSchema } from '../src/utils/zod-to-json-schema.js';

// Memory tool schemas
import { MemoryRecallParamsSchema, MemoryStoreParamsSchema, MemoryForgetParamsSchema } from '../src/tools/index.js';

// Project tool schemas
import { ProjectListParamsSchema, ProjectGetParamsSchema, ProjectCreateParamsSchema } from '../src/tools/index.js';

// Todo tool schemas
import { TodoListParamsSchema, TodoCreateParamsSchema, TodoCompleteParamsSchema } from '../src/tools/index.js';

// Contact tool schemas
import { ContactSearchParamsSchema, ContactGetParamsSchema, ContactCreateParamsSchema } from '../src/tools/index.js';

// Communication tool schemas
import { SmsSendParamsSchema, EmailSendParamsSchema, MessageSearchParamsSchema, ThreadListParamsSchema, ThreadGetParamsSchema } from '../src/tools/index.js';

// Note tool schemas
import { NoteCreateParamsSchema, NoteGetParamsSchema, NoteUpdateParamsSchema, NoteDeleteParamsSchema, NoteSearchParamsSchema } from '../src/tools/index.js';

// Relationship tool schemas
import { RelationshipSetParamsSchema, RelationshipQueryParamsSchema } from '../src/tools/index.js';

// Notebook tool schemas
import { NotebookListParamsSchema, NotebookCreateParamsSchema, NotebookGetParamsSchema } from '../src/tools/index.js';

// File share tool schemas
import { FileShareParamsSchema } from '../src/tools/index.js';

// Skill store tool schemas
import {
  SkillStorePutParamsSchema,
  SkillStoreGetParamsSchema,
  SkillStoreListParamsSchema,
  SkillStoreDeleteParamsSchema,
  SkillStoreSearchParamsSchema,
  SkillStoreCollectionsParamsSchema,
  SkillStoreAggregateParamsSchema,
} from '../src/tools/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, '..');

/**
 * All exported Zod param schemas mapped by tool name.
 * When a new tool is added, add its schema here and run with -u to generate the snapshot.
 */
const zodParamSchemas = {
  // Memory tools
  memory_recall: MemoryRecallParamsSchema,
  memory_store: MemoryStoreParamsSchema,
  memory_forget: MemoryForgetParamsSchema,

  // Project tools
  project_list: ProjectListParamsSchema,
  project_get: ProjectGetParamsSchema,
  project_create: ProjectCreateParamsSchema,

  // Todo tools
  todo_list: TodoListParamsSchema,
  todo_create: TodoCreateParamsSchema,
  todo_complete: TodoCompleteParamsSchema,

  // Contact tools
  contact_search: ContactSearchParamsSchema,
  contact_get: ContactGetParamsSchema,
  contact_create: ContactCreateParamsSchema,

  // Communication tools
  sms_send: SmsSendParamsSchema,
  email_send: EmailSendParamsSchema,
  message_search: MessageSearchParamsSchema,
  thread_list: ThreadListParamsSchema,
  thread_get: ThreadGetParamsSchema,

  // Note tools
  note_create: NoteCreateParamsSchema,
  note_get: NoteGetParamsSchema,
  note_update: NoteUpdateParamsSchema,
  note_delete: NoteDeleteParamsSchema,
  note_search: NoteSearchParamsSchema,

  // Relationship tools
  relationship_set: RelationshipSetParamsSchema,
  relationship_query: RelationshipQueryParamsSchema,

  // Notebook tools
  notebook_list: NotebookListParamsSchema,
  notebook_create: NotebookCreateParamsSchema,
  notebook_get: NotebookGetParamsSchema,

  // File share tools
  file_share: FileShareParamsSchema,

  // Skill store tools
  skill_store_put: SkillStorePutParamsSchema,
  skill_store_get: SkillStoreGetParamsSchema,
  skill_store_list: SkillStoreListParamsSchema,
  skill_store_delete: SkillStoreDeleteParamsSchema,
  skill_store_search: SkillStoreSearchParamsSchema,
  skill_store_collections: SkillStoreCollectionsParamsSchema,
  skill_store_aggregate: SkillStoreAggregateParamsSchema,
} as const;

describe('Schema Snapshots', () => {
  describe('Tool parameter JSON schemas (via zodToJsonSchema)', () => {
    for (const [toolName, zodSchema] of Object.entries(zodParamSchemas)) {
      it(`${toolName} parameter schema should match snapshot`, () => {
        const jsonSchema = zodToJsonSchema(zodSchema);
        expect(jsonSchema).toMatchSnapshot();
      });
    }
  });

  describe('Full tool list', () => {
    it('tool names should match snapshot', () => {
      const toolNames = Object.keys(zodParamSchemas).sort();
      expect(toolNames).toMatchSnapshot();
    });

    it('tool count should be tracked', () => {
      const count = Object.keys(zodParamSchemas).length;
      expect(count).toMatchSnapshot();
    });
  });

  describe('Manifest configSchema', () => {
    it('configSchema should match snapshot', () => {
      const manifestPath = join(packageRoot, 'openclaw.plugin.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      expect(manifest.configSchema).toMatchSnapshot();
    });

    it('full manifest structure (excluding configSchema) should match snapshot', () => {
      const manifestPath = join(packageRoot, 'openclaw.plugin.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      // Snapshot the stable manifest fields (id, name, description, kind, skills)
      // configSchema is tested separately above
      const { configSchema: _cs, uiHints: _ui, ...stableFields } = manifest;
      expect(stableFields).toMatchSnapshot();
    });

    it('manifest uiHints should match snapshot', () => {
      const manifestPath = join(packageRoot, 'openclaw.plugin.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      expect(manifest.uiHints).toMatchSnapshot();
    });
  });
});
