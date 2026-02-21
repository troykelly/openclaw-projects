/**
 * Pure unit tests for the assembled OpenAPI 3.0.3 specification.
 * No database or server required — tests the assembleSpec() output directly.
 */
import { describe, it, expect } from 'vitest';
import { assembleSpec } from '../../src/api/openapi/index.ts';

describe('OpenAPI Spec Validity', () => {
  const spec = assembleSpec() as {
    openapi: string;
    info: { title: string; version: string };
    paths: Record<string, Record<string, unknown>>;
    components: {
      schemas: Record<string, unknown>;
      securitySchemes: Record<string, unknown>;
    };
    tags: Array<{ name: string; description: string }>;
    security: unknown[];
    servers: Array<{ url: string }>;
  };

  describe('Top-level structure', () => {
    it('has valid OpenAPI version', () => {
      expect(spec.openapi).toBe('3.0.3');
    });

    it('has info with title and version', () => {
      expect(spec.info.title).toBeDefined();
      expect(spec.info.version).toBeDefined();
    });

    it('has at least one server', () => {
      expect(spec.servers.length).toBeGreaterThanOrEqual(1);
    });

    it('has bearerAuth security scheme', () => {
      expect(spec.components.securitySchemes.bearerAuth).toBeDefined();
    });

    it('has global security requirement', () => {
      expect(spec.security).toEqual([{ bearerAuth: [] }]);
    });
  });

  describe('Path coverage', () => {
    const pathCount = Object.keys(spec.paths).length;

    it('documents at least 200 paths', () => {
      expect(pathCount).toBeGreaterThanOrEqual(200);
    });

    it('includes core domain paths', () => {
      const requiredPaths = [
        '/api/work-items',
        '/api/contacts',
        '/api/memory',
        '/api/notes',
        '/api/lists',
        '/api/health',
        '/api/auth/request-link',
      ];
      for (const p of requiredPaths) {
        expect(spec.paths).toHaveProperty(p);
      }
    });
  });

  describe('operationId uniqueness', () => {
    it('every operation has an operationId', () => {
      const missing: string[] = [];
      for (const [path, methods] of Object.entries(spec.paths)) {
        for (const [method, op] of Object.entries(methods as Record<string, { operationId?: string }>)) {
          if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
          if (!op.operationId) {
            missing.push(`${method.toUpperCase()} ${path}`);
          }
        }
      }
      expect(missing).toEqual([]);
    });

    it('all operationIds are unique', () => {
      const ids = new Map<string, string>();
      const duplicates: string[] = [];
      for (const [path, methods] of Object.entries(spec.paths)) {
        for (const [method, op] of Object.entries(methods as Record<string, { operationId?: string }>)) {
          if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
          if (op.operationId) {
            if (ids.has(op.operationId)) {
              duplicates.push(`${op.operationId} used by both ${ids.get(op.operationId)} and ${method.toUpperCase()} ${path}`);
            }
            ids.set(op.operationId, `${method.toUpperCase()} ${path}`);
          }
        }
      }
      expect(duplicates).toEqual([]);
    });
  });

  describe('$ref resolution', () => {
    it('all schema $refs resolve to defined schemas', () => {
      const definedSchemas = new Set(Object.keys(spec.components.schemas));
      const unresolvedRefs: string[] = [];

      function checkRefs(obj: unknown, location: string) {
        if (obj === null || obj === undefined || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
          obj.forEach((item, i) => checkRefs(item, `${location}[${i}]`));
          return;
        }
        const rec = obj as Record<string, unknown>;
        if (typeof rec['$ref'] === 'string') {
          const refStr = rec['$ref'] as string;
          const match = refStr.match(/^#\/components\/schemas\/(.+)$/);
          if (match && !definedSchemas.has(match[1])) {
            unresolvedRefs.push(`${location}: ${refStr}`);
          }
        }
        for (const [key, val] of Object.entries(rec)) {
          checkRefs(val, `${location}.${key}`);
        }
      }

      checkRefs(spec.paths, 'paths');
      checkRefs(spec.components.schemas, 'components.schemas');
      expect(unresolvedRefs).toEqual([]);
    });
  });

  describe('Tag consistency', () => {
    it('all tags referenced by operations are defined in tags array', () => {
      const definedTags = new Set(spec.tags.map((t) => t.name));
      const undefinedTags: string[] = [];

      for (const [path, methods] of Object.entries(spec.paths)) {
        for (const [method, op] of Object.entries(methods as Record<string, { tags?: string[] }>)) {
          if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
          if (op.tags) {
            for (const tag of op.tags) {
              if (!definedTags.has(tag)) {
                undefinedTags.push(`${method.toUpperCase()} ${path} uses undefined tag "${tag}"`);
              }
            }
          }
        }
      }
      expect(undefinedTags).toEqual([]);
    });

    it('every tag has a description', () => {
      const missingDesc = spec.tags.filter((t) => !t.description);
      expect(missingDesc).toEqual([]);
    });
  });

  describe('Schema quality', () => {
    it('schemas define at least 100 total schemas', () => {
      expect(Object.keys(spec.components.schemas).length).toBeGreaterThanOrEqual(100);
    });

    it('every operation has at least one response defined', () => {
      const noResponses: string[] = [];
      for (const [path, methods] of Object.entries(spec.paths)) {
        for (const [method, op] of Object.entries(methods as Record<string, { responses?: Record<string, unknown> }>)) {
          if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
          if (!op.responses || Object.keys(op.responses).length === 0) {
            noResponses.push(`${method.toUpperCase()} ${path}`);
          }
        }
      }
      expect(noResponses).toEqual([]);
    });

    it('every operation has a summary', () => {
      const noSummary: string[] = [];
      for (const [path, methods] of Object.entries(spec.paths)) {
        for (const [method, op] of Object.entries(methods as Record<string, { summary?: string }>)) {
          if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
          if (!op.summary) {
            noSummary.push(`${method.toUpperCase()} ${path}`);
          }
        }
      }
      expect(noSummary).toEqual([]);
    });
  });
});
