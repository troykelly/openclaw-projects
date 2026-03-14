/**
 * @vitest-environment jsdom
 */
/**
 * Tests for TimezoneMismatchBanner component (Epic #2509, Issue #2512).
 *
 * Verifies: conditional rendering, correct copy, button interactions,
 * loading/error states, accessibility attributes, dismiss behaviour.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimezoneMismatchBanner } from '@/ui/components/timezone/TimezoneMismatchBanner';

describe('TimezoneMismatchBanner', () => {
  const defaultProps = {
    browserTimezone: 'Europe/London',
    storedTimezone: 'America/New_York',
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDismiss: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    defaultProps.onUpdate = vi.fn().mockResolvedValue(undefined);
    defaultProps.onDismiss = vi.fn();
  });

  it('renders banner with correct copy', () => {
    render(<TimezoneMismatchBanner {...defaultProps} />);

    expect(screen.getByText('Your device timezone has changed')).toBeInTheDocument();
    expect(screen.getByText(/Your account is set to America \/ New York/)).toBeInTheDocument();
    expect(screen.getByText(/your device reports Europe \/ London/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Update to Europe \/ London/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Keep America \/ New York/i })).toBeInTheDocument();
  });

  it('has implicit role="status" via <output> and aria-live="polite"', () => {
    render(<TimezoneMismatchBanner {...defaultProps} />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveAttribute('aria-live', 'polite');
    expect(banner.tagName).toBe('OUTPUT');
  });

  it('does not auto-focus on mount', () => {
    render(<TimezoneMismatchBanner {...defaultProps} />);

    // Focus should not be inside the banner
    const banner = screen.getByRole('status');
    expect(banner.contains(document.activeElement)).toBe(false);
  });

  it('disables buttons and shows spinner when Update is clicked', async () => {
    // Make onUpdate hang
    defaultProps.onUpdate = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<TimezoneMismatchBanner {...defaultProps} />);

    const updateBtn = screen.getByRole('button', { name: /Update to/i });
    fireEvent.click(updateBtn);

    await waitFor(() => {
      expect(updateBtn).toBeDisabled();
      expect(screen.getByRole('button', { name: /Keep/i })).toBeDisabled();
    });
  });

  it('calls onUpdate when Update button is clicked', async () => {
    render(<TimezoneMismatchBanner {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /Update to/i }));

    expect(defaultProps.onUpdate).toHaveBeenCalledTimes(1);
  });

  it('shows error message when onUpdate rejects', async () => {
    defaultProps.onUpdate = vi.fn().mockRejectedValue(new Error('Network error'));
    render(<TimezoneMismatchBanner {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /Update to/i }));

    await waitFor(() => {
      expect(screen.getByText(/Failed to update timezone/)).toBeInTheDocument();
      expect(screen.getByText(/Settings/)).toBeInTheDocument();
    });
  });

  it('calls onDismiss when Keep button is clicked', () => {
    render(<TimezoneMismatchBanner {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /Keep/i }));

    expect(defaultProps.onDismiss).toHaveBeenCalledWith('Europe/London');
  });

  it('calls onDismiss when close button is clicked', () => {
    render(<TimezoneMismatchBanner {...defaultProps} />);

    const closeBtn = screen.getByRole('button', { name: /close|dismiss/i });
    fireEvent.click(closeBtn);

    expect(defaultProps.onDismiss).toHaveBeenCalledWith('Europe/London');
  });

  it('has a visible close button', () => {
    render(<TimezoneMismatchBanner {...defaultProps} />);

    const closeBtn = screen.getByRole('button', { name: /close|dismiss/i });
    expect(closeBtn).toBeVisible();
  });

  it('hides banner after successful update', async () => {
    render(<TimezoneMismatchBanner {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /Update to/i }));

    await waitFor(() => {
      expect(screen.queryByTestId('timezone-mismatch-banner')).not.toBeInTheDocument();
    });
  });

  it('dismisses on Escape key when focus is inside banner', async () => {
    render(<TimezoneMismatchBanner {...defaultProps} />);

    // Focus a button inside the banner
    const keepBtn = screen.getByRole('button', { name: /Keep/i });
    keepBtn.focus();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(defaultProps.onDismiss).toHaveBeenCalledWith('Europe/London');
  });

  it('does not dismiss on Escape key when focus is outside banner', () => {
    render(
      <div>
        <button type="button">Outside</button>
        <TimezoneMismatchBanner {...defaultProps} />
      </div>,
    );

    // Focus the outside button
    screen.getByRole('button', { name: 'Outside' }).focus();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(defaultProps.onDismiss).not.toHaveBeenCalled();
  });
});
