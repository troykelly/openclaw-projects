/**
 * @vitest-environment jsdom
 */
/**
 * Tests for ChatConnectionBanner component (Epic #2153, Issue #2159).
 *
 * Verifies: gateway degraded state, hiding on connected, and existing behavior.
 */
import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ChatConnectionBanner } from '@/ui/components/chat/chat-connection-banner';

describe('ChatConnectionBanner', () => {
  it('does not render when status is connected and gateway is connected', () => {
    const { container } = render(
      <ChatConnectionBanner status="connected" gatewayConnected={true} />,
    );
    expect(container.querySelector('[data-testid="connection-banner"]')).toBeNull();
  });

  it('does not render when status is connected and gatewayConnected is undefined', () => {
    const { container } = render(
      <ChatConnectionBanner status="connected" />,
    );
    expect(container.querySelector('[data-testid="connection-banner"]')).toBeNull();
  });

  it('renders degraded banner when gatewayConnected=false and browser WS is connected', () => {
    render(
      <ChatConnectionBanner status="connected" gatewayConnected={false} />,
    );
    const banner = screen.getByTestId('connection-banner');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent(/degraded/i);
  });

  it('renders disconnected state when browser WS is disconnected regardless of gateway', () => {
    render(
      <ChatConnectionBanner status="disconnected" gatewayConnected={true} />,
    );
    const banner = screen.getByTestId('connection-banner');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent('Disconnected');
  });

  it('renders connecting state normally', () => {
    render(
      <ChatConnectionBanner status="connecting" />,
    );
    expect(screen.getByTestId('connection-banner')).toHaveTextContent('Connecting...');
  });

  it('renders reconnecting state normally', () => {
    render(
      <ChatConnectionBanner status="reconnecting" />,
    );
    expect(screen.getByTestId('connection-banner')).toHaveTextContent('Reconnecting...');
  });
});
