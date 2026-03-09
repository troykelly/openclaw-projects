import { describe, it, expect } from 'vitest';
import { validateHierarchy, isValidWorkItemKind } from '../src/api/hierarchy-validation.ts';
import type { WorkItemKind } from '../src/api/hierarchy-validation.ts';

/**
 * Issue #2293: Unit tests for centralized hierarchy validation.
 */
describe('hierarchy-validation', () => {
  describe('isValidWorkItemKind', () => {
    it.each(['project', 'initiative', 'epic', 'issue', 'task', 'list'])('accepts valid kind "%s"', (kind) => {
      expect(isValidWorkItemKind(kind)).toBe(true);
    });

    it.each(['foo', 'PROJECT', '', 'bug', 'story'])('rejects invalid kind "%s"', (kind) => {
      expect(isValidWorkItemKind(kind)).toBe(false);
    });
  });

  describe('validateHierarchy', () => {
    // project: no parent
    it('project with no parent is valid', () => {
      expect(validateHierarchy('project', null)).toEqual({ valid: true });
    });

    it('project with any parent is invalid', () => {
      const kinds: WorkItemKind[] = ['project', 'initiative', 'epic', 'issue', 'task'];
      for (const parentKind of kinds) {
        const result = validateHierarchy('project', parentKind);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('project cannot have parent');
      }
    });

    // list: no parent, no children
    it('list with no parent is valid', () => {
      expect(validateHierarchy('list', null)).toEqual({ valid: true });
    });

    it('list with any parent is invalid', () => {
      const kinds: WorkItemKind[] = ['project', 'initiative', 'epic', 'issue', 'task'];
      for (const parentKind of kinds) {
        const result = validateHierarchy('list', parentKind);
        expect(result.valid).toBe(false);
      }
    });

    it('no kind can have list as parent', () => {
      const kinds: WorkItemKind[] = ['project', 'initiative', 'epic', 'issue', 'task', 'list'];
      for (const childKind of kinds) {
        const result = validateHierarchy(childKind, 'list');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('cannot create child under a list');
      }
    });

    // initiative: parent must be project or null
    it('initiative with project parent is valid', () => {
      expect(validateHierarchy('initiative', 'project')).toEqual({ valid: true });
    });

    it('initiative with no parent is valid', () => {
      expect(validateHierarchy('initiative', null)).toEqual({ valid: true });
    });

    it('initiative with non-project parent is invalid', () => {
      const invalidParents: WorkItemKind[] = ['initiative', 'epic', 'issue', 'task'];
      for (const parent of invalidParents) {
        const result = validateHierarchy('initiative', parent);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('initiative parent must be project');
      }
    });

    // epic: parent must be initiative (required)
    it('epic with initiative parent is valid', () => {
      expect(validateHierarchy('epic', 'initiative')).toEqual({ valid: true });
    });

    it('epic with no parent is invalid', () => {
      const result = validateHierarchy('epic', null);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('epic parent must be initiative');
    });

    it('epic with non-initiative parent is invalid', () => {
      const invalidParents: WorkItemKind[] = ['project', 'epic', 'issue', 'task'];
      for (const parent of invalidParents) {
        const result = validateHierarchy('epic', parent);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('epic parent must be initiative');
      }
    });

    // issue: parent must be epic or null
    it('issue with epic parent is valid', () => {
      expect(validateHierarchy('issue', 'epic')).toEqual({ valid: true });
    });

    it('issue with no parent is valid (standalone/triage)', () => {
      expect(validateHierarchy('issue', null)).toEqual({ valid: true });
    });

    it('issue with non-epic parent is invalid', () => {
      const invalidParents: WorkItemKind[] = ['project', 'initiative', 'issue', 'task'];
      for (const parent of invalidParents) {
        const result = validateHierarchy('issue', parent);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('issue parent must be epic');
      }
    });

    // task: any parent except list
    it('task with any non-list parent is valid', () => {
      const validParents: WorkItemKind[] = ['project', 'initiative', 'epic', 'issue', 'task'];
      for (const parent of validParents) {
        expect(validateHierarchy('task', parent)).toEqual({ valid: true });
      }
    });

    it('task with no parent is valid', () => {
      expect(validateHierarchy('task', null)).toEqual({ valid: true });
    });

    it('task with list parent is invalid', () => {
      const result = validateHierarchy('task', 'list');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('cannot create child under a list');
    });
  });
});
