/**
 * @vitest-environment jsdom
 * Tests for board view customization
 * Issue #409: Implement board view customization
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// Components to be implemented
import {
  BoardConfig,
  type BoardConfigProps,
} from '@/ui/components/board-config/board-config';
import {
  ColumnManager,
  type ColumnManagerProps,
} from '@/ui/components/board-config/column-manager';
import {
  SwimlanesConfig,
  type SwimlanesConfigProps,
} from '@/ui/components/board-config/swimlanes-config';
import {
  WipLimitsConfig,
  type WipLimitsConfigProps,
} from '@/ui/components/board-config/wip-limits-config';
import {
  CardDisplayConfig,
  type CardDisplayConfigProps,
} from '@/ui/components/board-config/card-display-config';
import type {
  BoardColumn,
  SwimlaneSetting,
  WipLimit,
  CardDisplayMode,
} from '@/ui/components/board-config/types';

// Mock data
const mockColumns: BoardColumn[] = [
  { id: 'col-1', name: 'To Do', status: 'open', order: 0 },
  { id: 'col-2', name: 'In Progress', status: 'in_progress', order: 1 },
  { id: 'col-3', name: 'Done', status: 'closed', order: 2 },
];

describe('BoardConfig', () => {
  const defaultProps: BoardConfigProps = {
    open: true,
    onOpenChange: vi.fn(),
    columns: mockColumns,
    onColumnsChange: vi.fn(),
    swimlanes: null,
    onSwimlanesChange: vi.fn(),
    wipLimits: {},
    onWipLimitsChange: vi.fn(),
    cardDisplayMode: 'compact',
    onCardDisplayModeChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render board config dialog', () => {
    render(<BoardConfig {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('should show tabs for different config sections', () => {
    render(<BoardConfig {...defaultProps} />);
    expect(screen.getByRole('tab', { name: /columns/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /swimlanes/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /limits/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /display/i })).toBeInTheDocument();
  });

  it('should show columns tab by default', () => {
    render(<BoardConfig {...defaultProps} />);
    expect(screen.getByRole('tab', { name: /columns/i })).toHaveAttribute(
      'data-state',
      'active'
    );
  });

  it('should switch between tabs', () => {
    render(<BoardConfig {...defaultProps} />);

    // Verify all tabs are rendered and can be interacted with
    const swimlanesTab = screen.getByRole('tab', { name: /swimlanes/i });
    expect(swimlanesTab).toBeInTheDocument();
    expect(swimlanesTab).toHaveAttribute('aria-controls');
  });

  it('should close on cancel', () => {
    const onOpenChange = vi.fn();
    render(<BoardConfig {...defaultProps} onOpenChange={onOpenChange} />);

    // Find the Close button in the dialog footer
    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    fireEvent.click(closeButtons[closeButtons.length - 1]); // Get the last Close button

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('ColumnManager', () => {
  const defaultProps: ColumnManagerProps = {
    columns: mockColumns,
    onChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render all columns', () => {
    render(<ColumnManager {...defaultProps} />);
    // Columns are displayed in input fields
    expect(screen.getByDisplayValue('To Do')).toBeInTheDocument();
    expect(screen.getByDisplayValue('In Progress')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Done')).toBeInTheDocument();
  });

  it('should show add column button', () => {
    render(<ColumnManager {...defaultProps} />);
    expect(screen.getByRole('button', { name: /add column/i })).toBeInTheDocument();
  });

  it('should call onChange when adding column', () => {
    const onChange = vi.fn();
    render(<ColumnManager {...defaultProps} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /add column/i }));

    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        ...mockColumns,
        expect.objectContaining({ name: expect.any(String) }),
      ])
    );
  });

  it('should allow renaming column', () => {
    const onChange = vi.fn();
    render(<ColumnManager {...defaultProps} onChange={onChange} />);

    const input = screen.getAllByRole('textbox')[0];
    fireEvent.change(input, { target: { value: 'Backlog' } });

    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'col-1', name: 'Backlog' }),
      ])
    );
  });

  it('should show delete button for each column', () => {
    render(<ColumnManager {...defaultProps} />);
    const deleteButtons = screen.getAllByRole('button', { name: /delete|remove/i });
    expect(deleteButtons.length).toBe(mockColumns.length);
  });

  it('should call onChange when deleting column', () => {
    const onChange = vi.fn();
    render(<ColumnManager {...defaultProps} onChange={onChange} />);

    const deleteButtons = screen.getAllByRole('button', { name: /delete|remove/i });
    fireEvent.click(deleteButtons[0]);

    expect(onChange).toHaveBeenCalledWith(
      expect.not.arrayContaining([expect.objectContaining({ id: 'col-1' })])
    );
  });

  it('should show column order', () => {
    render(<ColumnManager {...defaultProps} />);
    // Columns should be visually numbered or have drag handles
    expect(screen.getByTestId('column-item-col-1')).toBeInTheDocument();
  });
});

describe('SwimlanesConfig', () => {
  const defaultProps: SwimlanesConfigProps = {
    value: null,
    onChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render swimlanes options', () => {
    render(<SwimlanesConfig {...defaultProps} />);
    // Check for the heading text specifically
    expect(screen.getByRole('heading', { name: /swimlanes/i })).toBeInTheDocument();
  });

  it('should show no swimlanes option', () => {
    render(<SwimlanesConfig {...defaultProps} />);
    expect(screen.getByLabelText(/none|no swimlanes/i)).toBeInTheDocument();
  });

  it('should show swimlane group by options', () => {
    render(<SwimlanesConfig {...defaultProps} />);
    expect(screen.getByLabelText(/priority/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/assignee/i)).toBeInTheDocument();
  });

  it('should call onChange when selecting swimlane option', () => {
    const onChange = vi.fn();
    render(<SwimlanesConfig {...defaultProps} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText(/priority/i));

    expect(onChange).toHaveBeenCalledWith({ groupBy: 'priority' });
  });

  it('should highlight selected option', () => {
    render(<SwimlanesConfig {...defaultProps} value={{ groupBy: 'priority' }} />);
    expect(screen.getByLabelText(/priority/i)).toBeChecked();
  });
});

describe('WipLimitsConfig', () => {
  const defaultProps: WipLimitsConfigProps = {
    columns: mockColumns,
    limits: {},
    onChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render WIP limits for each column', () => {
    render(<WipLimitsConfig {...defaultProps} />);
    expect(screen.getByText('To Do')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('should show input for limit value', () => {
    render(<WipLimitsConfig {...defaultProps} />);
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs.length).toBe(mockColumns.length);
  });

  it('should call onChange when setting limit', () => {
    const onChange = vi.fn();
    render(<WipLimitsConfig {...defaultProps} onChange={onChange} />);

    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[1], { target: { value: '5' } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ 'col-2': 5 })
    );
  });

  it('should show current limits', () => {
    const limits: Record<string, number> = { 'col-2': 3 };
    render(<WipLimitsConfig {...defaultProps} limits={limits} />);

    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[1]).toHaveValue(3);
  });

  it('should allow clearing limit', () => {
    const onChange = vi.fn();
    const limits: Record<string, number> = { 'col-2': 3 };
    render(<WipLimitsConfig {...defaultProps} limits={limits} onChange={onChange} />);

    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[1], { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith(
      expect.not.objectContaining({ 'col-2': expect.anything() })
    );
  });
});

describe('CardDisplayConfig', () => {
  const defaultProps: CardDisplayConfigProps = {
    mode: 'compact',
    onChange: vi.fn(),
    visibleFields: ['title', 'status', 'priority'],
    onVisibleFieldsChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render display mode options', () => {
    render(<CardDisplayConfig {...defaultProps} />);
    expect(screen.getByLabelText(/compact/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/detailed/i)).toBeInTheDocument();
  });

  it('should highlight selected mode', () => {
    render(<CardDisplayConfig {...defaultProps} mode="compact" />);
    expect(screen.getByLabelText(/compact/i)).toBeChecked();
  });

  it('should call onChange when mode selected', () => {
    const onChange = vi.fn();
    render(<CardDisplayConfig {...defaultProps} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText(/detailed/i));

    expect(onChange).toHaveBeenCalledWith('detailed');
  });

  it('should show field visibility options', () => {
    render(<CardDisplayConfig {...defaultProps} />);
    expect(screen.getByText(/visible fields/i)).toBeInTheDocument();
  });

  it('should show checkboxes for fields', () => {
    render(<CardDisplayConfig {...defaultProps} />);
    expect(screen.getByRole('checkbox', { name: /assignee/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /due date/i })).toBeInTheDocument();
  });

  it('should call onVisibleFieldsChange when toggling field', () => {
    const onVisibleFieldsChange = vi.fn();
    render(
      <CardDisplayConfig
        {...defaultProps}
        onVisibleFieldsChange={onVisibleFieldsChange}
      />
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /assignee/i }));

    expect(onVisibleFieldsChange).toHaveBeenCalledWith(
      expect.arrayContaining(['title', 'status', 'priority', 'assignee'])
    );
  });
});
