/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { InboundRoutingSection } from '@/ui/components/settings/inbound-routing-section';

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

import { apiClient } from '@/ui/lib/api-client';

const mockChannelDefaults = [
  { id: '1', channel_type: 'sms', agent_id: 'agent-sms-triage', prompt_template_id: null, context_id: null },
  { id: '2', channel_type: 'email', agent_id: 'agent-email-handler', prompt_template_id: null, context_id: null },
];

const mockAgents = {
  agents: [
    { id: 'agent-sms-triage', name: 'sms-triage', display_name: 'SMS Triage Agent', avatar_url: null },
    { id: 'agent-email-handler', name: 'email-handler', display_name: 'Email Handler', avatar_url: null },
    { id: 'agent-general', name: 'general', display_name: 'General Agent', avatar_url: null },
  ],
};

describe('InboundRoutingSection — ChannelDefaultsSection', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.put).mockReset();
    vi.mocked(apiClient.post).mockReset();
    vi.mocked(apiClient.delete).mockReset();

    vi.mocked(apiClient.get).mockImplementation((path: string) => {
      if (path === '/channel-defaults') {
        return Promise.resolve(mockChannelDefaults);
      }
      if (path === '/chat/agents') {
        return Promise.resolve(mockAgents);
      }
      if (path.startsWith('/inbound-destinations')) {
        return Promise.resolve({ items: [], total: 0 });
      }
      if (path.startsWith('/prompt-templates')) {
        return Promise.resolve({ items: [], total: 0 });
      }
      return Promise.reject(new Error('Not found'));
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the Channel Defaults section', async () => {
    render(<InboundRoutingSection />);

    await waitFor(() => {
      expect(screen.getByTestId('channel-defaults-section')).toBeInTheDocument();
    });
  });

  it('fetches agents from /chat/agents on mount', async () => {
    render(<InboundRoutingSection />);

    await waitFor(() => {
      expect(screen.getByTestId('channel-defaults-section')).toBeInTheDocument();
    });

    expect(vi.mocked(apiClient.get)).toHaveBeenCalledWith('/chat/agents');
  });

  it('renders agent combobox triggers instead of text inputs for each channel type', async () => {
    render(<InboundRoutingSection />);

    await waitFor(() => {
      expect(screen.getByTestId('channel-defaults-section')).toBeInTheDocument();
    });

    // Should have combobox triggers for each channel type (SMS, Email, HA Observations)
    const comboboxTriggers = screen.getAllByTestId(/^agent-combobox-trigger-/);
    expect(comboboxTriggers.length).toBe(3);
  });

  it('displays agent display names (not raw IDs) in the combobox trigger', async () => {
    render(<InboundRoutingSection />);

    await waitFor(() => {
      expect(screen.getByTestId('channel-defaults-section')).toBeInTheDocument();
    });

    // The SMS channel should show the agent display name, not the raw ID
    const smsTrigger = screen.getByTestId('agent-combobox-trigger-sms');
    expect(smsTrigger).toHaveTextContent('SMS Triage Agent');
  });

  it('shows placeholder text for unconfigured channels', async () => {
    render(<InboundRoutingSection />);

    await waitFor(() => {
      expect(screen.getByTestId('channel-defaults-section')).toBeInTheDocument();
    });

    // HA Observations channel is not configured
    const haTrigger = screen.getByTestId('agent-combobox-trigger-ha_observation');
    expect(haTrigger).toHaveTextContent(/select agent/i);
  });

  it('allows typing a custom agent ID in the combobox input', async () => {
    render(<InboundRoutingSection />);

    await waitFor(() => {
      expect(screen.getByTestId('channel-defaults-section')).toBeInTheDocument();
    });

    // Open the HA combobox
    const haTrigger = screen.getByTestId('agent-combobox-trigger-ha_observation');
    fireEvent.click(haTrigger);

    // Should show the combobox input
    await waitFor(() => {
      const input = screen.getByTestId('agent-combobox-input-ha_observation');
      expect(input).toBeInTheDocument();
    });
  });

  it('shows agent display names in the combobox dropdown', async () => {
    render(<InboundRoutingSection />);

    await waitFor(() => {
      expect(screen.getByTestId('channel-defaults-section')).toBeInTheDocument();
    });

    // Open the HA combobox (unconfigured channel, so it will show all agents)
    const haTrigger = screen.getByTestId('agent-combobox-trigger-ha_observation');
    fireEvent.click(haTrigger);

    await waitFor(() => {
      expect(screen.getByTestId('agent-combobox-input-ha_observation')).toBeInTheDocument();
    });

    // Agent display names should appear in the dropdown.
    // Some names also appear in their channel's trigger button, so use getAllByText.
    expect(screen.getAllByText('SMS Triage Agent').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Email Handler').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('General Agent').length).toBeGreaterThanOrEqual(1);
  });
});

