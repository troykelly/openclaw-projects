/**
 * Unit tests for Symphony template engine extensions (Epic #2186, Issue #2194).
 * Tests Symphony-specific RenderContext variables and strict rendering mode.
 * Pure tests — no DB required.
 */
import { describe, expect, it } from 'vitest';
import {
  renderDevPrompt,
  renderDevPromptStrict,
  getBuiltInVariables,
  BUILT_IN_VARIABLE_DEFINITIONS,
  type RenderContext,
} from '../../../src/api/dev-prompt/template-engine.ts';

describe('Symphony Template Engine Extensions (#2194)', () => {
  const baseSymphonyContext: RenderContext = {
    namespace: 'troy',
    userEmail: 'troy@example.com',
    promptKey: 'symphony_work_on_issue',
    promptTitle: 'Work on Issue',
    repoOrg: 'troykelly',
    repoName: 'openclaw-projects',
    // Symphony-specific fields
    issueTitle: 'Fix login bug',
    issueBody: 'The login form crashes on submit',
    issueLabels: 'bug,critical',
    issueAcceptanceCriteria: '- [ ] Login form submits without crash',
    runAttempt: '1',
    previousError: '',
    continuationCount: '0',
    branchName: 'issue/123-fix-login',
    prUrl: '',
    workspacePath: '/tmp/worktree-issue-123-fix-login',
    projectName: 'openclaw-projects',
  };

  describe('getBuiltInVariables with Symphony context', () => {
    it('includes all Symphony variables in output', () => {
      const vars = getBuiltInVariables(baseSymphonyContext);
      expect(vars.issue_title).toBe('Fix login bug');
      expect(vars.issue_body).toBe('The login form crashes on submit');
      expect(vars.issue_labels).toBe('bug,critical');
      expect(vars.issue_acceptance_criteria).toBe('- [ ] Login form submits without crash');
      expect(vars.run_attempt).toBe('1');
      expect(vars.previous_error).toBe('');
      expect(vars.continuation_count).toBe('0');
      expect(vars.branch_name).toBe('issue/123-fix-login');
      expect(vars.pr_url).toBe('');
      expect(vars.workspace_path).toBe('/tmp/worktree-issue-123-fix-login');
      expect(vars.project_name).toBe('openclaw-projects');
    });

    it('uses empty strings for Symphony vars when not provided', () => {
      const minimalContext: RenderContext = {
        namespace: 'test',
        promptKey: 'test',
        promptTitle: 'Test',
      };
      const vars = getBuiltInVariables(minimalContext);
      expect(vars.issue_title).toBe('');
      expect(vars.issue_body).toBe('');
      expect(vars.issue_labels).toBe('');
      expect(vars.issue_acceptance_criteria).toBe('');
      expect(vars.run_attempt).toBe('');
      expect(vars.previous_error).toBe('');
      expect(vars.continuation_count).toBe('');
      expect(vars.branch_name).toBe('');
      expect(vars.pr_url).toBe('');
      expect(vars.workspace_path).toBe('');
      expect(vars.project_name).toBe('');
    });
  });

  describe('renderDevPrompt with Symphony variables', () => {
    it('renders Symphony variables in template', () => {
      const body = '# {{ issue_title }}\n\n{{ issue_body }}\n\nBranch: {{ branch_name }}';
      const result = renderDevPrompt(body, baseSymphonyContext);
      expect(result.rendered).toBe(
        '# Fix login bug\n\nThe login form crashes on submit\n\nBranch: issue/123-fix-login',
      );
    });

    it('tracks Symphony variables in variables_used', () => {
      const body = 'Issue: {{ issue_title }} (attempt {{ run_attempt }})';
      const result = renderDevPrompt(body, baseSymphonyContext);
      expect(result.variables_used).toContain('issue_title');
      expect(result.variables_used).toContain('run_attempt');
    });

    it('renders mixed built-in and Symphony variables', () => {
      const body = 'Repo: {{ repo_full }}\nIssue: {{ issue_title }}\nDate: {{ date }}';
      const result = renderDevPrompt(body, baseSymphonyContext);
      expect(result.rendered).toContain('Repo: troykelly/openclaw-projects');
      expect(result.rendered).toContain('Issue: Fix login bug');
      expect(result.rendered).toMatch(/Date: \d{4}-\d{2}-\d{2}/);
    });

    it('allows user variables to override Symphony variables', () => {
      const body = 'Issue: {{ issue_title }}';
      const result = renderDevPrompt(body, baseSymphonyContext, {
        issue_title: 'Overridden title',
      });
      expect(result.rendered).toBe('Issue: Overridden title');
    });

    it('renders a realistic Symphony work-on-issue template', () => {
      const body = [
        '# Work on Issue: {{ issue_title }}',
        '',
        'Repository: {{ repo_full }}',
        'Branch: {{ branch_name }}',
        'Workspace: {{ workspace_path }}',
        '',
        '## Issue Description',
        '{{ issue_body }}',
        '',
        '## Acceptance Criteria',
        '{{ issue_acceptance_criteria }}',
        '',
        '## Attempt',
        'Run attempt: {{ run_attempt }}',
        '{{#if previous_error}}',
        '## Previous Error',
        '{{ previous_error }}',
        '{{/if}}',
      ].join('\n');

      const result = renderDevPrompt(body, baseSymphonyContext);
      expect(result.rendered).toContain('# Work on Issue: Fix login bug');
      expect(result.rendered).toContain('Repository: troykelly/openclaw-projects');
      expect(result.rendered).toContain('Branch: issue/123-fix-login');
      expect(result.rendered).toContain('Run attempt: 1');
      // previous_error is empty, so the #if block should not render
      expect(result.rendered).not.toContain('## Previous Error');
    });

    it('renders previous_error block when error is present', () => {
      const ctx: RenderContext = {
        ...baseSymphonyContext,
        runAttempt: '2',
        previousError: 'TypeError: cannot read property of undefined',
      };
      const body = [
        'Attempt: {{ run_attempt }}',
        '{{#if previous_error}}',
        'Previous error: {{ previous_error }}',
        '{{/if}}',
      ].join('\n');

      const result = renderDevPrompt(body, ctx);
      expect(result.rendered).toContain('Attempt: 2');
      expect(result.rendered).toContain(
        'Previous error: TypeError: cannot read property of undefined',
      );
    });
  });

  describe('renderDevPromptStrict', () => {
    it('renders successfully when all variables are known', () => {
      const body = 'Hello {{ namespace }}, issue: {{ issue_title }}';
      const result = renderDevPromptStrict(body, baseSymphonyContext);
      expect(result.rendered).toContain('Hello troy, issue: Fix login bug');
    });

    it('throws on unknown variable references', () => {
      const body = 'Hello {{ namespace }}, unknown: {{ totally_unknown_var }}';
      expect(() => renderDevPromptStrict(body, baseSymphonyContext)).toThrow(
        /unknown.*variable/i,
      );
    });

    it('throws with the name of the unknown variable in the error', () => {
      const body = 'Bad: {{ nonexistent_var }}';
      expect(() => renderDevPromptStrict(body, baseSymphonyContext)).toThrow(
        'nonexistent_var',
      );
    });

    it('allows user-supplied variables in strict mode', () => {
      const body = 'Custom: {{ my_custom_var }}';
      const result = renderDevPromptStrict(body, baseSymphonyContext, {
        my_custom_var: 'hello',
      });
      expect(result.rendered).toBe('Custom: hello');
    });

    it('throws on unknown variables used as block helper params', () => {
      const body = '{{#if totally_unknown_var}}content{{/if}}';
      expect(() => renderDevPromptStrict(body, baseSymphonyContext)).toThrow(
        'totally_unknown_var',
      );
    });

    it('does not throw for known variables used as block helper params', () => {
      const body = '{{#if previous_error}}Has error{{/if}}';
      const result = renderDevPromptStrict(body, baseSymphonyContext);
      // previous_error is empty string, so #if block should not render
      expect(result.rendered).not.toContain('Has error');
    });

    it('does not throw for empty body', () => {
      const result = renderDevPromptStrict('', baseSymphonyContext);
      expect(result.rendered).toBe('');
    });

    it('does not throw for body with no variables', () => {
      const result = renderDevPromptStrict('Plain text', baseSymphonyContext);
      expect(result.rendered).toBe('Plain text');
    });
  });

  describe('BUILT_IN_VARIABLE_DEFINITIONS includes Symphony variables', () => {
    it('includes all Symphony variable definitions', () => {
      const names = BUILT_IN_VARIABLE_DEFINITIONS.map((d) => d.name);
      expect(names).toContain('issue_title');
      expect(names).toContain('issue_body');
      expect(names).toContain('issue_labels');
      expect(names).toContain('issue_acceptance_criteria');
      expect(names).toContain('run_attempt');
      expect(names).toContain('previous_error');
      expect(names).toContain('continuation_count');
      expect(names).toContain('branch_name');
      expect(names).toContain('pr_url');
      expect(names).toContain('workspace_path');
      expect(names).toContain('project_name');
    });
  });
});
