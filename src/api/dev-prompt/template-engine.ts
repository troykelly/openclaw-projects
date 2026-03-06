/**
 * Handlebars template engine for dev prompts (Epic #2011, Issue #2013).
 *
 * Renders dev prompt bodies using Handlebars with a registry of built-in
 * variables (dates, namespace, repo info, etc.) that can be supplemented
 * or overridden by user-supplied variables.
 *
 * Extended for Symphony orchestration (Epic #2186, Issue #2194) with
 * issue context, run state, and workspace variables.
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
  // Symphony orchestration variables (Issue #2194)
  issueTitle?: string;
  issueBody?: string;
  issueLabels?: string;
  issueAcceptanceCriteria?: string;
  runAttempt?: string;
  previousError?: string;
  continuationCount?: string;
  branchName?: string;
  prUrl?: string;
  workspacePath?: string;
  projectName?: string;
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
    // Symphony orchestration variables (Issue #2194)
    issue_title: ctx.issueTitle ?? '',
    issue_body: ctx.issueBody ?? '',
    issue_labels: ctx.issueLabels ?? '',
    issue_acceptance_criteria: ctx.issueAcceptanceCriteria ?? '',
    run_attempt: ctx.runAttempt ?? '',
    previous_error: ctx.previousError ?? '',
    continuation_count: ctx.continuationCount ?? '',
    branch_name: ctx.branchName ?? '',
    pr_url: ctx.prUrl ?? '',
    workspace_path: ctx.workspacePath ?? '',
    project_name: ctx.projectName ?? '',
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

/**
 * Render a dev prompt body in strict mode.
 *
 * Like {@link renderDevPrompt}, but throws if the template references any
 * variable that is not a known built-in or user-supplied variable.
 * Used by Symphony orchestration to catch template errors early.
 *
 * @param body - The Handlebars template string
 * @param context - Context for resolving built-in variables
 * @param userVariables - Optional user-supplied variables (override built-ins)
 * @returns The rendered output and list of variables used
 * @throws Error if the template references an unknown variable
 * @throws Error if the Handlebars template has syntax errors
 */
export function renderDevPromptStrict(
  body: string,
  context: RenderContext,
  userVariables?: Record<string, string>,
): RenderResult {
  // First, extract variable references from the template AST
  const ast = Handlebars.parse(body);
  const referencedVars = new Set<string>();
  extractVariableReferences(ast, referencedVars);

  // Build the known variable set
  const builtIn = getBuiltInVariables(context);
  const merged = { ...builtIn, ...(userVariables ?? {}) };
  const knownVars = new Set(Object.keys(merged));

  // Check for unknown variable references
  const unknownVars = [...referencedVars].filter((v) => !knownVars.has(v));
  if (unknownVars.length > 0) {
    throw new Error(
      `Unknown variable(s) referenced in template: ${unknownVars.join(', ')}`,
    );
  }

  // Delegate to normal rendering
  return renderDevPrompt(body, context, userVariables);
}

/**
 * Extract variable name references from a Handlebars AST.
 * Walks MustacheStatement and BlockStatement nodes to find PathExpression
 * references at depth 0 (top-level context variables).
 */
function extractVariableReferences(
  node: hbs.AST.Program,
  refs: Set<string>,
): void {
  for (const statement of node.body) {
    if (
      statement.type === 'MustacheStatement' ||
      statement.type === 'BlockStatement'
    ) {
      const st = statement as hbs.AST.MustacheStatement | hbs.AST.BlockStatement;
      if (
        st.path.type === 'PathExpression' &&
        (st.path as hbs.AST.PathExpression).depth === 0 &&
        (st.path as hbs.AST.PathExpression).parts.length === 1
      ) {
        const name = (st.path as hbs.AST.PathExpression).parts[0];
        // Skip Handlebars built-in helpers (if, each, unless, with, etc.)
        if (!HANDLEBARS_BUILTINS.has(name)) {
          refs.add(name);
        }
      }
      // Walk into block body (e.g., inside #if blocks)
      if ('program' in st && st.program) {
        extractVariableReferences(st.program, refs);
      }
      if ('inverse' in st && st.inverse) {
        extractVariableReferences(st.inverse, refs);
      }
    }
  }
}

/** Handlebars built-in helper names (not user variables). */
const HANDLEBARS_BUILTINS = new Set([
  'if', 'unless', 'each', 'with', 'lookup', 'log',
]);

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
  // Symphony orchestration variables (Issue #2194)
  { name: 'issue_title', description: 'GitHub issue title for the current Symphony run', example: 'Fix login bug' },
  { name: 'issue_body', description: 'GitHub issue body/description', example: 'The login form crashes on submit' },
  { name: 'issue_labels', description: 'Comma-separated GitHub issue labels', example: 'bug,critical' },
  { name: 'issue_acceptance_criteria', description: 'Extracted acceptance criteria from the issue', example: '- [ ] Login form submits without crash' },
  { name: 'run_attempt', description: 'Current Symphony run attempt number (1-based)', example: '1' },
  { name: 'previous_error', description: 'Error message from the previous failed run attempt', example: 'TypeError: cannot read property of undefined' },
  { name: 'continuation_count', description: 'Number of continuations in the current run', example: '0' },
  { name: 'branch_name', description: 'Git branch name for the current run', example: 'issue/123-fix-login' },
  { name: 'pr_url', description: 'Pull request URL if one exists for the branch', example: 'https://github.com/org/repo/pull/42' },
  { name: 'workspace_path', description: 'Filesystem path to the worktree/workspace', example: '/tmp/worktree-issue-123-fix-login' },
  { name: 'project_name', description: 'Project name from the work item', example: 'openclaw-projects' },
] as const;
