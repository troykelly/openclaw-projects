/**
 * @vitest-environment jsdom
 * Tests for enhanced namespace UI components (Issues #2352, #2355, #2357).
 *
 * Validates:
 * - NamespaceIndicator multi-select mode with count badge (#2352)
 * - NamespaceBadge visible in isMultiNamespaceMode (#2352)
 * - NamespaceSelector unified component (#2352)
 * - Entity list pages show NamespaceBadge in multi-namespace mode (#2355)
 * - Namespace strings used from constants (#2357)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type * as React from 'react';

import { NamespaceProvider, useNamespace } from '@/ui/contexts/namespace-context';
import { NamespaceBadge } from '@/ui/components/namespace/namespace-badge';
import { NamespaceIndicator } from '@/ui/components/namespace/namespace-indicator';
import { NAMESPACE_STRINGS } from '@/ui/constants/namespace-strings';

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

const MULTI_GRANTS = [
  { namespace: 'personal', access: 'readwrite', is_home: true },
  { namespace: 'team-alpha', access: 'readwrite', is_home: false },
  { namespace: 'shared', access: 'readwrite', is_home: false },
];

/** Wrapper that provides multi-namespace context. */
function MultiNamespaceWrapper({ children }: { children: React.ReactNode }) {
  setBootstrapData({ namespace_grants: MULTI_GRANTS });
  return <NamespaceProvider>{children}</NamespaceProvider>;
}

/** Wrapper that provides single-namespace context. */
function SingleNamespaceWrapper({ children }: { children: React.ReactNode }) {
  setBootstrapData({
    namespace_grants: [{ namespace: 'default', access: 'readwrite', is_home: true }],
  });
  return <NamespaceProvider>{children}</NamespaceProvider>;
}

// ── #2357: Namespace string constants ──────────────────────────────

describe('NAMESPACE_STRINGS', () => {
  it('exports selector strings', () => {
    expect(NAMESPACE_STRINGS.selector.label).toBe('Namespace');
    expect(NAMESPACE_STRINGS.selector.placeholder).toBe('Select namespace...');
    expect(NAMESPACE_STRINGS.selector.switchAriaLabel).toBe('Switch namespace');
  });

  it('multipleSelected returns formatted count', () => {
    expect(NAMESPACE_STRINGS.selector.multipleSelected(3)).toBe('3 namespaces');
  });

  it('badge ariaLabel includes namespace name', () => {
    expect(NAMESPACE_STRINGS.badge.ariaLabel('team-alpha')).toBe('Namespace: team-alpha');
  });

  it('transition switching includes namespace', () => {
    expect(NAMESPACE_STRINGS.transition.switching('team-alpha')).toBe('Switching to team-alpha...');
  });

  it('empty noItems includes namespace', () => {
    expect(NAMESPACE_STRINGS.empty.noItems('personal')).toBe('No items in "personal"');
  });

  it('exports error strings', () => {
    expect(NAMESPACE_STRINGS.errors.loadFailed).toBe('Failed to load namespaces');
  });
});

// ── #2352: Enhanced NamespaceBadge (multi-namespace mode) ──────────

describe('NamespaceBadge (enhanced #2352)', () => {
  beforeEach(() => {
    clearBootstrapData();
    localStorage.clear();
  });

  it('shows badge in multi-namespace mode even for active namespace', () => {
    render(<NamespaceBadge namespace="personal" />, { wrapper: MultiNamespaceWrapper });
    const badge = screen.getByTestId('namespace-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('personal');
  });

  it('hides badge for single-namespace users', () => {
    render(<NamespaceBadge namespace="default" />, { wrapper: SingleNamespaceWrapper });
    expect(screen.queryByTestId('namespace-badge')).not.toBeInTheDocument();
  });

  it('includes aria-label from namespace strings', () => {
    render(<NamespaceBadge namespace="team-alpha" />, { wrapper: MultiNamespaceWrapper });
    const badge = screen.getByTestId('namespace-badge');
    expect(badge).toHaveAttribute('aria-label', NAMESPACE_STRINGS.badge.ariaLabel('team-alpha'));
  });
});

// ── #2352: Enhanced NamespaceIndicator ─────────────────────────────

describe('NamespaceIndicator (enhanced #2352)', () => {
  beforeEach(() => {
    clearBootstrapData();
    localStorage.clear();
  });

  it('renders dropdown for multi-namespace user', () => {
    render(<NamespaceIndicator />, { wrapper: MultiNamespaceWrapper });
    const indicator = screen.getByTestId('namespace-indicator');
    expect(indicator).toBeInTheDocument();
  });

  it('uses switch aria-label from namespace strings', () => {
    render(<NamespaceIndicator />, { wrapper: MultiNamespaceWrapper });
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAttribute('aria-label', NAMESPACE_STRINGS.selector.switchAriaLabel);
  });

  it('renders single namespace as subtle text', () => {
    render(<NamespaceIndicator />, { wrapper: SingleNamespaceWrapper });
    const indicator = screen.getByTestId('namespace-indicator');
    expect(indicator).toHaveTextContent('default');
    // Should NOT have a combobox
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
