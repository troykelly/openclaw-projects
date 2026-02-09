/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ItemDetail,
  ItemHeader,
  MetadataGrid,
  TodoList,
  AttachmentsSection,
  DependenciesSection,
  DescriptionEditor,
  type WorkItemDetail,
  type WorkItemTodo,
  type WorkItemAttachment,
  type WorkItemDependency,
} from '@/ui/components/detail';

const mockItem: WorkItemDetail = {
  id: 'item-1',
  title: 'Test Item',
  kind: 'issue',
  status: 'in_progress',
  priority: 'high',
  description: 'Test **description** with `code`',
  parentId: 'parent-1',
  parentTitle: 'Parent Epic',
  assignee: 'John Doe',
  estimateMinutes: 120,
  actualMinutes: 60,
  dueDate: new Date('2026-03-01'),
  startDate: new Date('2026-02-01'),
  createdAt: new Date(),
  updatedAt: new Date(),
  todos: [
    { id: 'todo-1', text: 'First task', completed: true, createdAt: new Date() },
    { id: 'todo-2', text: 'Second task', completed: false, createdAt: new Date() },
  ],
  attachments: [
    { id: 'att-1', type: 'memory', title: 'Meeting Notes', linkedAt: new Date() },
    { id: 'att-2', type: 'contact', title: 'Jane Smith', subtitle: 'Engineer', linkedAt: new Date() },
  ],
  dependencies: [
    { id: 'dep-1', title: 'Blocking Issue', kind: 'issue', status: 'in_progress', direction: 'blocked_by' },
    { id: 'dep-2', title: 'Dependent Issue', kind: 'issue', status: 'not_started', direction: 'blocks' },
  ],
};

describe('ItemHeader', () => {
  it('renders title and kind badge', () => {
    render(<ItemHeader title="Test" kind="issue" status="in_progress" />);

    expect(screen.getByText('Test')).toBeInTheDocument();
    expect(screen.getByText('Issue')).toBeInTheDocument();
  });

  it('renders breadcrumb when parent is provided', () => {
    render(<ItemHeader title="Test" kind="issue" status="in_progress" parentTitle="Parent Epic" />);

    expect(screen.getByText('Parent Epic')).toBeInTheDocument();
  });

  it('shows edit button on hover and allows inline editing', () => {
    const onTitleChange = vi.fn();
    render(<ItemHeader title="Test" kind="issue" status="in_progress" onTitleChange={onTitleChange} />);

    // Edit button has sr-only text "Edit title", find it by that text
    const editButton = screen.getByText('Edit title');
    expect(editButton).toBeInTheDocument();
    // Click the parent button element
    fireEvent.click(editButton.closest('button')!);

    // Type new value
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'New Title' } });

    // Save button has sr-only text
    const saveButton = screen.getByText('Save');
    fireEvent.click(saveButton.closest('button')!);

    expect(onTitleChange).toHaveBeenCalledWith('New Title');
  });

  it('shows status badge with correct variant', () => {
    render(<ItemHeader title="Test" kind="issue" status="blocked" />);

    // blocked status should have destructive variant
    const badge = screen.getByText('Blocked');
    expect(badge).toBeInTheDocument();
  });
});

describe('MetadataGrid', () => {
  it('renders all metadata fields', () => {
    render(<MetadataGrid status="in_progress" priority="high" assignee="John" estimateMinutes={120} />);

    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('John')).toBeInTheDocument();
    expect(screen.getByText('2h')).toBeInTheDocument();
  });

  it('shows Unassigned when no assignee', () => {
    render(<MetadataGrid status="not_started" priority="low" />);

    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });
});

describe('TodoList', () => {
  const todos: WorkItemTodo[] = [
    { id: '1', text: 'Task A', completed: true, createdAt: new Date() },
    { id: '2', text: 'Task B', completed: false, createdAt: new Date() },
  ];

  it('renders todos with checkboxes', () => {
    render(<TodoList todos={todos} />);

    expect(screen.getByText('Task A')).toBeInTheDocument();
    expect(screen.getByText('Task B')).toBeInTheDocument();
    expect(screen.getByText('1/2 completed')).toBeInTheDocument();
  });

  it('calls onToggle when checkbox is clicked', () => {
    const onToggle = vi.fn();
    render(<TodoList todos={todos} onToggle={onToggle} />);

    // Click the first checkbox (completed task)
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    expect(onToggle).toHaveBeenCalledWith('1', false);
  });

  it('allows adding new todos', () => {
    const onAdd = vi.fn();
    render(<TodoList todos={todos} onAdd={onAdd} />);

    const input = screen.getByPlaceholderText('Add a task...');
    fireEvent.change(input, { target: { value: 'New task' } });
    fireEvent.click(screen.getByText('Add'));

    expect(onAdd).toHaveBeenCalledWith('New task');
  });

  it('shows progress bar', () => {
    const { container } = render(<TodoList todos={todos} />);

    // Progress bar should exist and show 50% (1 of 2 completed)
    const progressBar = container.querySelector('.bg-primary');
    expect(progressBar).toBeTruthy();
  });
});

