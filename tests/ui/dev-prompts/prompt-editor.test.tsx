/**
 * @vitest-environment jsdom
 *
 * Tests for the PromptEditor component.
 * Issue #2016: Frontend Dev Prompts Management Page.
 * Issue #2018: Frontend TDD Component Tests.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mocks — use vi.hoisted to avoid hoisting issues with vi.mock factory
// ---------------------------------------------------------------------------

const { mockApiClient } = vi.hoisted(() => ({
  mockApiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    put: vi.fn(),
  },
}));

vi.mock('@/ui/lib/api-client', () => ({
  apiClient: mockApiClient,
}));

// Import after mock setup
import { PromptEditor } from '@/ui/components/dev-prompts/prompt-editor';
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
  body: '# Feature: {{prompt_title}}\nDate: {{date}}',
  default_body: '# Feature: {{prompt_title}}\nDate: {{date}}',
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderEditor(props: { prompt: DevPrompt; onClose?: () => void }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <PromptEditor {...props} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PromptEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders prompt title and body textarea', () => {
    renderEditor({ prompt: userPrompt });

    expect(screen.getByText('My Custom Prompt')).toBeInTheDocument();
    expect(screen.getByTestId('prompt-body-editor')).toBeInTheDocument();
  });

  it('shows Edit and Preview tabs', () => {
    renderEditor({ prompt: userPrompt });

    expect(screen.getByRole('tab', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /preview/i })).toBeInTheDocument();
  });

  it('shows body content in the editor textarea', () => {
    renderEditor({ prompt: userPrompt });

    const textarea = screen.getByTestId('prompt-body-editor') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Hello {{namespace}}!');
  });

  it('allows editing the body', () => {
    renderEditor({ prompt: userPrompt });

    const textarea = screen.getByTestId('prompt-body-editor') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'New body content' } });

    expect(textarea.value).toBe('New body content');
  });

  it('shows save button', () => {
    renderEditor({ prompt: userPrompt });

    expect(screen.getByTestId('save-prompt-button')).toBeInTheDocument();
  });

  it('shows reset button for system prompts only', () => {
    renderEditor({ prompt: systemPrompt });
    expect(screen.getByTestId('reset-prompt-button')).toBeInTheDocument();
  });

  it('does not show reset button for user prompts', () => {
    renderEditor({ prompt: userPrompt });
    expect(screen.queryByTestId('reset-prompt-button')).not.toBeInTheDocument();
  });

  it('has preview tab available', () => {
    renderEditor({ prompt: systemPrompt });

    const previewTab = screen.getByRole('tab', { name: /preview/i });
    expect(previewTab).toBeInTheDocument();
    expect(previewTab).toHaveAttribute('data-state', 'inactive');

    const editTab = screen.getByRole('tab', { name: /edit/i });
    expect(editTab).toHaveAttribute('data-state', 'active');
  });

  it('calls onClose when back/close button is clicked', () => {
    const onClose = vi.fn();
    renderEditor({ prompt: userPrompt, onClose });

    fireEvent.click(screen.getByTestId('editor-close-button'));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('saves body changes via PATCH mutation', async () => {
    mockApiClient.patch.mockResolvedValue({ ...userPrompt, body: 'Updated body' });

    renderEditor({ prompt: userPrompt });

    const textarea = screen.getByTestId('prompt-body-editor') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Updated body' } });
    fireEvent.click(screen.getByTestId('save-prompt-button'));

    await waitFor(() => {
      expect(mockApiClient.patch).toHaveBeenCalledWith(
        '/dev-prompts/p2',
        expect.objectContaining({ body: 'Updated body' }),
      );
    });
  });
});
