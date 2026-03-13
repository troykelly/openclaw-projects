// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryEditor } from '../../../src/ui/components/memory/memory-editor';

describe('MemoryEditor lifecycle enhancements (#2447)', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onSubmit: vi.fn(),
  };

  describe('TTL picker', () => {
    it('renders TTL picker with duration presets', () => {
      render(<MemoryEditor {...defaultProps} />);
      expect(screen.getByText('Time to Live (TTL)')).toBeInTheDocument();
    });

    it('shows preset durations (1h, 6h, 24h, 3d, 7d, 30d)', () => {
      render(<MemoryEditor {...defaultProps} />);
      expect(screen.getByText('1h')).toBeInTheDocument();
      expect(screen.getByText('6h')).toBeInTheDocument();
      expect(screen.getByText('24h')).toBeInTheDocument();
      expect(screen.getByText('3d')).toBeInTheDocument();
      expect(screen.getByText('7d')).toBeInTheDocument();
      expect(screen.getByText('30d')).toBeInTheDocument();
    });
  });

  describe('pinned toggle', () => {
    it('renders pinned toggle', () => {
      render(<MemoryEditor {...defaultProps} />);
      expect(screen.getByLabelText(/pinned/i)).toBeInTheDocument();
    });
  });

  describe('upsert_tags field', () => {
    it('renders upsert_tags input', () => {
      render(<MemoryEditor {...defaultProps} />);
      expect(screen.getByLabelText(/sliding window tags/i)).toBeInTheDocument();
    });
  });

  describe('form submission', () => {
    it('includes TTL section in editor form', () => {
      render(<MemoryEditor {...defaultProps} />);
      expect(screen.getByText('Time to Live (TTL)')).toBeInTheDocument();
      expect(screen.getByText('None')).toBeInTheDocument();
    });
  });
});
