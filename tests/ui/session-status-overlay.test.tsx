/**
 * @vitest-environment jsdom
 *
 * Tests for the SessionStatusOverlay component.
 * Issue #2127: Session recovery state exposed to frontend.
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionStatusOverlay } from '@/ui/components/terminal/session-status-overlay';

describe('SessionStatusOverlay', () => {
  it('returns null when status is connected', () => {
    const { container } = render(<SessionStatusOverlay status="connected" />);
    expect(container.firstChild).toBeNull();
  });

  it('shows connecting state', () => {
    render(<SessionStatusOverlay status="connecting" />);
    expect(screen.getByText(/connecting to session/i)).toBeInTheDocument();
  });

  it('shows disconnected state', () => {
    render(<SessionStatusOverlay status="disconnected" />);
    expect(screen.getByText(/disconnected/i)).toBeInTheDocument();
  });

  it('shows terminated state', () => {
    render(<SessionStatusOverlay status="terminated" />);
    expect(screen.getByText(/session terminated/i)).toBeInTheDocument();
  });

  it('shows error state with close reason', () => {
    render(<SessionStatusOverlay status="error" closeReason="Auth failed" />);
    expect(screen.getByText('Auth failed')).toBeInTheDocument();
  });

  // #2127 — Recovery state
  it('shows recovery state when status is recovering', () => {
    render(<SessionStatusOverlay status="recovering" />);
    expect(screen.getByText(/reconnected to existing session/i)).toBeInTheDocument();
  });

  it('recovery state includes informative message', () => {
    render(<SessionStatusOverlay status="recovering" />);
    expect(screen.getByText(/session was recovered/i)).toBeInTheDocument();
  });
});
