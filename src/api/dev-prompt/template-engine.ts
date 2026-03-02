/**
 * Handlebars template engine for dev prompts (Epic #2011, Issue #2013).
 *
 * Renders dev prompt bodies using Handlebars with a registry of built-in
 * variables (dates, namespace, repo info, etc.) that can be supplemented
 * or overridden by user-supplied variables.
 */
import Handlebars from 'handlebars';

/** Context required to resolve built-in template variables. */
export interface RenderContext {
  namespace: string;
  userEmail?: string;
  promptKey: string;
  promptTitle: string;
  repoOrg?: string;
  repoName?: string;
}

/** Result of rendering a dev prompt template. */
export interface RenderResult {
  /** The fully rendered template output. */
  rendered: string;
  /** Names of variables that were referenced in the template. */
  variables_used: string[];
}

/** Documentation for a single built-in variable. */
export interface VariableDefinition {
  name: string;
  description: string;
  example: string;
}

/**
 * Build the set of built-in variables from the current context.
 * These are available to every template render automatically.
 */
export function getBuiltInVariables(
  ctx: RenderContext,
): Record<string, string> {
  const now = new Date();

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  const repoOrg = ctx.repoOrg ?? '';
  const repoName = ctx.repoName ?? '';
  const repoFull = repoOrg && repoName ? `${repoOrg}/${repoName}` : '';

  return {
    month_year: `${monthNames[now.getMonth()]} ${year}`,
    date: `${year}-${month}-${day}`,
    date_long: `${monthNames[now.getMonth()]} ${now.getDate()}, ${year}`,
    year,
    repo_org: repoOrg,
    repo_name: repoName,
    repo_full: repoFull,
    namespace: ctx.namespace,
    user_email: ctx.userEmail ?? '',
    prompt_key: ctx.promptKey,
    prompt_title: ctx.promptTitle,
  };
}

/**
 * Render a dev prompt body with Handlebars.
 *
 * @param body - The Handlebars template string
 * @param context - Context for resolving built-in variables
 * @param userVariables - Optional user-supplied variables (override built-ins)
 * @returns The rendered output and list of variables used
 * @throws Error if the Handlebars template has syntax errors
 */
export function renderDevPrompt(
  body: string,
  context: RenderContext,
  userVariables?: Record<string, string>,
): RenderResult {
  const builtIn = getBuiltInVariables(context);
  const merged = { ...builtIn, ...(userVariables ?? {}) };

  // Track which variables are used via a Proxy
  const used = new Set<string>();
  const tracked = new Proxy(merged, {
    get(target, prop) {
      if (typeof prop === 'string') {
        used.add(prop);
      }
      return Reflect.get(target, prop);
    },
    has(target, prop) {
      return Reflect.has(target, prop);
    },
  });

  // Compile with noEscape: templates contain markdown/code, not user-facing HTML
  const template = Handlebars.compile(body, { noEscape: true });
  const rendered = template(tracked);

  // Filter tracked usage to only actual template variables (exclude internal Handlebars props)
  const allVarNames = new Set(Object.keys(merged));
  const variables_used = [...used].filter((v) => allVarNames.has(v));

  return { rendered, variables_used };
}

/** Documentation definitions for all built-in variables. */
export const BUILT_IN_VARIABLE_DEFINITIONS: readonly VariableDefinition[] = [
  { name: 'month_year', description: 'Current month and year', example: 'March 2026' },
  { name: 'date', description: 'Current ISO date', example: '2026-03-02' },
  { name: 'date_long', description: 'Current date in long format', example: 'March 2, 2026' },
  { name: 'year', description: 'Current year', example: '2026' },
  { name: 'repo_org', description: 'Repository organization (from context or variable override)', example: 'troykelly' },
  { name: 'repo_name', description: 'Repository name', example: 'openclaw-projects' },
  { name: 'repo_full', description: 'Full repository path (org/name)', example: 'troykelly/openclaw-projects' },
  { name: 'namespace', description: 'Current namespace', example: 'troy' },
  { name: 'user_email', description: "Authenticated user's email", example: 'troy@example.com' },
  { name: 'prompt_key', description: "The prompt's own key", example: 'new_feature_request' },
  { name: 'prompt_title', description: "The prompt's own title", example: 'New Feature Request' },
] as const;