describe('AttachmentsSection', () => {
  const attachments: WorkItemAttachment[] = [
    { id: '1', type: 'memory', title: 'Notes', linkedAt: new Date() },
    { id: '2', type: 'contact', title: 'Alice', linkedAt: new Date() },
  ];

  it('renders grouped attachments', () => {
    render(<AttachmentsSection attachments={attachments} />);

    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText(/Memorys \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Contacts \(1\)/i)).toBeInTheDocument();
  });

  it('shows empty state when no attachments', () => {
    render(<AttachmentsSection attachments={[]} />);

    expect(screen.getByText('No linked items')).toBeInTheDocument();
  });

  it('calls onAttachmentClick when clicked', () => {
    const onClick = vi.fn();
    render(<AttachmentsSection attachments={attachments} onAttachmentClick={onClick} />);

    fireEvent.click(screen.getByText('Notes'));
    expect(onClick).toHaveBeenCalledWith(attachments[0]);
  });
});

describe('DependenciesSection', () => {
  const dependencies: WorkItemDependency[] = [
    { id: '1', title: 'Blocker', kind: 'issue', status: 'in_progress', direction: 'blocked_by' },
    { id: '2', title: 'Dependent', kind: 'issue', status: 'done', direction: 'blocks' },
  ];

  it('renders blocked by and blocks sections', () => {
    render(<DependenciesSection dependencies={dependencies} />);

    expect(screen.getByText('Blocker')).toBeInTheDocument();
    expect(screen.getByText('Dependent')).toBeInTheDocument();
    expect(screen.getByText(/Blocked by \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Blocks \(1\)/)).toBeInTheDocument();
  });

  it('shows empty states when no dependencies', () => {
    render(<DependenciesSection dependencies={[]} />);

    expect(screen.getByText('No blockers')).toBeInTheDocument();
    expect(screen.getByText('No dependents')).toBeInTheDocument();
  });
});

describe('DescriptionEditor', () => {
  it('renders markdown content', () => {
    render(<DescriptionEditor description="**Bold** and *italic*" />);

    expect(screen.getByText('Bold')).toBeInTheDocument();
    expect(screen.getByText('italic')).toBeInTheDocument();
  });

  it('shows empty state when no description', () => {
    render(<DescriptionEditor />);

    expect(screen.getByText('No description')).toBeInTheDocument();
  });

  it('allows editing description', () => {
    const onChange = vi.fn();
    render(<DescriptionEditor description="Test" onDescriptionChange={onChange} />);

    fireEvent.click(screen.getByText('Edit'));

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'New content' } });

    fireEvent.click(screen.getByText('Save'));

    expect(onChange).toHaveBeenCalledWith('New content');
  });

  it('supports preview mode', () => {
    render(<DescriptionEditor description="**Bold**" onDescriptionChange={() => {}} />);

    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Preview'));

    // Should show rendered markdown
    expect(screen.getByText('Bold')).toBeInTheDocument();
  });
});

describe('ItemDetail', () => {
  it('renders all sections', () => {
    render(<ItemDetail item={mockItem} />);

    // Header
    expect(screen.getByText('Test Item')).toBeInTheDocument();
    expect(screen.getByText('Parent Epic')).toBeInTheDocument();

    // Metadata - use getAllByText since status appears twice (header badge + metadata)
    expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0);
    expect(screen.getAllByText('High').length).toBeGreaterThan(0);

    // Description - find by partial text since it's rendered with inline formatting
    expect(screen.getByText('description')).toBeInTheDocument();

    // Todos
    expect(screen.getByText('First task')).toBeInTheDocument();
    expect(screen.getByText('Second task')).toBeInTheDocument();

    // Attachments
    expect(screen.getByText('Meeting Notes')).toBeInTheDocument();

    // Dependencies
    expect(screen.getByText('Blocking Issue')).toBeInTheDocument();
  });

  it('calls callbacks when interactions occur', () => {
    const onTitleChange = vi.fn();
    const onTodoToggle = vi.fn();

    render(<ItemDetail item={mockItem} onTitleChange={onTitleChange} onTodoToggle={onTodoToggle} />);

    // Toggle a todo
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    expect(onTodoToggle).toHaveBeenCalledWith('todo-1', false);
  });
});
