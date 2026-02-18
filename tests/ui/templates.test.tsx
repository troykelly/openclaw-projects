/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useTemplates } from '@/ui/components/templates/use-templates';
import { TemplateSelector } from '@/ui/components/templates/template-selector';
import { TemplateManager } from '@/ui/components/templates/template-manager';
import { SaveTemplateDialog } from '@/ui/components/templates/save-template-dialog';
import type { WorkItemTemplate } from '@/ui/components/templates/types';
import { renderHook } from '@testing-library/react';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('useTemplates hook', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('returns built-in templates by default', () => {
    const { result } = renderHook(() => useTemplates());

    expect(result.current.templates.length).toBeGreaterThan(0);
    expect(result.current.templates.some((t) => t.id === 'builtin-sprint')).toBe(true);
  });

  it('can save a custom template', () => {
    const { result } = renderHook(() => useTemplates());

    const template: Omit<WorkItemTemplate, 'id' | 'created_at'> = {
      name: 'My Template',
      description: 'Custom template',
      category: 'custom',
      structure: {
        kind: 'epic',
        title: 'New Epic',
        children: [],
      },
    };

    act(() => {
      result.current.saveTemplate(template);
    });

    const customTemplates = result.current.templates.filter((t) => t.category === 'custom');
    expect(customTemplates.length).toBe(1);
    expect(customTemplates[0].name).toBe('My Template');
  });

  it('can delete a custom template', () => {
    const { result } = renderHook(() => useTemplates());

    const template: Omit<WorkItemTemplate, 'id' | 'created_at'> = {
      name: 'Delete Me',
      description: 'Will be deleted',
      category: 'custom',
      structure: {
        kind: 'issue',
        title: 'Issue',
        children: [],
      },
    };

    act(() => {
      result.current.saveTemplate(template);
    });

    const customTemplate = result.current.templates.find((t) => t.name === 'Delete Me');
    expect(customTemplate).toBeDefined();

    act(() => {
      result.current.deleteTemplate(customTemplate!.id);
    });

    expect(result.current.templates.find((t) => t.name === 'Delete Me')).toBeUndefined();
  });

  it('persists templates to localStorage', () => {
    const { result } = renderHook(() => useTemplates());

    act(() => {
      result.current.saveTemplate({
        name: 'Persisted',
        description: 'Should persist',
        category: 'custom',
        structure: {
          kind: 'task',
          title: 'Task',
          children: [],
        },
      });
    });

    const stored = localStorageMock.getItem('work-item-templates');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.some((t: WorkItemTemplate) => t.name === 'Persisted')).toBe(true);
  });

  it('filters templates by category', () => {
    const { result } = renderHook(() => useTemplates());

    const sprintTemplates = result.current.getTemplatesByCategory('sprint');
    expect(sprintTemplates.length).toBeGreaterThan(0);
    expect(sprintTemplates.every((t) => t.category === 'sprint')).toBe(true);
  });
});

describe('TemplateSelector', () => {
  const mockOnSelect = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('renders template categories', () => {
    render(<TemplateSelector open={true} onSelect={mockOnSelect} onCancel={mockOnCancel} />);

    // Check for tab triggers specifically
    expect(screen.getByRole('tab', { name: /sprint/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /feature/i })).toBeInTheDocument();
  });

  it('shows built-in templates', () => {
    render(<TemplateSelector open={true} onSelect={mockOnSelect} onCancel={mockOnCancel} />);

    expect(screen.getByText('Sprint Planning')).toBeInTheDocument();
  });

  it('calls onSelect with template when clicking Use Template', () => {
    render(<TemplateSelector open={true} onSelect={mockOnSelect} onCancel={mockOnCancel} />);

    // Click on a template card
    fireEvent.click(screen.getByText('Sprint Planning'));

    // Click Use Template button
    fireEvent.click(screen.getByRole('button', { name: /use template/i }));

    expect(mockOnSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Sprint Planning',
      }),
    );
  });
});

describe('TemplateManager', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('displays all templates', () => {
    render(<TemplateManager />);

    expect(screen.getByText('Sprint Planning')).toBeInTheDocument();
    expect(screen.getByText('Feature Development')).toBeInTheDocument();
  });

  it('filters templates by search', () => {
    render(<TemplateManager />);

    const searchInput = screen.getByPlaceholderText(/search templates/i);
    fireEvent.change(searchInput, { target: { value: 'Sprint' } });

    expect(screen.getByText('Sprint Planning')).toBeInTheDocument();
    expect(screen.queryByText('Feature Development')).not.toBeInTheDocument();
  });

  it('shows delete button for custom templates', () => {
    // Pre-populate localStorage with a custom template
    const customTemplate: WorkItemTemplate = {
      id: 'custom-1',
      name: 'My Custom',
      description: 'A custom template',
      category: 'custom',
      structure: {
        kind: 'epic',
        title: 'Custom Epic',
        children: [],
      },
      created_at: new Date().toISOString(),
    };
    localStorageMock.setItem('work-item-templates', JSON.stringify([customTemplate]));

    render(<TemplateManager />);

    // Find the custom template and its delete button
    const customCard = screen.getByText('My Custom').closest('[data-template]');
    expect(customCard).toBeInTheDocument();

    const deleteButton = customCard?.querySelector('[aria-label="Delete template"]');
    expect(deleteButton).toBeInTheDocument();
  });
});

describe('SaveTemplateDialog', () => {
  const mockOnSave = vi.fn();
  const mockOnCancel = vi.fn();

  const mockItem = {
    id: 'item-1',
    title: 'My Project',
    kind: 'epic' as const,
    children: [
      { id: 'child-1', title: 'Task 1', kind: 'issue' as const },
      { id: 'child-2', title: 'Task 2', kind: 'issue' as const },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dialog with item title as default template name', () => {
    render(<SaveTemplateDialog open={true} item={mockItem} onSave={mockOnSave} onCancel={mockOnCancel} />);

    expect(screen.getByDisplayValue('My Project')).toBeInTheDocument();
  });

  it('shows category selection', () => {
    render(<SaveTemplateDialog open={true} item={mockItem} onSave={mockOnSave} onCancel={mockOnCancel} />);

    expect(screen.getByLabelText(/category/i)).toBeInTheDocument();
  });

  it('shows include children option', () => {
    render(<SaveTemplateDialog open={true} item={mockItem} onSave={mockOnSave} onCancel={mockOnCancel} />);

    expect(screen.getByText(/include children/i)).toBeInTheDocument();
  });

  it('calls onSave with template data when Save clicked', () => {
    render(<SaveTemplateDialog open={true} item={mockItem} onSave={mockOnSave} onCancel={mockOnCancel} />);

    // Edit template name
    const nameInput = screen.getByDisplayValue('My Project');
    fireEvent.change(nameInput, { target: { value: 'My Template' } });

    // Add description
    const descInput = screen.getByPlaceholderText(/describe this template/i);
    fireEvent.change(descInput, { target: { value: 'A great template' } });

    // Click save
    fireEvent.click(screen.getByRole('button', { name: /save template/i }));

    expect(mockOnSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'My Template',
        description: 'A great template',
      }),
    );
  });

  it('disables save when name is empty', () => {
    render(<SaveTemplateDialog open={true} item={mockItem} onSave={mockOnSave} onCancel={mockOnCancel} />);

    const nameInput = screen.getByDisplayValue('My Project');
    fireEvent.change(nameInput, { target: { value: '' } });

    expect(screen.getByRole('button', { name: /save template/i })).toBeDisabled();
  });
});
