/**
 * @vitest-environment jsdom
 *
 * Tests for the PromptCard component.
 * Issue #2016: Frontend Dev Prompts Management Page.
 * Issue #2018: Frontend TDD Component Tests.
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PromptCard } from '@/ui/components/dev-prompts/prompt-card';
import type { DevPrompt } from '@/ui/lib/api-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const systemPrompt: DevPrompt = {
  id: 'p1',
  namespace: 'default',
  prompt_key: 'new_feature_request',
  category: 'creation',
  is_system: true,
  title: 'New Feature Request',
  description: 'Template for new feature requests',
  body: '# Feature: {{prompt_title}}',
  default_body: '# Feature: {{prompt_title}}',
  sort_order: 10,
  is_active: true,
  deleted_at: null,
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
};

const userPrompt: DevPrompt = {
  id: 'p2',
  namespace: 'troy',
  prompt_key: 'my_custom_prompt',
  category: 'custom',
  is_system: false,
  title: 'My Custom Prompt',
  description: 'A custom user prompt',
  body: 'Hello {{namespace}}!',
  default_body: '',
  sort_order: 100,
  is_active: true,
  deleted_at: null,
  created_at: '2026-03-02T00:00:00Z',
  updated_at: '2026-03-02T00:00:00Z',
};

const inactivePrompt: DevPrompt = {
  ...userPrompt,
  id: 'p3',
  is_active: false,
  title: 'Inactive Prompt',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PromptCard', () => {
  it('renders prompt title and description', () => {
    render(<PromptCard prompt={systemPrompt} />);

    expect(screen.getByText('New Feature Request')).toBeInTheDocument();
    expect(screen.getByText('Template for new feature requests')).toBeInTheDocument();
  });

  it('shows system badge for system prompts', () => {
    render(<PromptCard prompt={systemPrompt} />);

    expect(screen.getByText('system')).toBeInTheDocument();
  });

  it('does not show system badge for user prompts', () => {
    render(<PromptCard prompt={userPrompt} />);

    expect(screen.queryByText('system')).not.toBeInTheDocument();
  });

  it('shows category badge', () => {
    render(<PromptCard prompt={systemPrompt} />);

    expect(screen.getByText('creation')).toBeInTheDocument();
  });

  it('shows prompt_key', () => {
    render(<PromptCard prompt={systemPrompt} />);

    expect(screen.getByText('new_feature_request')).toBeInTheDocument();
  });

  it('shows inactive indicator when prompt is not active', () => {
    render(<PromptCard prompt={inactivePrompt} />);

    expect(screen.getByText('inactive')).toBeInTheDocument();
  });

  it('calls onEdit when card is clicked', () => {
    const onEdit = vi.fn();

    render(<PromptCard prompt={userPrompt} onEdit={onEdit} />);

    fireEvent.click(screen.getByText('My Custom Prompt'));

    expect(onEdit).toHaveBeenCalledWith(userPrompt);
  });

  it('renders action menu trigger for user prompts', () => {
    const onDelete = vi.fn();

    render(<PromptCard prompt={userPrompt} onDelete={onDelete} />);

    expect(screen.getByTestId('prompt-card-menu-p2')).toBeInTheDocument();
  });

  it('renders action menu trigger for system prompts', () => {
    render(<PromptCard prompt={systemPrompt} onDelete={vi.fn()} />);

    expect(screen.getByTestId('prompt-card-menu-p1')).toBeInTheDocument();
  });
});
