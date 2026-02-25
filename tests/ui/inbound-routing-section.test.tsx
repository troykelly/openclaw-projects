/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
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

describe('InboundRoutingSection — ChannelDefaultsSection', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.put).mockReset();
    vi.mocked(apiClient.post).mockReset();
    vi.mocked(apiClient.delete).mockReset();

    vi.mocked(apiClient.get).mockImplementation((path: string) => {
      if (path === '/api/channel-defaults') {
        return Promise.resolve(mockChannelDefaults);
      }
      if (path.startsWith('/api/inbound-destinations')) {
        return Promise.resolve({ items: [], total: 0 });
      }
      if (path.startsWith('/api/prompt-templates')) {
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

  it('renders agent combobox triggers instead of text inputs for each channel type', async () => {
    render(<InboundRoutingSection />);

    await waitFor(() => {
      expect(screen.getByTestId('channel-defaults-section')).toBeInTheDocument();
    });

    // Should have combobox triggers for each channel type (SMS, Email, HA Observations)
    const comboboxTriggers = screen.getAllByTestId(/^agent-combobox-trigger-/);
    expect(comboboxTriggers.length).toBe(3);
  });

  it('displays existing agent IDs in the combobox trigger', async () => {
    render(<InboundRoutingSection />);

    await waitFor(() => {
      expect(screen.getByTestId('channel-defaults-section')).toBeInTheDocument();
    });

    // The SMS channel should show its configured agent
    const smsTrigger = screen.getByTestId('agent-combobox-trigger-sms');
    expect(smsTrigger).toHaveTextContent('agent-sms-triage');
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
});
