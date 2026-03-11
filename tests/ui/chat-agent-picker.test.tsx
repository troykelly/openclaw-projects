/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';

const AGENTS = [
  { id: 'troy', name: 'Troy', display_name: 'Troy Agent', avatar_url: null, is_default: false, status: 'online' as const },
  { id: 'arthouse', name: 'arthouse', display_name: 'Arthouse', avatar_url: null, is_default: true, status: 'online' as const },
];

describe('AgentPickerPopover', () => {
  let AgentPickerPopover: typeof import('@/ui/components/chat/agent-picker-popover').AgentPickerPopover;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('@/ui/components/chat/agent-picker-popover');
    AgentPickerPopover = mod.AgentPickerPopover;
  });

  it('renders trigger button', () => {
    const onSelect = vi.fn();
    render(
      <AgentPickerPopover
        agents={AGENTS}
        defaultAgentId="troy"
        onSelect={onSelect}
        trigger={<button type="button">New Conversation</button>}
      />,
    );
    expect(screen.getByText('New Conversation')).toBeInTheDocument();
  });

  it('calls onSelect directly with single agent (no popover)', () => {
    const onSelect = vi.fn();
    const singleAgent = [AGENTS[0]];
    render(
      <AgentPickerPopover
        agents={singleAgent}
        defaultAgentId="troy"
        onSelect={onSelect}
        trigger={<button type="button">New</button>}
      />,
    );
    fireEvent.click(screen.getByText('New'));
    expect(onSelect).toHaveBeenCalledWith('troy');
  });

  it('does not call onSelect when disabled', () => {
    const onSelect = vi.fn();
    render(
      <AgentPickerPopover
        agents={AGENTS}
        defaultAgentId="troy"
        onSelect={onSelect}
        trigger={<button type="button">New</button>}
        disabled
      />,
    );
    fireEvent.click(screen.getByText('New'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders trigger even with empty agents', () => {
    const onSelect = vi.fn();
    render(
      <AgentPickerPopover
        agents={[]}
        defaultAgentId={null}
        onSelect={onSelect}
        trigger={<button type="button">New</button>}
      />,
    );
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('uses agent id when no defaultAgentId for single agent', () => {
    const onSelect = vi.fn();
    const singleAgent = [AGENTS[0]];
    render(
      <AgentPickerPopover
        agents={singleAgent}
        defaultAgentId={null}
        onSelect={onSelect}
        trigger={<button type="button">New</button>}
      />,
    );
    fireEvent.click(screen.getByText('New'));
    expect(onSelect).toHaveBeenCalledWith('troy');
  });
});
