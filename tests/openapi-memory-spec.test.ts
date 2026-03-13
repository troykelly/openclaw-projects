import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/api/server.ts';

/**
 * Tests for OpenAPI spec accuracy for memory endpoints.
 * Issue #2456: Fix OpenAPI spec accuracy and add new endpoint specs
 *
 * Acceptance criteria:
 * - Search endpoint spec field names match implementation
 * - All input schemas include validation bounds
 * - New endpoints have complete specs
 * - 403 and 429 error responses documented on all endpoints
 * - Legacy endpoints marked as deprecated in spec
 */
describe('OpenAPI Memory Spec Accuracy (#2456)', () => {
  const app = buildServer();
  let spec: Record<string, unknown>;

  beforeAll(async () => {
    await app.ready();
    const res = await app.inject({
      method: 'GET',
      url: '/openapi.json',
    });
    spec = res.json();
  });

  afterAll(async () => {
    await app.close();
  });

  function getPaths(): Record<string, Record<string, unknown>> {
    return (spec as { paths: Record<string, Record<string, unknown>> }).paths;
  }

  function getSchemas(): Record<string, Record<string, unknown>> {
    return ((spec as { components: { schemas: Record<string, Record<string, unknown>> } }).components).schemas;
  }

  describe('Search endpoint spec matches implementation', () => {
    it('search response uses "results" not "memories" as the array field', () => {
      const paths = getPaths();
      const searchPath = paths['/memories/search'] as Record<string, unknown>;
      expect(searchPath).toBeDefined();

      const getOp = searchPath.get as Record<string, unknown>;
      expect(getOp).toBeDefined();

      const responses = getOp.responses as Record<string, unknown>;
      const ok = responses['200'] as Record<string, unknown>;
      const content = ok.content as Record<string, unknown>;
      const jsonSchema = (content['application/json'] as Record<string, unknown>).schema as Record<string, unknown>;
      const props = jsonSchema.properties as Record<string, unknown>;

      // Should have 'results', not 'memories'
      expect(props.results).toBeDefined();
      expect(props.memories).toBeUndefined();
    });

    it('search response includes search_type field', () => {
      const paths = getPaths();
      const searchPath = paths['/memories/search'] as Record<string, unknown>;
      const getOp = searchPath.get as Record<string, unknown>;
      const responses = getOp.responses as Record<string, unknown>;
      const ok = responses['200'] as Record<string, unknown>;
      const content = ok.content as Record<string, unknown>;
      const jsonSchema = (content['application/json'] as Record<string, unknown>).schema as Record<string, unknown>;
      const props = jsonSchema.properties as Record<string, unknown>;

      expect(props.search_type).toBeDefined();
    });

    it('search response includes embedding_provider field', () => {
      const paths = getPaths();
      const searchPath = paths['/memories/search'] as Record<string, unknown>;
      const getOp = searchPath.get as Record<string, unknown>;
      const responses = getOp.responses as Record<string, unknown>;
      const ok = responses['200'] as Record<string, unknown>;
      const content = ok.content as Record<string, unknown>;
      const jsonSchema = (content['application/json'] as Record<string, unknown>).schema as Record<string, unknown>;
      const props = jsonSchema.properties as Record<string, unknown>;

      expect(props.embedding_provider).toBeDefined();
    });
  });

  describe('Validation bounds on input schemas', () => {
    it('UnifiedMemoryCreateInput has confidence bounds (0-1)', () => {
      const schemas = getSchemas();
      const schema = schemas.UnifiedMemoryCreateInput as Record<string, unknown>;
      const props = schema.properties as Record<string, unknown>;
      const confidence = props.confidence as Record<string, unknown>;

      expect(confidence.minimum).toBe(0);
      expect(confidence.maximum).toBe(1);
    });

    it('UnifiedMemoryCreateInput has importance bounds (0-1)', () => {
      const schemas = getSchemas();
      const schema = schemas.UnifiedMemoryCreateInput as Record<string, unknown>;
      const props = schema.properties as Record<string, unknown>;
      const importance = props.importance as Record<string, unknown>;

      expect(importance.minimum).toBe(0);
      expect(importance.maximum).toBe(1);
    });

    it('UnifiedMemoryCreateInput has content maxLength', () => {
      const schemas = getSchemas();
      const schema = schemas.UnifiedMemoryCreateInput as Record<string, unknown>;
      const props = schema.properties as Record<string, unknown>;
      const content = props.content as Record<string, unknown>;

      expect(content.maxLength).toBeDefined();
      expect(content.maxLength).toBeGreaterThan(0);
    });

    it('UnifiedMemoryCreateInput has tags maxItems', () => {
      const schemas = getSchemas();
      const schema = schemas.UnifiedMemoryCreateInput as Record<string, unknown>;
      const props = schema.properties as Record<string, unknown>;
      const tags = props.tags as Record<string, unknown>;

      expect(tags.maxItems).toBeDefined();
      expect(tags.maxItems).toBeGreaterThan(0);
    });
  });

  describe('New endpoint specs exist', () => {
    it('POST /memories/digest has complete spec', () => {
      const paths = getPaths();
      const digestPath = paths['/memories/digest'] as Record<string, unknown>;
      expect(digestPath).toBeDefined();

      const postOp = digestPath.post as Record<string, unknown>;
      expect(postOp).toBeDefined();
      expect(postOp.operationId).toBeDefined();
      expect(postOp.summary).toBeDefined();
      expect(postOp.responses).toBeDefined();
    });

    it('POST /memories/reap has complete spec', () => {
      const paths = getPaths();
      const reapPath = paths['/memories/reap'] as Record<string, unknown>;
      expect(reapPath).toBeDefined();

      const postOp = reapPath.post as Record<string, unknown>;
      expect(postOp).toBeDefined();
      expect(postOp.operationId).toBeDefined();
      expect(postOp.summary).toBeDefined();
      expect(postOp.responses).toBeDefined();
    });

    it('POST /memories/bulk-supersede has complete spec', () => {
      const paths = getPaths();
      const bulkPath = paths['/memories/bulk-supersede'] as Record<string, unknown>;
      expect(bulkPath).toBeDefined();

      const postOp = bulkPath.post as Record<string, unknown>;
      expect(postOp).toBeDefined();
      expect(postOp.operationId).toBeDefined();
      expect(postOp.summary).toBeDefined();
      expect(postOp.responses).toBeDefined();
    });

    it('PUT /memories/upsert-by-tag has complete spec', () => {
      const paths = getPaths();
      const upsertPath = paths['/memories/upsert-by-tag'] as Record<string, unknown>;
      expect(upsertPath).toBeDefined();

      const putOp = upsertPath.put as Record<string, unknown>;
      expect(putOp).toBeDefined();
      expect(putOp.operationId).toBeDefined();
      expect(putOp.summary).toBeDefined();
      expect(putOp.responses).toBeDefined();
    });
  });

  describe('403 and 429 error responses documented', () => {
    const memoryEndpoints = [
      { path: '/memories/search', method: 'get' },
      { path: '/memories/unified', method: 'post' },
      { path: '/memories/unified', method: 'get' },
      { path: '/memories/{id}', method: 'patch' },
      { path: '/memories/{id}', method: 'delete' },
      { path: '/memories/digest', method: 'post' },
      { path: '/memories/reap', method: 'post' },
      { path: '/memories/bulk-supersede', method: 'post' },
      { path: '/memories/upsert-by-tag', method: 'put' },
    ];

    for (const ep of memoryEndpoints) {
      it(`${ep.method.toUpperCase()} ${ep.path} documents 403 response`, () => {
        const paths = getPaths();
        const pathObj = paths[ep.path] as Record<string, unknown>;
        expect(pathObj).toBeDefined();

        const operation = pathObj[ep.method] as Record<string, unknown>;
        expect(operation).toBeDefined();

        const responses = operation.responses as Record<string, unknown>;
        expect(responses['403']).toBeDefined();
      });

      it(`${ep.method.toUpperCase()} ${ep.path} documents 429 response`, () => {
        const paths = getPaths();
        const pathObj = paths[ep.path] as Record<string, unknown>;
        expect(pathObj).toBeDefined();

        const operation = pathObj[ep.method] as Record<string, unknown>;
        expect(operation).toBeDefined();

        const responses = operation.responses as Record<string, unknown>;
        expect(responses['429']).toBeDefined();
      });
    }
  });

  describe('Legacy endpoints marked as deprecated', () => {
    it('GET /memory is marked deprecated', () => {
      const paths = getPaths();
      const memoryPath = paths['/memory'] as Record<string, unknown>;
      const getOp = memoryPath.get as Record<string, unknown>;
      expect(getOp.deprecated).toBe(true);
    });

    it('POST /memory is marked deprecated', () => {
      const paths = getPaths();
      const memoryPath = paths['/memory'] as Record<string, unknown>;
      const postOp = memoryPath.post as Record<string, unknown>;
      expect(postOp.deprecated).toBe(true);
    });

    it('PUT /memory/{id} is marked deprecated', () => {
      const paths = getPaths();
      const memoryIdPath = paths['/memory/{id}'] as Record<string, unknown>;
      const putOp = memoryIdPath.put as Record<string, unknown>;
      expect(putOp.deprecated).toBe(true);
    });

    it('DELETE /memory/{id} is marked deprecated', () => {
      const paths = getPaths();
      const memoryIdPath = paths['/memory/{id}'] as Record<string, unknown>;
      const deleteOp = memoryIdPath.delete as Record<string, unknown>;
      expect(deleteOp.deprecated).toBe(true);
    });
  });
});
