/**
 * Embedding text generator templates for OpenAPI operations.
 * Produces natural-language summaries optimized for semantic search.
 * Pure functions — no side effects, no DB, no embedding calls.
 * Part of API Onboarding feature (#1779).
 */

import type {
  ParsedOperation,
  ParsedTagGroup,
  ParsedApiOverview,
} from './types.ts';

export interface OperationTextResult {
  title: string;
  content: string;
  descriptionQuality: 'original' | 'synthesized';
}

export interface TextResult {
  title: string;
  content: string;
}

/** Method verb synonyms for enriching embedding text with natural-language alternatives. */
const METHOD_SYNONYMS: Record<string, string[]> = {
  GET: ['fetch', 'retrieve', 'look up', 'query', 'read', 'get'],
  POST: ['create', 'add', 'submit', 'send', 'insert', 'register'],
  PUT: ['replace', 'overwrite', 'set', 'update'],
  PATCH: ['update', 'modify', 'change', 'edit'],
  DELETE: ['delete', 'remove', 'destroy', 'cancel'],
  HEAD: ['check', 'verify', 'test'],
  OPTIONS: ['discover', 'inspect'],
};

/**
 * Generate a natural-language use-case line for an operation.
 * Helps semantic search match natural queries like "how do I create a user?"
 * to operations like POST /users.
 */
function generateUseCaseLine(method: string, path: string, summary: string | null): string {
  const verb = method.toUpperCase();
  const synonyms = METHOD_SYNONYMS[verb] ?? [verb.toLowerCase()];

  // Extract meaningful resource name from path
  const segments = path
    .split('/')
    .filter((s) => s && !s.startsWith('{') && !s.match(/^v\d+$/));
  const resource = segments.length > 0 ? segments[segments.length - 1] : 'this resource';

  // Build the use-case line with synonym alternatives
  const synonymList = synonyms.slice(0, 3).join(', ');
  const base = summary ?? `${synonyms[0]} ${resource}`;
  return `Use this to ${base.toLowerCase().replace(/\.$/, '')}. Also: ${synonymList} ${resource}.`;
}

/**
 * Synthesize a description from an operation's method and path
 * when no summary or description is provided.
 */
function synthesizeDescription(method: string, path: string): string {
  // Extract meaningful path segments (strip parameters and version prefixes)
  const segments = path
    .split('/')
    .filter((s) => s && !s.startsWith('{') && !s.match(/^v\d+$/));

  const resource = segments.length > 0 ? segments.join(' ') : 'resource';
  const verb = method.toUpperCase();

  const actionMap: Record<string, string> = {
    GET: 'Retrieve',
    POST: 'Create',
    PUT: 'Replace',
    PATCH: 'Update',
    DELETE: 'Delete',
    HEAD: 'Check',
    OPTIONS: 'Get options for',
  };

  const action = actionMap[verb] ?? verb;
  return `${action} ${resource}`;
}

/**
 * Generate embedding text for a single API operation.
 */
export function generateOperationText(
  op: ParsedOperation,
  apiName: string,
  authSummary: string,
): OperationTextResult {
  const hasOriginalDesc = Boolean(op.summary || op.description);
  const descriptionQuality = hasOriginalDesc ? 'original' : 'synthesized';

  const intentLine = hasOriginalDesc
    ? (op.summary ?? op.description ?? '')
    : synthesizeDescription(op.method, op.path);

  const lines: string[] = [];

  // Title / intent line
  lines.push(`${op.operationKey}: ${intentLine}`);
  lines.push('');

  // Endpoint
  lines.push(`Endpoint: ${op.method.toUpperCase()} ${op.path}`);
  lines.push(`API: ${apiName}`);

  // Auth
  if (authSummary && authSummary !== 'none') {
    lines.push(`Auth: ${authSummary}`);
  }

  // Tags
  if (op.tags.length > 0) {
    lines.push(`Tags: ${op.tags.join(', ')}`);
  }

  // Description (full, if different from summary)
  if (op.description && op.description !== op.summary) {
    lines.push('');
    lines.push(op.description);
  }

  // Parameters
  if (op.parameters.length > 0) {
    lines.push('');
    lines.push('Inputs:');
    for (const param of op.parameters) {
      const requiredTag = param.required ? ' (required)' : '';
      const typeTag = param.schema?.type ? ` [${param.schema.type}]` : '';
      const desc = param.description ? ` - ${param.description}` : '';
      lines.push(`  ${param.name}${typeTag}${requiredTag}${desc} (in ${param.in})`);
    }
  }

  // Request body
  if (op.requestBody) {
    lines.push('');
    lines.push('Request body: JSON');
  }

  // Responses
  const responseCodes = Object.keys(op.responses);
  if (responseCodes.length > 0) {
    lines.push('');
    lines.push('Responses:');
    for (const code of responseCodes) {
      const resp = op.responses[code];
      const schemaNote = resp.schema ? ' (structured)' : '';
      lines.push(`  ${code}: ${resp.description}${schemaNote}`);
    }
  }

  // Natural-language use-case line for better semantic matching (#2276)
  lines.push('');
  lines.push(generateUseCaseLine(op.method, op.path, op.summary));

  return {
    title: `${op.operationKey}: ${intentLine}`,
    content: lines.join('\n'),
    descriptionQuality,
  };
}

/**
 * Generate embedding text for a tag group (collection of related operations).
 */
export function generateTagGroupText(
  tagGroup: ParsedTagGroup,
  apiName: string,
): TextResult {
  const lines: string[] = [];

  lines.push(`Tag group: ${tagGroup.tag} (${apiName})`);
  lines.push('');

  if (tagGroup.description) {
    lines.push(tagGroup.description);
    lines.push('');
  }

  if (tagGroup.operations.length > 0) {
    lines.push('Operations:');
    for (const op of tagGroup.operations) {
      const summaryPart = op.summary ? ` - ${op.summary}` : '';
      lines.push(`  ${op.method.toUpperCase()} ${op.path} [${op.operationKey}]${summaryPart}`);
    }
  }

  return {
    title: `Tag group: ${tagGroup.tag} (${apiName})`,
    content: lines.join('\n'),
  };
}

/**
 * Generate embedding text for an API overview.
 */
export function generateOverviewText(overview: ParsedApiOverview): TextResult {
  const lines: string[] = [];

  lines.push(`API: ${overview.name}`);
  lines.push('');

  if (overview.description) {
    lines.push(overview.description);
    lines.push('');
  }

  if (overview.version) {
    lines.push(`Version: ${overview.version}`);
  }

  if (overview.servers.length > 0) {
    const urls = overview.servers.map((s) => s.url).join(', ');
    lines.push(`Servers: ${urls}`);
  }

  if (overview.authSummary && overview.authSummary !== 'none') {
    lines.push(`Auth: ${overview.authSummary}`);
  }

  lines.push(`Total operations: ${overview.totalOperations}`);

  if (overview.tagGroups.length > 0) {
    lines.push('');
    lines.push('Tag groups:');
    for (const tg of overview.tagGroups) {
      lines.push(`  ${tg.tag} (${tg.operationCount} operations)`);
    }
  }

  return {
    title: `API: ${overview.name}`,
    content: lines.join('\n'),
  };
}
