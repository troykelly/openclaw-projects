/**
 * @vitest-environment jsdom
 *
 * Tests for the PromptPreview component.
 * Issue #2016: Frontend Dev Prompts Management Page.
 * Issue #2018: Frontend TDD Component Tests.
 */
import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PromptPreview } from '@/ui/components/dev-prompts/prompt-preview';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PromptPreview', () => {
  it('renders rendered output text', () => {
    render(
      <PromptPreview
        rendered="# Feature: New Feature Request\nDate: 2026-03-02"
        variablesUsed={['prompt_title', 'date']}
        isLoading={false}
      />,
    );

    expect(screen.getByTestId('prompt-preview-output')).toBeInTheDocument();
    expect(screen.getByText(/New Feature Request/)).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(
      <PromptPreview
        rendered=""
        variablesUsed={[]}
        isLoading={true}
      />,
    );

    expect(screen.getByText(/rendering/i)).toBeInTheDocument();
  });

  it('shows variables used', () => {
    render(
      <PromptPreview
        rendered="Output"
        variablesUsed={['prompt_title', 'date']}
        isLoading={false}
      />,
    );

    expect(screen.getByText('prompt_title')).toBeInTheDocument();
    expect(screen.getByText('date')).toBeInTheDocument();
  });

  it('shows error message when provided', () => {
    render(
      <PromptPreview
        rendered=""
        variablesUsed={[]}
        isLoading={false}
        error="Template syntax error"
      />,
    );

    expect(screen.getByText('Template syntax error')).toBeInTheDocument();
  });
});
