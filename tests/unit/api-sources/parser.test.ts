/**
 * Unit tests for OpenAPI parser and decomposer.
 * Part of API Onboarding feature (#1780).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseOpenApiSpec } from '../../../src/api/api-sources/parser.ts';
import minimalSpec from '../../fixtures/openapi/minimal.json';
import richSpec from '../../fixtures/openapi/rich.json';
import noTagsSpec from '../../fixtures/openapi/no-tags.json';
import adversarialSpec from '../../fixtures/openapi/adversarial.json';
import swagger2Spec from '../../fixtures/openapi/swagger2.json';
import openapi31Spec from '../../fixtures/openapi/openapi31.json';
import refsInlineSpec from '../../fixtures/openapi/refs-inline.json';

const fixturesDir = resolve(import.meta.dirname, '../../fixtures/openapi');

describe('parseOpenApiSpec', () => {
  describe('minimal spec', () => {
    it('parses a minimal spec with one operation', async () => {
      const result = await parseOpenApiSpec(JSON.stringify(minimalSpec));

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].operationKey).toBe('healthCheck');
      expect(result.operations[0].method).toBe('GET');
      expect(result.operations[0].path).toBe('/health');
    });

    it('generates an overview', async () => {
      const result = await parseOpenApiSpec(JSON.stringify(minimalSpec));

      expect(result.overview.name).toBe('Minimal API');
      expect(result.overview.version).toBe('1.0.0');
      expect(result.overview.totalOperations).toBe(1);
    });

    it('puts untagged operations in _untagged group', async () => {
      const result = await parseOpenApiSpec(JSON.stringify(minimalSpec));

      // Single operation with no tag should go in _untagged
      const untagged = result.tagGroups.find((tg) => tg.tag === '_untagged');
      expect(untagged).toBeDefined();
      expect(untagged!.operations).toHaveLength(1);
    });
  });

  describe('rich spec', () => {
    it('extracts correct operation count', async () => {
      const result = await parseOpenApiSpec(JSON.stringify(richSpec));
      expect(result.operations).toHaveLength(3);
    });

    it('extracts correct tag groups', async () => {
      const result = await parseOpenApiSpec(JSON.stringify(richSpec));

      const tagNames = result.tagGroups.map((tg) => tg.tag).sort();
      expect(tagNames).toEqual(['pets', 'store']);
    });

    it('assigns operations to correct tag groups', async () => {
      const result = await parseOpenApiSpec(JSON.stringify(richSpec));

      const petsGroup = result.tagGroups.find((tg) => tg.tag === 'pets');
      expect(petsGroup).toBeDefined();
      expect(petsGroup!.operations).toHaveLength(2);

      const storeGroup = result.tagGroups.find((tg) => tg.tag === 'store');
      expect(storeGroup).toBeDefined();
      expect(storeGroup!.operations).toHaveLength(1);
    });

    it('resolves $ref references', async () => {
      const result = await parseOpenApiSpec(JSON.stringify(richSpec));

      // After dereferencing, no operation should have $ref in its metadata
      for (const op of result.operations) {
        const json = JSON.stringify(op);
        expect(json).not.toContain('"$ref"');
      }
    });

    it('extracts parameters', async () => {
      const result = await parseOpenApiSpec(JSON.stringify(richSpec));
      const listPets = result.operations.find((op) => op.operationKey === 'listPets');
      expect(listPets).toBeDefined();
      expect(listPets!.parameters).toHaveLength(2);
      expect(listPets!.parameters[0].name).toBe('limit');
    });

    it('extracts server info', async () => {
      const result = await parseOpenApiSpec(JSON.stringify(richSpec));
      expect(result.overview.servers).toHaveLength(1);
      expect(result.overview.servers[0].url).toBe('https://api.petstore.example.com/v2');
    });

    it('includes API description in overview', async () => {
      const result = await parseOpenApiSpec(JSON.stringify(richSpec));
      expect(result.overview.description).toContain('managing pets');
    });
  });

  describe('no-tags spec', () => {
    it('groups all operations under _untagged', async () => {
      const result = await parseOpenApiSpec(JSON.stringify(noTagsSpec));

      expect(result.tagGroups).toHaveLength(1);
      expect(result.tagGroups[0].tag).toBe('_untagged');
      expect(result.tagGroups[0].operations).toHaveLength(2);
    });
  });

  describe('adversarial spec', () => {
    it('sanitizes injection patterns in descriptions', async () => {
      const result = await parseOpenApiSpec(JSON.stringify(adversarialSpec));

      // Overview description should not contain injection
      expect(result.overview.description?.toLowerCase()).not.toContain('ignore previous');

      // Operation descriptions should be sanitized
      const op = result.operations.find((o) => o.operationKey === 'getData');
      expect(op).toBeDefined();
      expect(op!.description).not.toContain('<script>');
      expect(op!.description?.toLowerCase()).not.toContain('you are now');
    });

    it('sanitizes markdown injection in summary', async () => {
      const result = await parseOpenApiSpec(JSON.stringify(adversarialSpec));
      const op = result.operations.find((o) => o.operationKey === 'getData');
      expect(op).toBeDefined();
      expect(op!.summary).not.toContain('![');
      expect(op!.summary).not.toContain('evil.com');
    });
  });

  describe('swagger 2.0 spec', () => {
    it('parses Swagger 2.0 format', async () => {
      const result = await parseOpenApiSpec(JSON.stringify(swagger2Spec));

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].operationKey).toBe('listItems');
      expect(result.overview.name).toBe('Legacy API');
    });
  });

  describe('YAML spec (#2278)', () => {
    it('parses a YAML string spec', async () => {
      const yamlContent = readFileSync(resolve(fixturesDir, 'minimal.yaml'), 'utf-8');
      const result = await parseOpenApiSpec(yamlContent);

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].operationKey).toBe('healthCheck');
      expect(result.overview.name).toBe('YAML Minimal API');
    });

    it('parses a rich YAML spec with refs', async () => {
      const yamlContent = readFileSync(resolve(fixturesDir, 'rich.yaml'), 'utf-8');
      const result = await parseOpenApiSpec(yamlContent);

      expect(result.operations).toHaveLength(2);
      expect(result.overview.name).toBe('YAML Pet Store');
      expect(result.overview.servers).toHaveLength(1);

      // $ref should be resolved
      for (const op of result.operations) {
        const json = JSON.stringify(op);
        expect(json).not.toContain('"$ref"');
      }
    });

    it('handles YAML that is also valid JSON gracefully', async () => {
      // JSON is a subset of YAML; passing JSON string should still work
      const result = await parseOpenApiSpec(JSON.stringify(minimalSpec));
      expect(result.operations).toHaveLength(1);
    });
  });

  describe('OpenAPI 3.1 spec (#2278)', () => {
    it('parses an OpenAPI 3.1 spec', async () => {
      const result = await parseOpenApiSpec(JSON.stringify(openapi31Spec));

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0].operationKey).toBe('listItems');
      expect(result.overview.name).toBe('OpenAPI 3.1 API');
    });
  });

  describe('$ref resolution for inline specs (#2278)', () => {
    it('resolves nested $ref references in inline spec objects', async () => {
      const result = await parseOpenApiSpec(refsInlineSpec);

      expect(result.operations).toHaveLength(2);

      // All refs should be dereferenced
      for (const op of result.operations) {
        const json = JSON.stringify(op);
        expect(json).not.toContain('"$ref"');
      }
    });

    it('resolves $ref when passed as a YAML string', async () => {
      const yamlContent = readFileSync(resolve(fixturesDir, 'rich.yaml'), 'utf-8');
      const result = await parseOpenApiSpec(yamlContent);

      // After parsing YAML + dereferencing, no $ref should remain
      for (const op of result.operations) {
        const json = JSON.stringify(op);
        expect(json).not.toContain('"$ref"');
      }
    });
  });

  describe('error handling', () => {
    it('rejects invalid content (not JSON or YAML)', async () => {
      await expect(parseOpenApiSpec('{{{')).rejects.toThrow();
    });

    it('rejects non-OpenAPI document', async () => {
      await expect(parseOpenApiSpec('{"foo": "bar"}')).rejects.toThrow();
    });

    it('rejects spec exceeding max operations', async () => {
      // Generate a spec with 201 operations
      const paths: Record<string, unknown> = {};
      for (let i = 0; i < 201; i++) {
        paths[`/op${i}`] = {
          get: {
            operationId: `op${i}`,
            responses: { '200': { description: 'OK' } },
          },
        };
      }
      const bigSpec = {
        openapi: '3.0.3',
        info: { title: 'Big API', version: '1.0.0' },
        paths,
      };

      await expect(parseOpenApiSpec(JSON.stringify(bigSpec))).rejects.toThrow(/200/);
    });
  });

  describe('operation keys', () => {
    it('uses operationId when present', async () => {
      const result = await parseOpenApiSpec(JSON.stringify(richSpec));
      const keys = result.operations.map((op) => op.operationKey);
      expect(keys).toContain('listPets');
      expect(keys).toContain('createPet');
      expect(keys).toContain('listOrders');
    });

    it('deduplicates colliding keys', async () => {
      // Create a spec with two operations that would have the same fallback key
      const spec = {
        openapi: '3.0.3',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/a': {
            get: {
              operationId: 'doThing',
              responses: { '200': { description: 'OK' } },
            },
            post: {
              operationId: 'doThing',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };
      const result = await parseOpenApiSpec(JSON.stringify(spec));
      const keys = result.operations.map((op) => op.operationKey);
      expect(new Set(keys).size).toBe(keys.length); // All unique
    });
  });
});
