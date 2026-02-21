/**
 * Assembles the complete OpenAPI 3.0.3 specification from all domain modules.
 */
import type { OpenApiDomainModule, SchemaObject } from './types.ts';
import { commonSchemas } from './schemas/common.ts';

// ---- Path module imports (added as modules are created) ----
// import { healthPaths } from './paths/health.ts';

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
    // Modules will be added here as they are created by the agent team
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
