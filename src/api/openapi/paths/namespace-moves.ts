/**
 * OpenAPI path definitions for namespace move endpoints.
 *
 * All entity types that support multi-tenant namespacing expose a
 * PATCH /:id/namespace endpoint to move an entity between namespaces.
 * These are dynamically registered from NAMESPACE_MOVE_ENTITIES in server.ts.
 */
import type { OpenApiDomainModule } from '../types.ts';
import { uuidParam, errorResponses, jsonBody, jsonResponse, namespaceParam } from '../helpers.ts';

const NAMESPACE_MOVE_ENTITIES: Array<[string, string, string]> = [
  ['WorkItem', 'Work Items', 'work-items'],
  ['Contact', 'Contacts', 'contacts'],
  ['Memory', 'Memories', 'memories'],
  ['Note', 'Notes', 'notes'],
  ['Notebook', 'Notebooks', 'notebooks'],
  ['List', 'Lists', 'lists'],
  ['Thread', 'Threads', 'threads'],
  ['Recipe', 'Recipes', 'recipes'],
  ['MealLog', 'MealLog', 'meal-log'],
  ['Pantry', 'Pantry', 'pantry'],
  ['EntityLink', 'EntityLinks', 'entity-links'],
  ['SkillStoreItem', 'Skill Store Items', 'skill-store/items'],
];

export function namespaceMovesPaths(): OpenApiDomainModule {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const [entityName, tag, basePath] of NAMESPACE_MOVE_ENTITIES) {
    paths[`/api/${basePath}/{id}/namespace`] = {
      parameters: [uuidParam('id', `${entityName} UUID`)],
      patch: {
        operationId: `move${entityName.replace(/\s+/g, '')}Namespace`,
        summary: `Move a ${entityName.toLowerCase()} to a different namespace`,
        tags: [tag],
        parameters: [namespaceParam()],
        requestBody: jsonBody({
          type: 'object',
          required: ['target_namespace'],
          properties: {
            target_namespace: {
              type: 'string',
              description: 'Target namespace to move the entity to',
              example: 'work-projects',
            },
          },
        }),
        responses: {
          '200': jsonResponse(`${entityName} moved`, {
            type: 'object',
            required: ['id', 'namespace'],
            properties: {
              id: { type: 'string', format: 'uuid', description: `UUID of the moved ${entityName.toLowerCase()}` },
              namespace: { type: 'string', description: 'New namespace the entity was moved to', example: 'work-projects' },
              previous_namespace: { type: 'string', description: 'Previous namespace', example: 'default' },
            },
          }),
          ...errorResponses(400, 401, 403, 404, 500),
        },
      },
    };
  }

  return { tags: [], schemas: {}, paths };
}
