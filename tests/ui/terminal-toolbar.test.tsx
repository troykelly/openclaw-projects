/**
 * @vitest-environment jsdom
 *
 * Tests for the TerminalToolbar component.
 * Issues #2121 (aria-labels), #2113 (window sync/refresh).
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TerminalToolbar } from '@/ui/components/terminal/terminal-toolbar';
import type { TerminalSessionWindow } from '@/ui/lib/api-types';

const mockWindows: TerminalSessionWindow[] = [
  {
    id: 'w1',
    session_id: 's1',
    namespace: 'test',
    window_index: 0,
    window_name: 'bash',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'w2',
    session_id: 's1',
    namespace: 'test',
    window_index: 1,
    window_name: 'vim',
    is_active: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

describe('TerminalToolbar', () => {
  // #2121 — Aria-label accessibility
  describe('accessibility (#2121)', () => {
    it('renders aria-label on the search button', () => {
      render(<TerminalToolbar />);
      const btn = screen.getByRole('button', { name: /search/i });
      expect(btn).toHaveAttribute('aria-label');
    });

    it('renders aria-label on the split pane button', () => {
      render(<TerminalToolbar />);
      const btn = screen.getByRole('button', { name: /split pane/i });
      expect(btn).toHaveAttribute('aria-label');
    });

    it('renders aria-label on the annotate button', () => {
      render(<TerminalToolbar />);
      const btn = screen.getByRole('button', { name: /add annotation/i });
      expect(btn).toHaveAttribute('aria-label');
    });

    it('renders aria-label on fullscreen toggle button', () => {
      render(<TerminalToolbar />);
      const btn = screen.getByRole('button', { name: /toggle fullscreen/i });
      expect(btn).toHaveAttribute('aria-label');
    });

    it('fullscreen button label changes when in fullscreen mode', () => {
      render(<TerminalToolbar isFullscreen={true} />);
      expect(screen.getByRole('button', { name: /exit fullscreen/i })).toHaveAttribute('aria-label');
    });
  });

  // #2113 — Refresh windows button
  describe('refresh windows (#2113)', () => {
    it('renders a refresh windows button with aria-label', () => {
      render(<TerminalToolbar windows={mockWindows} />);
      const btn = screen.getByRole('button', { name: /refresh windows/i });
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveAttribute('aria-label');
    });

    it('calls onRefreshWindows when clicked', () => {
      const onRefresh = vi.fn();
      render(<TerminalToolbar windows={mockWindows} onRefreshWindows={onRefresh} />);
      fireEvent.click(screen.getByRole('button', { name: /refresh windows/i }));
      expect(onRefresh).toHaveBeenCalledOnce();
    });
  });

  // Window tab rendering
  describe('window tabs', () => {
    it('renders window tabs from windows prop', () => {
      render(<TerminalToolbar windows={mockWindows} activeWindowId="w1" />);
      expect(screen.getByText('bash')).toBeInTheDocument();
      expect(screen.getByText('vim')).toBeInTheDocument();
    });

    it('calls onWindowSelect when a tab is clicked', () => {
      const onSelect = vi.fn();
      render(<TerminalToolbar windows={mockWindows} activeWindowId="w1" onWindowSelect={onSelect} />);
      fireEvent.click(screen.getByText('vim'));
      expect(onSelect).toHaveBeenCalledWith('w2');
    });
  });
});
