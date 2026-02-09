/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryCard, MemoryList, MemoryEditor, MemoryDetailSheet, ItemMemories, type MemoryItem } from '@/ui/components/memory';

const mockMemory: MemoryItem = {
  id: '1',
  title: 'Project Architecture Notes',
  content: '# Overview\n\nThis project uses a monorepo structure with:\n- Frontend in React\n- Backend in Node.js',
  linkedItemId: 'proj-1',
  linkedItemTitle: 'Main Project',
  linkedItemKind: 'project',
  tags: ['architecture', 'documentation'],
  createdAt: new Date('2024-01-15'),
  updatedAt: new Date('2024-01-20'),
};

const mockMemories: MemoryItem[] = [
  mockMemory,
  {
    id: '2',
    title: 'API Design Decisions',
    content: 'We decided to use REST for external APIs and GraphQL for internal.',
    linkedItemId: 'epic-1',
    linkedItemTitle: 'API Epic',
    linkedItemKind: 'epic',
    tags: ['api', 'design'],
    createdAt: new Date('2024-01-10'),
    updatedAt: new Date('2024-01-12'),
  },
  {
    id: '3',
    title: 'Meeting Notes - Sprint Planning',
    content: 'Key decisions from the sprint planning meeting.',
    createdAt: new Date('2024-01-18'),
    updatedAt: new Date('2024-01-18'),
  },
];

describe('MemoryCard', () => {
  it('renders memory title', () => {
    render(<MemoryCard memory={mockMemory} />);

    expect(screen.getByText('Project Architecture Notes')).toBeInTheDocument();
  });

  it('renders content preview', () => {
    render(<MemoryCard memory={mockMemory} />);

    expect(screen.getByText(/This project uses a monorepo structure/)).toBeInTheDocument();
  });

  it('shows linked item info', () => {
    render(<MemoryCard memory={mockMemory} />);

    expect(screen.getByText('Main Project')).toBeInTheDocument();
  });

  it('shows tags', () => {
    render(<MemoryCard memory={mockMemory} />);

    expect(screen.getByText('architecture')).toBeInTheDocument();
    expect(screen.getByText('documentation')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<MemoryCard memory={mockMemory} onClick={onClick} />);

    fireEvent.click(screen.getByTestId('memory-card'));
    expect(onClick).toHaveBeenCalledWith(mockMemory);
  });

  it('shows edit/delete menu when handlers provided', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(<MemoryCard memory={mockMemory} onEdit={onEdit} onDelete={onDelete} />);

    // Menu trigger should exist
    const menuButton = screen.getByRole('button');
    expect(menuButton).toBeInTheDocument();
  });
});

describe('MemoryList', () => {
  it('renders all memories', () => {
    render(<MemoryList memories={mockMemories} />);

    expect(screen.getByText('Project Architecture Notes')).toBeInTheDocument();
    expect(screen.getByText('API Design Decisions')).toBeInTheDocument();
    expect(screen.getByText('Meeting Notes - Sprint Planning')).toBeInTheDocument();
  });

  it('filters by search query', () => {
    render(<MemoryList memories={mockMemories} />);

    const searchInput = screen.getByPlaceholderText('Search memories...');
    fireEvent.change(searchInput, { target: { value: 'API' } });

    expect(screen.queryByText('Project Architecture Notes')).not.toBeInTheDocument();
    expect(screen.getByText('API Design Decisions')).toBeInTheDocument();
  });

  it('shows empty state when no memories', () => {
    render(<MemoryList memories={[]} />);

    expect(screen.getByText('No memories yet')).toBeInTheDocument();
  });

  it('shows no results message when search has no matches', () => {
    render(<MemoryList memories={mockMemories} />);

    const searchInput = screen.getByPlaceholderText('Search memories...');
    fireEvent.change(searchInput, { target: { value: 'xyz' } });

    expect(screen.getByText('No memories found')).toBeInTheDocument();
  });

  it('shows add button when onAddMemory provided', () => {
    const onAddMemory = vi.fn();
    render(<MemoryList memories={mockMemories} onAddMemory={onAddMemory} />);

    expect(screen.getByText('Add Memory')).toBeInTheDocument();
  });

  it('filters by linked item type', () => {
    render(<MemoryList memories={mockMemories} />);

    // Open the select
    const selectTrigger = screen.getByRole('combobox');
    fireEvent.click(selectTrigger);

    // Select "Projects"
    fireEvent.click(screen.getByText('Projects'));

    // Only project memories should show
    expect(screen.getByText('Project Architecture Notes')).toBeInTheDocument();
    expect(screen.queryByText('API Design Decisions')).not.toBeInTheDocument();
  });
});