describe('InboundRoutingSection — InboundDestinationsSection', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.put).mockReset();
    vi.mocked(apiClient.post).mockReset();
    vi.mocked(apiClient.delete).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('fetches agents from /chat/agents on mount', async () => {
    vi.mocked(apiClient.get).mockImplementation((path: string) => {
      if (path === '/channel-defaults') {
        return Promise.resolve([]);
      }
      if (path === '/chat/agents') {
        return Promise.resolve(mockAgents);
      }
      if (path.startsWith('/inbound-destinations')) {
        return Promise.resolve({ items: [], total: 0 });
      }
      if (path.startsWith('/prompt-templates')) {
        return Promise.resolve({ items: [], total: 0 });
      }
      return Promise.reject(new Error('Not found'));
    });

    render(<InboundRoutingSection />);

    await waitFor(() => {
      expect(screen.getByTestId('inbound-destinations-section')).toBeInTheDocument();
    });

    // Both ChannelDefaultsSection and InboundDestinationsSection fetch /chat/agents
    const agentCalls = vi.mocked(apiClient.get).mock.calls.filter(
      ([p]) => p === '/chat/agents',
    );
    expect(agentCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('shows agent display name instead of raw ID for destination overrides', async () => {
    vi.mocked(apiClient.get).mockImplementation((path: string) => {
      if (path === '/channel-defaults') {
        return Promise.resolve([]);
      }
      if (path === '/chat/agents') {
        return Promise.resolve(mockAgents);
      }
      if (path.startsWith('/inbound-destinations')) {
        return Promise.resolve({
          items: [
            { id: 'd1', address: '+1234567890', channel_type: 'sms', display_name: null, agent_id: 'agent-sms-triage', prompt_template_id: null, context_id: null, is_active: true },
          ],
          total: 1,
        });
      }
      if (path.startsWith('/prompt-templates')) {
        return Promise.resolve({ items: [], total: 0 });
      }
      return Promise.reject(new Error('Not found'));
    });

    render(<InboundRoutingSection />);

    await waitFor(() => {
      expect(screen.getByTestId('inbound-destinations-section')).toBeInTheDocument();
    });

    // The destination list should display "SMS Triage Agent" (display_name), not "agent-sms-triage"
    const destSection = screen.getByTestId('inbound-destinations-section');
    expect(within(destSection).getByText(/SMS Triage Agent/)).toBeInTheDocument();
    expect(within(destSection).queryByText('agent-sms-triage')).not.toBeInTheDocument();
  });

  it('uses agent combobox for editing destination agent override', async () => {
    vi.mocked(apiClient.get).mockImplementation((path: string) => {
      if (path === '/channel-defaults') {
        return Promise.resolve([]);
      }
      if (path === '/chat/agents') {
        return Promise.resolve(mockAgents);
      }
      if (path.startsWith('/inbound-destinations')) {
        return Promise.resolve({
          items: [
            { id: 'd1', address: '+1234567890', channel_type: 'sms', display_name: null, agent_id: null, prompt_template_id: null, context_id: null, is_active: true },
          ],
          total: 1,
        });
      }
      if (path.startsWith('/prompt-templates')) {
        return Promise.resolve({ items: [], total: 0 });
      }
      return Promise.reject(new Error('Not found'));
    });

    render(<InboundRoutingSection />);

    // Wait for destinations to load
    await waitFor(() => {
      expect(screen.getByText('+1234567890')).toBeInTheDocument();
    });

    // Click the edit button for the destination
    const destSection = screen.getByTestId('inbound-destinations-section');
    const destRow = destSection.querySelector('.space-y-2 > div');
    expect(destRow).toBeTruthy();
    const editBtn = destRow!.querySelector('button');
    expect(editBtn).toBeTruthy();
    fireEvent.click(editBtn!);

    // Should show an agent combobox trigger instead of a plain text input
    await waitFor(() => {
      expect(screen.getByTestId('agent-combobox-trigger-destination-d1')).toBeInTheDocument();
    });
  });
});
