/**
 * Tests for issue #2382: catch blocks must log errors via console.error,
 * and Array.isArray guards must warn via console.warn when shape is unexpected.
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

const emptyAgentsResponse = { agents: [] };

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Helper: default mock that succeeds for all endpoints
// ---------------------------------------------------------------------------

function setupSuccessfulMocks() {
  mockedApiClient.get.mockImplementation((path: string) => {
    if (path === '/channel-defaults') return Promise.resolve([]);
    if (path === '/chat/agents') return Promise.resolve(emptyAgentsResponse);
    if (path.startsWith('/inbound-destinations')) return Promise.resolve({ items: [], total: 0 });
    if (path.startsWith('/prompt-templates')) return Promise.resolve({ items: [], total: 0 });
    return Promise.reject(new Error('Not found'));
  });
}

// ---------------------------------------------------------------------------
// ChannelDefaultsSection — console.error on catch
// ---------------------------------------------------------------------------

describe('ChannelDefaultsSection error logging (#2382)', () => {
  it('logs error via console.error when fetchDefaults fails', async () => {
    const fetchError = new Error('Network error');
    mockedApiClient.get.mockImplementation((path: string) => {
      if (path === '/channel-defaults') return Promise.reject(fetchError);
      if (path === '/chat/agents') return Promise.resolve(emptyAgentsResponse);
      if (path.startsWith('/inbound-destinations')) return Promise.resolve({ items: [], total: 0 });
      if (path.startsWith('/prompt-templates')) return Promise.resolve({ items: [], total: 0 });
      return Promise.reject(new Error('Not found'));
    });

    const { InboundRoutingSection } = await import(
      '@/ui/components/settings/inbound-routing-section'
    );
    render(<InboundRoutingSection />);

    await waitFor(() => {
      expect(screen.getByTestId('channel-defaults-error')).toBeInTheDocument();
    });

    // Must have logged the error with context
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('channel defaults'),
      fetchError,
    );
  });

  it('logs error via console.error when handleSave (channel default) fails', async () => {
    const saveError = new Error('Server error');
    mockedApiClient.get.mockImplementation((path: string) => {
      if (path === '/channel-defaults') {
        return Promise.resolve([
          { id: '1', channel_type: 'sms', agent_id: 'agent-1', prompt_template_id: null, context_id: null },
        ]);
      }
      if (path === '/chat/agents') return Promise.resolve(emptyAgentsResponse);
      if (path.startsWith('/inbound-destinations')) return Promise.resolve({ items: [], total: 0 });
      if (path.startsWith('/prompt-templates')) return Promise.resolve({ items: [], total: 0 });
      return Promise.reject(new Error('Not found'));
    });
    mockedApiClient.put.mockRejectedValue(saveError);

    const { InboundRoutingSection } = await import(
      '@/ui/components/settings/inbound-routing-section'
    );
    render(<InboundRoutingSection />);

    await waitFor(() => {
      expect(screen.getByTestId('channel-defaults-section')).toBeInTheDocument();
    });

    // Open combobox, type custom agent, select it
    fireEvent.click(screen.getByTestId('agent-combobox-trigger-sms'));
    await waitFor(() => {
      expect(screen.getByTestId('agent-combobox-input-sms')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('agent-combobox-input-sms'), {
      target: { value: 'agent-updated' },
    });
    await waitFor(() => {
      expect(screen.getByText(/Use/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/Use/));

    // Click Save
    fireEvent.click(screen.getAllByText('Save')[0]);

    await waitFor(() => {
      expect(screen.getByTestId('channel-defaults-error')).toBeInTheDocument();
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('channel default'),
      saveError,
    );
  });
});

// ---------------------------------------------------------------------------
// InboundDestinationsSection — console.error on catch
// ---------------------------------------------------------------------------

describe('InboundDestinationsSection error logging (#2382)', () => {
  it('logs error via console.error when fetchDestinations fails', async () => {
    const fetchError = new Error('Network error');
    mockedApiClient.get.mockImplementation((path: string) => {
      if (path === '/channel-defaults') return Promise.resolve([]);
      if (path === '/chat/agents') return Promise.resolve(emptyAgentsResponse);
      if (path.startsWith('/inbound-destinations')) return Promise.reject(fetchError);
      if (path.startsWith('/prompt-templates')) return Promise.resolve({ items: [], total: 0 });
      return Promise.reject(new Error('Not found'));
    });

    const { InboundRoutingSection } = await import(
      '@/ui/components/settings/inbound-routing-section'
    );
    render(<InboundRoutingSection />);

    await waitFor(() => {
      expect(screen.getByTestId('inbound-destinations-error')).toBeInTheDocument();
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('inbound destinations'),
      fetchError,
    );
  });

  it('logs error via console.error when handleSave (destination) fails', async () => {
    const saveError = new Error('Save failed');
    mockedApiClient.get.mockImplementation((path: string) => {
      if (path === '/channel-defaults') return Promise.resolve([]);
      if (path === '/chat/agents') return Promise.resolve(emptyAgentsResponse);
      if (path.startsWith('/inbound-destinations')) {
        return Promise.resolve({
          items: [
            { id: 'd1', address: '+1234567890', channel_type: 'sms', display_name: null, agent_id: null, prompt_template_id: null, context_id: null, is_active: true },
          ],
          total: 1,
        });
      }
      if (path.startsWith('/prompt-templates')) return Promise.resolve({ items: [], total: 0 });
      return Promise.reject(new Error('Not found'));
    });
    mockedApiClient.put.mockRejectedValue(saveError);

    const { InboundRoutingSection } = await import(
      '@/ui/components/settings/inbound-routing-section'
    );
    render(<InboundRoutingSection />);

    await waitFor(() => {
      expect(screen.getByText('+1234567890')).toBeInTheDocument();
    });

    // Click edit
    const destSection = screen.getByTestId('inbound-destinations-section');
    const destRow = destSection.querySelector('.space-y-2 > div');
    const editBtn = destRow!.querySelector('button');
    fireEvent.click(editBtn!);

    await waitFor(() => {
      expect(screen.getByTestId('agent-combobox-trigger-destination-d1')).toBeInTheDocument();
    });

    // Open combobox and type agent
    fireEvent.click(screen.getByTestId('agent-combobox-trigger-destination-d1'));
    await waitFor(() => {
      expect(screen.getByTestId('agent-combobox-input-destination-d1')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('agent-combobox-input-destination-d1'), {
      target: { value: 'my-agent' },
    });
    await waitFor(() => {
      expect(screen.getByText(/Use/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/Use/));

    // Click Save
    const saveBtn = within(destSection).getByText('Save');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByTestId('inbound-destinations-error')).toBeInTheDocument();
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('destination'),
      saveError,
    );
  });
});

// ---------------------------------------------------------------------------
// PromptTemplatesSection — console.error on catch
// ---------------------------------------------------------------------------

describe('PromptTemplatesSection error logging (#2382)', () => {
  it('logs error via console.error when fetchTemplates fails', async () => {
    const fetchError = new Error('Network error');
    mockedApiClient.get.mockImplementation((path: string) => {
      if (path === '/channel-defaults') return Promise.resolve([]);
      if (path === '/chat/agents') return Promise.resolve(emptyAgentsResponse);
      if (path.startsWith('/inbound-destinations')) return Promise.resolve({ items: [], total: 0 });
      if (path.startsWith('/prompt-templates')) return Promise.reject(fetchError);
      return Promise.reject(new Error('Not found'));
    });

    const { InboundRoutingSection } = await import(
      '@/ui/components/settings/inbound-routing-section'
    );
    render(<InboundRoutingSection />);

    await waitFor(() => {
      expect(screen.getByTestId('prompt-templates-error')).toBeInTheDocument();
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('prompt templates'),
      fetchError,
    );
  });

  it('logs error via console.error when handleSave (template) fails', async () => {
    const saveError = new Error('Create failed');
    setupSuccessfulMocks();
    mockedApiClient.post.mockRejectedValue(saveError);

    const { InboundRoutingSection } = await import(
      '@/ui/components/settings/inbound-routing-section'
    );
    render(<InboundRoutingSection />);

    await waitFor(() => {
      expect(screen.getByTestId('prompt-templates-section')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/new template/i));

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. SMS Triage/i), {
      target: { value: 'Test Template' },
    });
    fireEvent.change(screen.getByPlaceholderText(/you are an SMS/i), {
      target: { value: 'Some prompt content' },
    });

    fireEvent.click(screen.getByText('Create'));

    await waitFor(() => {
      expect(screen.getByTestId('prompt-templates-error')).toBeInTheDocument();
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('prompt template'),
      saveError,
    );
  });

  it('logs error via console.error when handleDelete fails', async () => {
    const deleteError = new Error('Delete failed');
    mockedApiClient.get.mockImplementation((path: string) => {
      if (path === '/channel-defaults') return Promise.resolve([]);
      if (path === '/chat/agents') return Promise.resolve(emptyAgentsResponse);
      if (path.startsWith('/inbound-destinations')) return Promise.resolve({ items: [], total: 0 });
      if (path.startsWith('/prompt-templates')) {
        return Promise.resolve({
          items: [
            { id: 'pt1', label: 'My Template', content: 'Prompt here', channel_type: 'sms', is_default: false, is_active: true },
          ],
          total: 1,
        });
      }
      return Promise.reject(new Error('Not found'));
    });
    mockedApiClient.delete.mockRejectedValue(deleteError);

    const { InboundRoutingSection } = await import(
      '@/ui/components/settings/inbound-routing-section'
    );
    render(<InboundRoutingSection />);

    await waitFor(() => {
      expect(screen.getByText('My Template')).toBeInTheDocument();
    });

    const templateSection = screen.getByTestId('prompt-templates-section');
    const deleteButtons = templateSection.querySelectorAll('button');
    const deleteBtn = Array.from(deleteButtons).pop();
    if (deleteBtn) fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(screen.getByTestId('prompt-templates-error')).toBeInTheDocument();
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('prompt template'),
      deleteError,
    );
  });
});

// ---------------------------------------------------------------------------
// Array.isArray guards — console.warn on unexpected shape
// ---------------------------------------------------------------------------

describe('Array.isArray guards warn on unexpected shape (#2382)', () => {
  it('warns when /channel-defaults returns non-array', async () => {
    mockedApiClient.get.mockImplementation((path: string) => {
      if (path === '/channel-defaults') return Promise.resolve({ unexpected: 'shape' });
      if (path === '/chat/agents') return Promise.resolve(emptyAgentsResponse);
      if (path.startsWith('/inbound-destinations')) return Promise.resolve({ items: [], total: 0 });
      if (path.startsWith('/prompt-templates')) return Promise.resolve({ items: [], total: 0 });
      return Promise.reject(new Error('Not found'));
    });

    const { InboundRoutingSection } = await import(
      '@/ui/components/settings/inbound-routing-section'
    );
    render(<InboundRoutingSection />);

    await waitFor(() => {
      expect(screen.getByTestId('channel-defaults-section')).toBeInTheDocument();
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('channel defaults'),
      expect.stringContaining('object'),
    );
  });

  it('warns when /inbound-destinations items is non-array', async () => {
    mockedApiClient.get.mockImplementation((path: string) => {
      if (path === '/channel-defaults') return Promise.resolve([]);
      if (path === '/chat/agents') return Promise.resolve(emptyAgentsResponse);
      if (path.startsWith('/inbound-destinations')) {
        return Promise.resolve({ items: 'not-an-array', total: 0 });
      }
      if (path.startsWith('/prompt-templates')) return Promise.resolve({ items: [], total: 0 });
      return Promise.reject(new Error('Not found'));
    });

    const { InboundRoutingSection } = await import(
      '@/ui/components/settings/inbound-routing-section'
    );
    render(<InboundRoutingSection />);

    await waitFor(() => {
      expect(screen.getByTestId('inbound-destinations-section')).toBeInTheDocument();
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('inbound destinations'),
      expect.stringContaining('string'),
    );
  });

  it('warns when /prompt-templates items is non-array', async () => {
    mockedApiClient.get.mockImplementation((path: string) => {
      if (path === '/channel-defaults') return Promise.resolve([]);
      if (path === '/chat/agents') return Promise.resolve(emptyAgentsResponse);
      if (path.startsWith('/inbound-destinations')) return Promise.resolve({ items: [], total: 0 });
      if (path.startsWith('/prompt-templates')) {
        return Promise.resolve({ items: null, total: 0 });
      }
      return Promise.reject(new Error('Not found'));
    });

    const { InboundRoutingSection } = await import(
      '@/ui/components/settings/inbound-routing-section'
    );
    render(<InboundRoutingSection />);

    await waitFor(() => {
      expect(screen.getByTestId('prompt-templates-section')).toBeInTheDocument();
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('prompt templates'),
      expect.stringContaining('object'),
    );
  });
});
