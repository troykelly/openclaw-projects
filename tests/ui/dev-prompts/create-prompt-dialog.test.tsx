/**
 * @vitest-environment jsdom
 *
 * Tests for the CreatePromptDialog component.
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
import { CreatePromptDialog } from '@/ui/components/dev-prompts/create-prompt-dialog';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderDialog(props: { open: boolean; onOpenChange?: (open: boolean) => void }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <CreatePromptDialog open={props.open} onOpenChange={props.onOpenChange ?? vi.fn()} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CreatePromptDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dialog when open', () => {
    renderDialog({ open: true });

    expect(screen.getByTestId('create-prompt-dialog')).toBeInTheDocument();
    expect(screen.getByText('Create Dev Prompt')).toBeInTheDocument();
  });

  it('does not render dialog when closed', () => {
    renderDialog({ open: false });

    expect(screen.queryByTestId('create-prompt-dialog')).not.toBeInTheDocument();
  });

  it('has required fields: title, prompt_key, body', () => {
    renderDialog({ open: true });

    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/prompt key/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/body/i)).toBeInTheDocument();
  });

  it('has optional category selector', () => {
    renderDialog({ open: true });

    expect(screen.getByTestId('category-select')).toBeInTheDocument();
  });

  it('submits form with valid data', async () => {
    const onOpenChange = vi.fn();
    mockApiClient.post.mockResolvedValue({
      id: 'new-id',
      prompt_key: 'my_prompt',
      title: 'My Prompt',
      body: 'Body text',
      category: 'custom',
    });

    renderDialog({ open: true, onOpenChange });

    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'My Prompt' } });
    fireEvent.change(screen.getByLabelText(/prompt key/i), { target: { value: 'my_prompt' } });
    fireEvent.change(screen.getByLabelText(/body/i), { target: { value: 'Body text' } });

    fireEvent.click(screen.getByTestId('submit-create-prompt'));

    await waitFor(() => {
      expect(mockApiClient.post).toHaveBeenCalledWith(
        '/dev-prompts',
        expect.objectContaining({
          title: 'My Prompt',
          prompt_key: 'my_prompt',
          body: 'Body text',
        }),
      );
    });
  });

  it('disables submit when required fields are empty', () => {
    renderDialog({ open: true });

    const submitButton = screen.getByTestId('submit-create-prompt');
    expect(submitButton).toBeDisabled();
  });
});
