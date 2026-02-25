/**
 * Tests for issue #1737: Inbound routing section must surface API errors
 * to the user instead of swallowing them silently in catch blocks.
 *
 * Each sub-component (ChannelDefaultsSection, InboundDestinationsSection,
 * PromptTemplatesSection) has catch blocks that need user-visible error state.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/ui/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiRequestError: class extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock('@/ui/lib/auth-manager', () => ({
  getAccessToken: vi.fn(() => 'test-token'),
  clearAccessToken: vi.fn(),
  refreshAccessToken: vi.fn(),
}));

vi.mock('@/ui/lib/api-config', () => ({
  getApiBaseUrl: vi.fn(() => 'http://localhost:3000'),
}));

vi.mock('@/ui/lib/version', () => ({
  APP_VERSION: '0.0.0-test',
}));

import { apiClient } from '@/ui/lib/api-client';

const mockedApiClient = vi.mocked(apiClient);

// Suppress React error boundary noise
const originalConsoleError = console.error;
beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  console.error = (...args: any[]) => {
    const msg = String(args[0]);
    if (msg.includes('Error: Uncaught') || msg.includes('The above error')) return;
    originalConsoleError(...args);
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  console.error = originalConsoleError;
});

// ---------------------------------------------------------------------------
// ChannelDefaultsSection — fetch error
// ---------------------------------------------------------------------------

describe('ChannelDefaultsSection error handling (#1737)', () => {
  it('shows error message when initial fetch fails', async () => {
    mockedApiClient.get.mockRejectedValue(new Error('Network error'));

    const { InboundRoutingSection } = await import(
      '@/ui/components/settings/inbound-routing-section'
    );

    render(<InboundRoutingSection />);

    await waitFor(() => {
      expect(screen.getByTestId('channel-defaults-error')).toBeInTheDocument();
    });

    expect(screen.getByText(/failed to load channel defaults/i)).toBeInTheDocument();
  });

  it('shows error message when saving a channel default fails', async () => {
    // First call: fetch succeeds with configured defaults
    mockedApiClient.get
      .mockResolvedValueOnce([
        { id: '1', channel_type: 'sms', agent_id: 'agent-1', prompt_template_id: null, context_id: null },
      ])
      // InboundDestinationsSection fetch
      .mockResolvedValueOnce({ items: [], total: 0 })
      // PromptTemplatesSection fetch
      .mockResolvedValueOnce({ items: [], total: 0 });

    // PUT fails
    mockedApiClient.put.mockRejectedValue(new Error('Server error'));

    const { InboundRoutingSection } = await import(
      '@/ui/components/settings/inbound-routing-section'
    );

    render(<InboundRoutingSection />);

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByTestId('channel-defaults-section')).toBeInTheDocument();
    });

    // Open the agent combobox for SMS channel
    const comboboxTrigger = screen.getByTestId('agent-combobox-trigger-sms');
    fireEvent.click(comboboxTrigger);

    // Wait for the combobox input to appear, then type a new agent ID
    await waitFor(() => {
      expect(screen.getByTestId('agent-combobox-input-sms')).toBeInTheDocument();
    });
    const comboboxInput = screen.getByTestId('agent-combobox-input-sms');
    fireEvent.change(comboboxInput, { target: { value: 'agent-updated' } });

    // Select the custom option ("Use 'agent-updated'")
    await waitFor(() => {
      expect(screen.getByText(/Use/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/Use/));

    // Click save
    const saveButton = screen.getAllByText('Save')[0];
    fireEvent.click(saveButton);

    // Should show an error
    await waitFor(() => {
      expect(screen.getByTestId('channel-defaults-error')).toBeInTheDocument();
    });

    expect(screen.getByText(/failed to save/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// InboundDestinationsSection — fetch error
// ---------------------------------------------------------------------------

describe('InboundDestinationsSection error handling (#1737)', () => {
  it('shows error message when initial fetch fails', async () => {
    // ChannelDefaultsSection fetch succeeds
    mockedApiClient.get
      .mockResolvedValueOnce([])
      // InboundDestinationsSection fetch fails
      .mockRejectedValueOnce(new Error('Network error'))
      // PromptTemplatesSection fetch succeeds
      .mockResolvedValueOnce({ items: [], total: 0 });

    const { InboundRoutingSection } = await import(
      '@/ui/components/settings/inbound-routing-section'
    );

    render(<InboundRoutingSection />);

    await waitFor(() => {
      expect(screen.getByTestId('inbound-destinations-error')).toBeInTheDocument();
    });

    expect(screen.getByText(/failed to load inbound destinations/i)).toBeInTheDocument();
  });

  it('shows error message when saving a destination override fails', async () => {
    mockedApiClient.get
      // ChannelDefaultsSection fetch
      .mockResolvedValueOnce([])
      // InboundDestinationsSection fetch
      .mockResolvedValueOnce({
        items: [
          { id: 'd1', address: '+1234567890', channel_type: 'sms', display_name: null, agent_id: null, prompt_template_id: null, context_id: null, is_active: true },
        ],
        total: 1,
      })
      // PromptTemplatesSection fetch
      .mockResolvedValueOnce({ items: [], total: 0 });

    mockedApiClient.put.mockRejectedValue(new Error('Save failed'));

    const { InboundRoutingSection } = await import(
      '@/ui/components/settings/inbound-routing-section'
    );

    render(<InboundRoutingSection />);

    // Wait for destinations to load
    await waitFor(() => {
      expect(screen.getByText('+1234567890')).toBeInTheDocument();
    });

    // The destination row has a single ghost button (pencil icon) for editing.
    // Find the row containing our address and click its button.
    const destSection = screen.getByTestId('inbound-destinations-section');
    // Get all buttons inside CardContent (excluding filter selects)
    const allButtons = Array.from(destSection.querySelectorAll('button'));
    // The filter trigger is a button too. Find the pencil button in the destination row.
    // The destination row is a div with class containing "rounded-lg border p-3"
    const destRow = destSection.querySelector('.space-y-2 > div');
    expect(destRow).toBeTruthy();
    const editBtn = destRow!.querySelector('button');
    expect(editBtn).toBeTruthy();
    fireEvent.click(editBtn!);

    // Wait for edit mode — the input should appear
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/agent id/i)).toBeInTheDocument();
    });

    // Type an agent ID
    const agentInput = screen.getByPlaceholderText(/agent id/i);
    fireEvent.change(agentInput, { target: { value: 'my-agent' } });

    // Click Save — scoped to the destinations section to avoid ambiguity with channel defaults
    const saveBtn = within(destSection).getByText('Save');
    fireEvent.click(saveBtn);

    // Should show error
    await waitFor(() => {
      expect(screen.getByTestId('inbound-destinations-error')).toBeInTheDocument();
    });

    expect(screen.getByText(/failed to save/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PromptTemplatesSection — fetch error
// ---------------------------------------------------------------------------

describe('PromptTemplatesSection error handling (#1737)', () => {
  it('shows error message when initial fetch fails', async () => {
    mockedApiClient.get
      // ChannelDefaultsSection fetch succeeds
      .mockResolvedValueOnce([])
      // InboundDestinationsSection fetch succeeds
      .mockResolvedValueOnce({ items: [], total: 0 })
      // PromptTemplatesSection fetch fails
      .mockRejectedValueOnce(new Error('Network error'));

    const { InboundRoutingSection } = await import(
      '@/ui/components/settings/inbound-routing-section'
    );

    render(<InboundRoutingSection />);

    await waitFor(() => {
      expect(screen.getByTestId('prompt-templates-error')).toBeInTheDocument();
    });

    expect(screen.getByText(/failed to load prompt templates/i)).toBeInTheDocument();
  });

  it('shows error message when creating a template fails', async () => {
    mockedApiClient.get
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({ items: [], total: 0 });

    mockedApiClient.post.mockRejectedValue(new Error('Create failed'));

    const { InboundRoutingSection } = await import(
      '@/ui/components/settings/inbound-routing-section'
    );

    render(<InboundRoutingSection />);

    // Wait for prompt templates section to load
    await waitFor(() => {
      expect(screen.getByTestId('prompt-templates-section')).toBeInTheDocument();
    });

    // Click "New Template"
    fireEvent.click(screen.getByText(/new template/i));

    // Fill in the form
    const labelInput = screen.getByPlaceholderText(/e\.g\. SMS Triage/i);
    fireEvent.change(labelInput, { target: { value: 'Test Template' } });

    const contentInput = screen.getByPlaceholderText(/you are an SMS/i);
    fireEvent.change(contentInput, { target: { value: 'Some prompt content' } });

    // Click Create
    fireEvent.click(screen.getByText('Create'));

    // Should show error
    await waitFor(() => {
      expect(screen.getByTestId('prompt-templates-error')).toBeInTheDocument();
    });

    expect(screen.getByText(/failed to save/i)).toBeInTheDocument();
  });

  it('shows error message when deleting a template fails', async () => {
    mockedApiClient.get
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({
        items: [
          { id: 'pt1', label: 'My Template', content: 'Prompt here', channel_type: 'sms', is_default: false, is_active: true },
        ],
        total: 1,
      });

    mockedApiClient.delete.mockRejectedValue(new Error('Delete failed'));

    const { InboundRoutingSection } = await import(
      '@/ui/components/settings/inbound-routing-section'
    );

    render(<InboundRoutingSection />);

    // Wait for template to load
    await waitFor(() => {
      expect(screen.getByText('My Template')).toBeInTheDocument();
    });

    // Click delete button (trash icon)
    const templateSection = screen.getByTestId('prompt-templates-section');
    const deleteButtons = templateSection.querySelectorAll('button');
    // The last button in each template row is the delete button
    const deleteBtn = Array.from(deleteButtons).pop();
    if (deleteBtn) fireEvent.click(deleteBtn);

    // Should show error
    await waitFor(() => {
      expect(screen.getByTestId('prompt-templates-error')).toBeInTheDocument();
    });

    expect(screen.getByText(/failed to delete/i)).toBeInTheDocument();
  });
});
