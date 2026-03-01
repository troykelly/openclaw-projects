/**
 * Assembles the complete OpenAPI 3.0.3 specification from all domain modules.
 */
import type { OpenApiDomainModule, SchemaObject } from './types.ts';
import { commonSchemas } from './schemas/common.ts';

// ---- Path module imports (added as modules are created) ----
import { healthPaths } from './paths/health.ts';
import { authPaths } from './paths/auth.ts';
import { namespacesPaths } from './paths/namespaces.ts';
import { usersPaths } from './paths/users.ts';
import { bootstrapPaths } from './paths/bootstrap.ts';
import { realtimePaths } from './paths/realtime.ts';
import { threadsPaths } from './paths/threads.ts';
import { workItemsPaths } from './paths/work-items.ts';
import { bulkOperationsPaths } from './paths/bulk-operations.ts';
import { backlogInboxPaths } from './paths/backlog-inbox.ts';
import { recurrencePaths } from './paths/recurrence.ts';
import { auditTimelinePaths } from './paths/audit-timeline.ts';
import { dependenciesLinksPaths } from './paths/dependencies-links.ts';
import { filesPaths } from './paths/files.ts';
import { contactsPaths } from './paths/contacts.ts';
import { memoriesPaths } from './paths/memories.ts';
import { notesPaths } from './paths/notes.ts';
import { notebooksPaths } from './paths/notebooks.ts';
import { relationshipsPaths } from './paths/relationships.ts';
import { skillStorePaths } from './paths/skill-store.ts';
// Communications & Miscellaneous domain modules
import { webhooksNotificationsPaths } from './paths/webhooks-notifications.ts';
import { analyticsPaths } from './paths/analytics.ts';
import { oauthDriveSyncPaths } from './paths/oauth-drive-sync.ts';
import { emailPaths } from './paths/email.ts';
import { calendarPaths } from './paths/calendar.ts';
import { geolocationPaths } from './paths/geolocation.ts';
import { contextsPaths } from './paths/contexts.ts';
import { identityPaths } from './paths/identity.ts';
import { listsPaths } from './paths/lists.ts';
import { pantryPaths } from './paths/pantry.ts';
import { devSessionsPaths } from './paths/dev-sessions.ts';
import { recipesMealsPaths } from './paths/recipes-meals.ts';
import { promptTemplatesPaths } from './paths/prompt-templates.ts';
import { inboundChannelsPaths } from './paths/inbound-channels.ts';
import { voicePaths } from './paths/voice.ts';
import { homeAutomationPaths } from './paths/home-automation.ts';
import { ingestPaths } from './paths/ingest.ts';
import { entityLinksPaths } from './paths/entity-links.ts';
import { activityPaths } from './paths/activity.ts';
import { namespaceMovesPaths } from './paths/namespace-moves.ts';
import { terminalPaths } from './paths/terminal.ts';
import { chatPaths } from './paths/chat.ts';

/** Derive the API server URL from PUBLIC_BASE_URL */
function deriveApiUrl(publicBaseUrl: string): string {
  try {
    const parsed = new URL(publicBaseUrl);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return publicBaseUrl;
    }
    parsed.hostname = `api.${parsed.hostname}`;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return publicBaseUrl;
  }
}

/** All domain modules — order determines tag ordering in the spec */
function allDomainModules(): OpenApiDomainModule[] {
  return [
    // Core Infrastructure — health, auth, namespaces, users, bootstrap, realtime, threads
    healthPaths(),
    authPaths(),
    namespacesPaths(),
    usersPaths(),
    bootstrapPaths(),
    realtimePaths(),
    threadsPaths(),
    // Work Items & Operations
    workItemsPaths(),
    bulkOperationsPaths(),
    backlogInboxPaths(),
    recurrencePaths(),
    auditTimelinePaths(),
    dependenciesLinksPaths(),
    filesPaths(),
    // Memory, Contacts & Content
    contactsPaths(),
    memoriesPaths(),
    notesPaths(),
    notebooksPaths(),
    relationshipsPaths(),
    skillStorePaths(),
    // Communications & Miscellaneous
    webhooksNotificationsPaths(),
    analyticsPaths(),
    oauthDriveSyncPaths(),
    emailPaths(),
    calendarPaths(),
    geolocationPaths(),
    contextsPaths(),
    identityPaths(),
    listsPaths(),
    pantryPaths(),
    devSessionsPaths(),
    recipesMealsPaths(),
    promptTemplatesPaths(),
    inboundChannelsPaths(),
    voicePaths(),
    homeAutomationPaths(),
    ingestPaths(),
    entityLinksPaths(),
    activityPaths(),
    namespaceMovesPaths(),
    // Terminal management (Epic #1667)
    terminalPaths(),
    // Agent Chat (Epic #1940)
    chatPaths(),
  ];
}

/** All shared schema collections */
function allSharedSchemas(): Record<string, SchemaObject> {
  return {
    ...commonSchemas(),
  };
}

/**
 * Assemble the complete OpenAPI 3.0.3 specification.
 * Called per-request from the /api/openapi.json endpoint.
 */
export function assembleSpec(): Record<string, unknown> {
  const modules = allDomainModules();

  // Merge all paths
  const paths: Record<string, Record<string, unknown>> = {};
  for (const mod of modules) {
    for (const [path, operations] of Object.entries(mod.paths)) {
      if (paths[path]) {
        Object.assign(paths[path], operations);
      } else {
        paths[path] = { ...operations };
      }
    }
  }

  // Merge domain-specific schemas with shared schemas
  const schemas: Record<string, SchemaObject> = { ...allSharedSchemas() };
  for (const mod of modules) {
    if (mod.schemas) {
      Object.assign(schemas, mod.schemas);
    }
  }

  // Collect tag definitions (deduplicate by name)
  const tagMap = new Map<string, { name: string; description: string }>();
  for (const mod of modules) {
    if (mod.tags) {
      for (const tag of mod.tags) {
        tagMap.set(tag.name, tag);
      }
    }
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'openclaw-projects API',
      version: '1.0.0',
      description:
        'Project management, memory storage, and communications backend for OpenClaw agents',
      contact: {
        name: 'OpenClaw',
        url: 'https://docs.openclaw.ai',
      },
    },
    servers: [
      {
        url: deriveApiUrl(process.env.PUBLIC_BASE_URL || 'http://localhost:3000'),
        description: 'API Server',
      },
    ],
    tags: [...tagMap.values()],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT Bearer token authentication',
        },
      },
      schemas,
    },
    security: [{ bearerAuth: [] }],
    paths,
  };
}
