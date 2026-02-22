/**
 * @vitest-environment jsdom
 * Tests for namespace UI components (Issue #1482).
 *
 * Validates:
 * - NamespaceBadge renders for multi-namespace users and hides for single-namespace
 * - NamespaceIndicator shows dropdown for multi-namespace and label for single
 * - NamespacePicker shows/hides based on namespace grants
 * - NamespaceProvider reads bootstrap data and persists selection
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type * as React from 'react';

import { NamespaceProvider, useNamespace } from '@/ui/contexts/namespace-context';
import { NamespaceBadge } from '@/ui/components/namespace/namespace-badge';
import { NamespaceIndicator } from '@/ui/components/namespace/namespace-indicator';
import { NamespacePicker } from '@/ui/components/namespace/namespace-picker';

// ── helpers ──────────────────────────────────────────────────────────

/** Inject bootstrap JSON into the document for NamespaceProvider to read. */
function setBootstrapData(data: Record<string, unknown>): void {
  let el = document.getElementById('app-bootstrap');
  if (!el) {
    el = document.createElement('script');
    el.id = 'app-bootstrap';
    el.type = 'application/json';
    document.body.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

function clearBootstrapData(): void {
  const el = document.getElementById('app-bootstrap');
  if (el) el.remove();
}

/** Wrapper that provides multi-namespace context. */
function MultiNamespaceWrapper({ children }: { children: React.ReactNode }) {
  setBootstrapData({
    namespace_grants: [
      { namespace: 'personal', access: 'readwrite', is_home: true },
      { namespace: 'team-alpha', access: 'readwrite', is_home: false },
      { namespace: 'shared', access: 'readwrite', is_home: false },
    ],
  });
  return <NamespaceProvider>{children}</NamespaceProvider>;
}

/** Wrapper that provides single-namespace context. */
function SingleNamespaceWrapper({ children }: { children: React.ReactNode }) {
  setBootstrapData({
    namespace_grants: [{ namespace: 'default', access: 'readwrite', is_home: true }],
  });
  return <NamespaceProvider>{children}</NamespaceProvider>;
}

/** Wrapper with no grants. */
function NoGrantsWrapper({ children }: { children: React.ReactNode }) {
  setBootstrapData({ namespace_grants: [] });
  return <NamespaceProvider>{children}</NamespaceProvider>;
}

// ── NamespaceBadge ──────────────────────────────────────────────────

describe('NamespaceBadge', () => {
  beforeEach(() => {
    clearBootstrapData();
    localStorage.clear();
  });

  it('renders namespace badge for multi-namespace users', () => {
    render(<NamespaceBadge namespace="team-alpha" />, { wrapper: MultiNamespaceWrapper });
    const badge = screen.getByTestId('namespace-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('team-alpha');
  });

  it('hides badge for single-namespace users', () => {
    render(<NamespaceBadge namespace="default" />, { wrapper: SingleNamespaceWrapper });
    expect(screen.queryByTestId('namespace-badge')).not.toBeInTheDocument();
  });

  it('returns null when namespace prop is undefined', () => {
    render(<NamespaceBadge />, { wrapper: MultiNamespaceWrapper });
    expect(screen.queryByTestId('namespace-badge')).not.toBeInTheDocument();
  });

  it('renders with outline variant styling', () => {
    render(<NamespaceBadge namespace="personal" />, { wrapper: MultiNamespaceWrapper });
    const badge = screen.getByTestId('namespace-badge');
    expect(badge).toHaveAttribute('data-variant', 'outline');
  });

  it('renders without provider (returns null safely)', () => {
    // NamespaceBadge uses useNamespaceSafe which returns null outside provider
    const { container } = render(<NamespaceBadge namespace="test" />);
    expect(container.innerHTML).toBe('');
  });
});

// ── NamespaceIndicator ──────────────────────────────────────────────

describe('NamespaceIndicator', () => {
  beforeEach(() => {
    clearBootstrapData();
    localStorage.clear();
  });

  it('renders indicator for single-namespace user as plain text', () => {
    render(<NamespaceIndicator />, { wrapper: SingleNamespaceWrapper });
    const indicator = screen.getByTestId('namespace-indicator');
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveTextContent('default');
  });

  it('renders dropdown for multi-namespace user', () => {
    render(<NamespaceIndicator />, { wrapper: MultiNamespaceWrapper });
    const indicator = screen.getByTestId('namespace-indicator');
    expect(indicator).toBeInTheDocument();
    // Should have a button/trigger for the select
    const trigger = indicator.querySelector('[role="combobox"]');
    expect(trigger).toBeInTheDocument();
  });

  it('returns null when no grants exist', () => {
    render(<NamespaceIndicator />, { wrapper: NoGrantsWrapper });
    expect(screen.queryByTestId('namespace-indicator')).not.toBeInTheDocument();
  });

  it('returns null without provider', () => {
    const { container } = render(<NamespaceIndicator />);
    expect(container.innerHTML).toBe('');
  });
});

// ── NamespacePicker ─────────────────────────────────────────────────

describe('NamespacePicker', () => {
  beforeEach(() => {
    clearBootstrapData();
    localStorage.clear();
  });

  it('renders picker for multi-namespace users', () => {
    render(<NamespacePicker />, { wrapper: MultiNamespaceWrapper });
    const picker = screen.getByTestId('namespace-picker');
    expect(picker).toBeInTheDocument();
    expect(screen.getByLabelText('Select namespace')).toBeInTheDocument();
  });

  it('hides picker for single-namespace users', () => {
    render(<NamespacePicker />, { wrapper: SingleNamespaceWrapper });
    expect(screen.queryByTestId('namespace-picker')).not.toBeInTheDocument();
  });

  it('returns null without provider', () => {
    const { container } = render(<NamespacePicker />);
    expect(container.innerHTML).toBe('');
  });

  it('renders with custom label', () => {
    render(<NamespacePicker label="Target namespace" />, { wrapper: MultiNamespaceWrapper });
    expect(screen.getByText('Target namespace')).toBeInTheDocument();
  });
});

// ── NamespaceContext ────────────────────────────────────────────────

describe('NamespaceContext', () => {
  beforeEach(() => {
    clearBootstrapData();
    localStorage.clear();
  });

  function ContextConsumer() {
    const { grants, activeNamespace, hasMultipleNamespaces } = useNamespace();
    return (
      <div>
        <span data-testid="active-ns">{activeNamespace}</span>
        <span data-testid="grant-count">{grants.length}</span>
        <span data-testid="has-multi">{String(hasMultipleNamespaces)}</span>
      </div>
    );
  }

  it('reads namespace grants from bootstrap data', () => {
    render(<ContextConsumer />, { wrapper: MultiNamespaceWrapper });
    expect(screen.getByTestId('grant-count')).toHaveTextContent('3');
  });

  it('selects default namespace as active initially', () => {
    render(<ContextConsumer />, { wrapper: MultiNamespaceWrapper });
    expect(screen.getByTestId('active-ns')).toHaveTextContent('personal');
  });

  it('reports hasMultipleNamespaces correctly for multi', () => {
    render(<ContextConsumer />, { wrapper: MultiNamespaceWrapper });
    expect(screen.getByTestId('has-multi')).toHaveTextContent('true');
  });

  it('reports hasMultipleNamespaces correctly for single', () => {
    render(<ContextConsumer />, { wrapper: SingleNamespaceWrapper });
    expect(screen.getByTestId('has-multi')).toHaveTextContent('false');
  });

  it('falls back to "default" when no grants exist', () => {
    render(<ContextConsumer />, { wrapper: NoGrantsWrapper });
    expect(screen.getByTestId('active-ns')).toHaveTextContent('default');
  });

  it('restores active namespace from localStorage', () => {
    localStorage.setItem('openclaw-active-namespace', 'team-alpha');
    render(<ContextConsumer />, { wrapper: MultiNamespaceWrapper });
    expect(screen.getByTestId('active-ns')).toHaveTextContent('team-alpha');
  });

  it('ignores localStorage value that is not in grants', () => {
    localStorage.setItem('openclaw-active-namespace', 'nonexistent');
    render(<ContextConsumer />, { wrapper: MultiNamespaceWrapper });
    // Should fall back to the default grant
    expect(screen.getByTestId('active-ns')).toHaveTextContent('personal');
  });
});