describe('MemoryEditor', () => {
  it('renders form fields', () => {
    render(<MemoryEditor open={true} onOpenChange={() => {}} onSubmit={() => {}} />);

    expect(screen.getByLabelText(/Title/)).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Write your memory content/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Tags/)).toBeInTheDocument();
  });

  it('pre-fills form when editing', () => {
    render(<MemoryEditor memory={mockMemory} open={true} onOpenChange={() => {}} onSubmit={() => {}} />);

    expect(screen.getByDisplayValue('Project Architecture Notes')).toBeInTheDocument();
  });

  it('submits form data', () => {
    const onSubmit = vi.fn();
    render(<MemoryEditor open={true} onOpenChange={() => {}} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Test Memory' } });
    fireEvent.change(screen.getByPlaceholderText(/Write your memory content/), {
      target: { value: 'Test content' },
    });

    const submitButton = screen.getByRole('button', { name: 'Create Memory' });
    fireEvent.click(submitButton);

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Test Memory',
        content: 'Test content',
      }),
    );
  });

  it('disables submit when required fields empty', () => {
    render(<MemoryEditor open={true} onOpenChange={() => {}} onSubmit={() => {}} />);

    const submitButton = screen.getByRole('button', { name: 'Create Memory' });
    expect(submitButton).toBeDisabled();
  });

  it('allows adding and removing tags', () => {
    render(<MemoryEditor open={true} onOpenChange={() => {}} onSubmit={() => {}} />);

    const tagInput = screen.getByPlaceholderText('Add a tag');
    fireEvent.change(tagInput, { target: { value: 'test-tag' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByText('test-tag ×')).toBeInTheDocument();

    // Click to remove
    fireEvent.click(screen.getByText('test-tag ×'));
    expect(screen.queryByText('test-tag ×')).not.toBeInTheDocument();
  });

  it('has edit and preview tabs', () => {
    render(<MemoryEditor open={true} onOpenChange={() => {}} onSubmit={() => {}} />);

    expect(screen.getByRole('tab', { name: /Edit/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Preview/i })).toBeInTheDocument();
  });
});

describe('MemoryDetailSheet', () => {
  it('renders memory title and content', () => {
    render(<MemoryDetailSheet memory={mockMemory} open={true} onOpenChange={() => {}} />);

    expect(screen.getByText('Project Architecture Notes')).toBeInTheDocument();
    expect(screen.getByText(/This project uses a monorepo structure/)).toBeInTheDocument();
  });

  it('shows linked item', () => {
    render(<MemoryDetailSheet memory={mockMemory} open={true} onOpenChange={() => {}} />);

    expect(screen.getByText(/Linked to: Main Project/)).toBeInTheDocument();
  });

  it('shows tags', () => {
    render(<MemoryDetailSheet memory={mockMemory} open={true} onOpenChange={() => {}} />);

    expect(screen.getByText('architecture')).toBeInTheDocument();
    expect(screen.getByText('documentation')).toBeInTheDocument();
  });

  it('calls onEdit when edit clicked', () => {
    const onEdit = vi.fn();
    render(<MemoryDetailSheet memory={mockMemory} open={true} onOpenChange={() => {}} onEdit={onEdit} />);

    fireEvent.click(screen.getByText('Edit'));
    expect(onEdit).toHaveBeenCalledWith(mockMemory);
  });

  it('calls onLinkedItemClick when linked item clicked', () => {
    const onLinkedItemClick = vi.fn();
    render(<MemoryDetailSheet memory={mockMemory} open={true} onOpenChange={() => {}} onLinkedItemClick={onLinkedItemClick} />);

    fireEvent.click(screen.getByText(/Linked to: Main Project/));
    expect(onLinkedItemClick).toHaveBeenCalledWith(mockMemory);
  });
});

describe('ItemMemories', () => {
  it('renders all attached memories', () => {
    render(<ItemMemories memories={mockMemories.slice(0, 2)} />);

    expect(screen.getByText('Project Architecture Notes')).toBeInTheDocument();
    expect(screen.getByText('API Design Decisions')).toBeInTheDocument();
  });

  it('shows memory count badge', () => {
    render(<ItemMemories memories={mockMemories.slice(0, 2)} />);

    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows empty state when no memories', () => {
    render(<ItemMemories memories={[]} />);

    expect(screen.getByText('No memories attached')).toBeInTheDocument();
  });

  it('shows add and link buttons when handlers provided', () => {
    const onAddMemory = vi.fn();
    const onLinkMemory = vi.fn();
    render(<ItemMemories memories={[]} onAddMemory={onAddMemory} onLinkMemory={onLinkMemory} />);

    expect(screen.getByText('Create new')).toBeInTheDocument();
    expect(screen.getByText('Link existing')).toBeInTheDocument();
  });

  it('calls onMemoryClick when memory clicked', () => {
    const onMemoryClick = vi.fn();
    render(<ItemMemories memories={mockMemories.slice(0, 1)} onMemoryClick={onMemoryClick} />);

    fireEvent.click(screen.getByTestId('memory-card'));
    expect(onMemoryClick).toHaveBeenCalledWith(mockMemories[0]);
  });
});
