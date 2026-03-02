/**
 * @vitest-environment jsdom
 *
 * Tests for the VariableReference component.
 * Issue #2016: Frontend Dev Prompts Management Page.
 * Issue #2018: Frontend TDD Component Tests.
 */
import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VariableReference } from '@/ui/components/dev-prompts/variable-reference';
import type { DevPromptVariableDefinition } from '@/ui/lib/api-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const variables: DevPromptVariableDefinition[] = [
  { name: 'month_year', description: 'Current month and year', example: 'March 2026' },
  { name: 'date', description: 'Current ISO date', example: '2026-03-02' },
  { name: 'namespace', description: 'Current namespace', example: 'troy' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VariableReference', () => {
  it('renders the header', () => {
    render(<VariableReference variables={variables} />);

    expect(screen.getByText(/template variables/i)).toBeInTheDocument();
  });

  it('displays variable names', () => {
    render(<VariableReference variables={variables} />);

    expect(screen.getByText('month_year')).toBeInTheDocument();
    expect(screen.getByText('date')).toBeInTheDocument();
    expect(screen.getByText('namespace')).toBeInTheDocument();
  });

  it('displays variable descriptions', () => {
    render(<VariableReference variables={variables} />);

    expect(screen.getByText('Current month and year')).toBeInTheDocument();
    expect(screen.getByText('Current ISO date')).toBeInTheDocument();
  });

  it('displays example values', () => {
    render(<VariableReference variables={variables} />);

    expect(screen.getByText('March 2026')).toBeInTheDocument();
    expect(screen.getByText('2026-03-02')).toBeInTheDocument();
  });

  it('is collapsible', () => {
    render(<VariableReference variables={variables} defaultCollapsed />);

    // Initially collapsed — variables should not be visible
    expect(screen.queryByText('month_year')).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(screen.getByTestId('variable-reference-toggle'));

    expect(screen.getByText('month_year')).toBeInTheDocument();
  });

  it('shows empty state when no variables provided', () => {
    render(<VariableReference variables={[]} />);

    expect(screen.getByText(/no variables/i)).toBeInTheDocument();
  });
});
