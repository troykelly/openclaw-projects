/**
 * @vitest-environment jsdom
 */
/**
 * Tests for AgentStatusBadge component (Epic #2153, Issue #2160).
 *
 * Verifies: color variants, accessibility attributes, sr-only label,
 * null render for unknown, and no animation.
 */
import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { AgentStatusBadge } from '@/ui/components/chat/agent-status-badge';

describe('AgentStatusBadge', () => {
  it('renders green element for status "online"', () => {
    const { container } = render(<AgentStatusBadge status="online" />);
    const dot = container.querySelector('[data-testid="agent-status-dot"]');
    expect(dot).toBeInTheDocument();
    expect(dot?.className).toMatch(/bg-green/);
  });

  it('renders amber element for status "busy"', () => {
    const { container } = render(<AgentStatusBadge status="busy" />);
    const dot = container.querySelector('[data-testid="agent-status-dot"]');
    expect(dot).toBeInTheDocument();
    expect(dot?.className).toMatch(/bg-amber/);
  });

  it('renders gray element for status "offline"', () => {
    const { container } = render(<AgentStatusBadge status="offline" />);
    const dot = container.querySelector('[data-testid="agent-status-dot"]');
    expect(dot).toBeInTheDocument();
    expect(dot?.className).toMatch(/bg-gray/);
  });

  it('renders nothing for status "unknown"', () => {
    const { container } = render(<AgentStatusBadge status="unknown" />);
    expect(container.innerHTML).toBe('');
  });

  it('has role="status" on container', () => {
    render(<AgentStatusBadge status="online" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has aria-label="Agent status: online" for online status', () => {
    render(<AgentStatusBadge status="online" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Agent status: online');
  });

  it('has aria-label with correct status for busy', () => {
    render(<AgentStatusBadge status="busy" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Agent status: busy');
  });

  it('has title attribute with status text', () => {
    const { container } = render(<AgentStatusBadge status="online" />);
    const dot = container.querySelector('[data-testid="agent-status-dot"]');
    expect(dot).toHaveAttribute('title', 'Online');
  });

  it('has sr-only text label (not hidden from screen readers)', () => {
    const { container } = render(<AgentStatusBadge status="online" />);
    const srOnly = container.querySelector('.sr-only');
    expect(srOnly).toBeInTheDocument();
    expect(srOnly?.textContent).toBe('Online');
  });

  it('does not render animations', () => {
    const { container } = render(<AgentStatusBadge status="online" />);
    const dot = container.querySelector('[data-testid="agent-status-dot"]');
    expect(dot?.className).not.toMatch(/animate/);
  });
});
