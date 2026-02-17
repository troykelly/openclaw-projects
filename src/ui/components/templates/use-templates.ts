/**
 * Hook for managing work item templates
 */
import * as React from 'react';
import type { WorkItemTemplate, TemplateCategory, UseTemplatesReturn } from './types';

const STORAGE_KEY = 'work-item-templates';

/**
 * Built-in templates available by default
 */
const BUILTIN_TEMPLATES: WorkItemTemplate[] = [
  {
    id: 'builtin-sprint',
    name: 'Sprint Planning',
    description: 'An epic with standard sprint issues: planning, development, testing, review',
    category: 'sprint',
    isBuiltIn: true,
    created_at: '2024-01-01T00:00:00.000Z',
    structure: {
      kind: 'epic',
      title: 'Sprint [N]',
      description: 'Sprint planning epic',
      children: [
        {
          kind: 'issue',
          title: 'Sprint Planning',
          description: 'Plan sprint scope and goals',
        },
        {
          kind: 'issue',
          title: 'Development',
          description: 'Implement sprint items',
        },
        {
          kind: 'issue',
          title: 'Testing',
          description: 'Test completed features',
        },
        {
          kind: 'issue',
          title: 'Sprint Review',
          description: 'Demo and review completed work',
        },
        {
          kind: 'issue',
          title: 'Retrospective',
          description: 'Team retrospective',
        },
      ],
    },
  },
  {
    id: 'builtin-feature',
    name: 'Feature Development',
    description: 'An initiative structure for developing a new feature with design, implementation, and testing phases',
    category: 'feature',
    isBuiltIn: true,
    created_at: '2024-01-01T00:00:00.000Z',
    structure: {
      kind: 'initiative',
      title: 'Feature: [Name]',
      description: 'New feature initiative',
      children: [
        {
          kind: 'epic',
          title: 'Design',
          description: 'Design the feature',
          children: [
            { kind: 'issue', title: 'Requirements Gathering' },
            { kind: 'issue', title: 'Technical Design' },
            { kind: 'issue', title: 'UI/UX Design' },
          ],
        },
        {
          kind: 'epic',
          title: 'Implementation',
          description: 'Build the feature',
          children: [
            { kind: 'issue', title: 'Backend Development' },
            { kind: 'issue', title: 'Frontend Development' },
            { kind: 'issue', title: 'Integration' },
          ],
        },
        {
          kind: 'epic',
          title: 'Quality Assurance',
          description: 'Test and validate',
          children: [
            { kind: 'issue', title: 'Unit Tests' },
            { kind: 'issue', title: 'Integration Tests' },
            { kind: 'issue', title: 'User Acceptance Testing' },
          ],
        },
      ],
    },
  },
  {
    id: 'builtin-bugfix',
    name: 'Bug Fix',
    description: 'An issue with a standard bug fix checklist',
    category: 'bugfix',
    isBuiltIn: true,
    created_at: '2024-01-01T00:00:00.000Z',
    structure: {
      kind: 'issue',
      title: 'Bug: [Description]',
      description: 'Fix the reported bug',
      todos: [
        'Reproduce the issue',
        'Identify root cause',
        'Write failing test',
        'Implement fix',
        'Verify fix resolves issue',
        'Add regression test',
        'Update documentation if needed',
      ],
    },
  },
  {
    id: 'builtin-project',
    name: 'New Project',
    description: 'A project structure with standard phases: planning, execution, delivery',
    category: 'project',
    isBuiltIn: true,
    created_at: '2024-01-01T00:00:00.000Z',
    structure: {
      kind: 'project',
      title: 'Project: [Name]',
      description: 'New project',
      children: [
        {
          kind: 'initiative',
          title: 'Planning',
          description: 'Project planning phase',
          children: [
            {
              kind: 'epic',
              title: 'Requirements',
              children: [
                { kind: 'issue', title: 'Stakeholder Interviews' },
                { kind: 'issue', title: 'Requirements Document' },
              ],
            },
            {
              kind: 'epic',
              title: 'Architecture',
              children: [
                { kind: 'issue', title: 'Technical Architecture' },
                { kind: 'issue', title: 'Infrastructure Planning' },
              ],
            },
          ],
        },
        {
          kind: 'initiative',
          title: 'Execution',
          description: 'Project execution phase',
        },
        {
          kind: 'initiative',
          title: 'Delivery',
          description: 'Project delivery phase',
          children: [
            {
              kind: 'epic',
              title: 'Launch',
              children: [
                { kind: 'issue', title: 'Deployment' },
                { kind: 'issue', title: 'Documentation' },
                { kind: 'issue', title: 'Training' },
              ],
            },
          ],
        },
      ],
    },
  },
];

function generateId(): string {
  return `template-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function loadCustomTemplates(): WorkItemTemplate[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveCustomTemplates(templates: WorkItemTemplate[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  } catch {
    // Storage might be full or unavailable
  }
}

export function useTemplates(): UseTemplatesReturn {
  const [customTemplates, setCustomTemplates] = React.useState<WorkItemTemplate[]>(() => loadCustomTemplates());

  const templates = React.useMemo(() => [...BUILTIN_TEMPLATES, ...customTemplates], [customTemplates]);

  const saveTemplate = React.useCallback(
    (template: Omit<WorkItemTemplate, 'id' | 'created_at'>) => {
      const newTemplate: WorkItemTemplate = {
        ...template,
        id: generateId(),
        created_at: new Date().toISOString(),
      };
      const updated = [...customTemplates, newTemplate];
      setCustomTemplates(updated);
      saveCustomTemplates(updated);
    },
    [customTemplates],
  );

  const deleteTemplate = React.useCallback(
    (id: string) => {
      // Can only delete custom templates
      const template = customTemplates.find((t) => t.id === id);
      if (!template) return;

      const updated = customTemplates.filter((t) => t.id !== id);
      setCustomTemplates(updated);
      saveCustomTemplates(updated);
    },
    [customTemplates],
  );

  const getTemplatesByCategory = React.useCallback(
    (category: TemplateCategory) => {
      return templates.filter((t) => t.category === category);
    },
    [templates],
  );

  return {
    templates,
    saveTemplate,
    deleteTemplate,
    getTemplatesByCategory,
  };
}
