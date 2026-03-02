/**
 * Unit tests for the Handlebars template engine (Epic #2011, Issue #2013).
 * Pure tests — no DB required.
 */
import { describe, expect, it } from 'vitest';
import {
  renderDevPrompt,
  getBuiltInVariables,
  BUILT_IN_VARIABLE_DEFINITIONS,
  type RenderContext,
} from '../../../src/api/dev-prompt/template-engine.ts';

describe('Dev Prompt Template Engine (#2013)', () => {
  const baseContext: RenderContext = {
    namespace: 'troy',
    userEmail: 'troy@example.com',
    promptKey: 'test_prompt',
    promptTitle: 'Test Prompt',
  };

  describe('getBuiltInVariables', () => {
    it('returns all expected built-in variable keys', () => {
      const vars = getBuiltInVariables(baseContext);
      expect(vars).toHaveProperty('month_year');
      expect(vars).toHaveProperty('date');
      expect(vars).toHaveProperty('date_long');
      expect(vars).toHaveProperty('year');
      expect(vars).toHaveProperty('namespace');
      expect(vars).toHaveProperty('user_email');
      expect(vars).toHaveProperty('prompt_key');
      expect(vars).toHaveProperty('prompt_title');
    });

    it('populates namespace from context', () => {
      const vars = getBuiltInVariables(baseContext);
      expect(vars.namespace).toBe('troy');
    });

    it('populates user_email from context', () => {
      const vars = getBuiltInVariables(baseContext);
      expect(vars.user_email).toBe('troy@example.com');
    });

    it('populates prompt_key and prompt_title from context', () => {
      const vars = getBuiltInVariables(baseContext);
      expect(vars.prompt_key).toBe('test_prompt');
      expect(vars.prompt_title).toBe('Test Prompt');
    });

    it('generates date in ISO format', () => {
      const vars = getBuiltInVariables(baseContext);
      expect(vars.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('generates year as 4-digit string', () => {
      const vars = getBuiltInVariables(baseContext);
      expect(vars.year).toMatch(/^\d{4}$/);
    });

    it('populates repo variables from context when provided', () => {
      const vars = getBuiltInVariables({
        ...baseContext,
        repoOrg: 'troykelly',
        repoName: 'openclaw-projects',
      });
      expect(vars.repo_org).toBe('troykelly');
      expect(vars.repo_name).toBe('openclaw-projects');
      expect(vars.repo_full).toBe('troykelly/openclaw-projects');
    });

    it('uses empty strings for repo vars when not provided', () => {
      const vars = getBuiltInVariables(baseContext);
      expect(vars.repo_org).toBe('');
      expect(vars.repo_name).toBe('');
      expect(vars.repo_full).toBe('');
    });
  });

  describe('renderDevPrompt', () => {
    it('renders simple Handlebars template', () => {
      const result = renderDevPrompt(
        'Hello {{ namespace }}, today is {{ date }}.',
        baseContext,
      );
      expect(result.rendered).toContain('Hello troy, today is ');
      expect(result.rendered).toMatch(/today is \d{4}-\d{2}-\d{2}/);
    });

    it('tracks variables_used', () => {
      const result = renderDevPrompt(
        'Hello {{ namespace }} from {{ user_email }}.',
        baseContext,
      );
      expect(result.variables_used).toContain('namespace');
      expect(result.variables_used).toContain('user_email');
    });

    it('user variables override built-in ones', () => {
      const result = renderDevPrompt(
        'Namespace: {{ namespace }}',
        baseContext,
        { namespace: 'overridden' },
      );
      expect(result.rendered).toBe('Namespace: overridden');
    });

    it('supports custom user variables not in built-ins', () => {
      const result = renderDevPrompt(
        'Custom: {{ my_var }}',
        baseContext,
        { my_var: 'custom_value' },
      );
      expect(result.rendered).toBe('Custom: custom_value');
      expect(result.variables_used).toContain('my_var');
    });

    it('renders empty string for unknown variables (no crash)', () => {
      const result = renderDevPrompt(
        'Missing: {{ unknown_var }}',
        baseContext,
      );
      expect(result.rendered).toBe('Missing: ');
    });

    it('does not escape HTML (noEscape mode)', () => {
      const result = renderDevPrompt(
        'HTML: {{ content }}',
        baseContext,
        { content: '<b>bold</b>' },
      );
      expect(result.rendered).toBe('HTML: <b>bold</b>');
    });

    it('handles empty body', () => {
      const result = renderDevPrompt('', baseContext);
      expect(result.rendered).toBe('');
      expect(result.variables_used).toHaveLength(0);
    });

    it('handles body with no variables', () => {
      const result = renderDevPrompt(
        'Just plain text with no variables.',
        baseContext,
      );
      expect(result.rendered).toBe('Just plain text with no variables.');
      expect(result.variables_used).toHaveLength(0);
    });

    it('handles Handlebars block helpers gracefully', () => {
      // We don't register custom block helpers, but Handlebars built-in
      // helpers like #if and #each should work.
      const result = renderDevPrompt(
        '{{#if namespace}}Has NS{{/if}}',
        baseContext,
      );
      expect(result.rendered).toBe('Has NS');
    });

    it('returns error info for invalid Handlebars syntax', () => {
      expect(() =>
        renderDevPrompt('{{ unclosed', baseContext),
      ).toThrow();
    });

    it('handles multiline templates', () => {
      const body = `# Title\n\nNamespace: {{ namespace }}\nDate: {{ date }}\n\nBody text.`;
      const result = renderDevPrompt(body, baseContext);
      expect(result.rendered).toContain('Namespace: troy');
      expect(result.rendered).toContain('Body text.');
    });
  });

  describe('BUILT_IN_VARIABLE_DEFINITIONS', () => {
    it('provides documentation for all built-in variables', () => {
      expect(BUILT_IN_VARIABLE_DEFINITIONS.length).toBeGreaterThanOrEqual(10);
      for (const def of BUILT_IN_VARIABLE_DEFINITIONS) {
        expect(def.name).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(def.example).toBeTruthy();
      }
    });

    it('includes all key variable names', () => {
      const names = BUILT_IN_VARIABLE_DEFINITIONS.map((d) => d.name);
      expect(names).toContain('namespace');
      expect(names).toContain('date');
      expect(names).toContain('user_email');
      expect(names).toContain('repo_full');
      expect(names).toContain('prompt_key');
    });
  });
});
