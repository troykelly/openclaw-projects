/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InlineEdit, InlineEditableText } from '@/ui/components/inline-edit';

describe('InlineEdit', () => {
  const defaultProps = {
    value: 'Test Value',
    onSave: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the value when not editing', () => {
    render(<InlineEdit {...defaultProps} />);

    expect(screen.getByText('Test Value')).toBeInTheDocument();
  });

  it('shows input when clicking on the value', () => {
    render(<InlineEdit {...defaultProps} />);

    fireEvent.click(screen.getByText('Test Value'));

    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('Test Value');
  });

  it('shows input when double-clicking on the value', () => {
    render(<InlineEdit {...defaultProps} />);

    fireEvent.doubleClick(screen.getByText('Test Value'));

    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('calls onSave when pressing Enter', async () => {
    const onSave = vi.fn();
    render(<InlineEdit {...defaultProps} onSave={onSave} />);

    fireEvent.click(screen.getByText('Test Value'));

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'New Value' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSave).toHaveBeenCalledWith('New Value');
  });

  it('calls onCancel when pressing Escape', () => {
    const onCancel = vi.fn();
    render(<InlineEdit {...defaultProps} onCancel={onCancel} />);

    fireEvent.click(screen.getByText('Test Value'));

    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalled();
  });

  it('reverts to original value when pressing Escape', () => {
    render(<InlineEdit {...defaultProps} />);

    fireEvent.click(screen.getByText('Test Value'));

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Changed' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.getByText('Test Value')).toBeInTheDocument();
  });

  it('calls onSave when input loses focus', () => {
    const onSave = vi.fn();
    render(<InlineEdit {...defaultProps} onSave={onSave} saveOnBlur />);

    fireEvent.click(screen.getByText('Test Value'));

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'New Value' } });
    fireEvent.blur(input);

    expect(onSave).toHaveBeenCalledWith('New Value');
  });

  it('does not call onSave if value is unchanged', () => {
    const onSave = vi.fn();
    render(<InlineEdit {...defaultProps} onSave={onSave} />);

    fireEvent.click(screen.getByText('Test Value'));

    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('validates input before saving', () => {
    const onSave = vi.fn();
    const validate = (value: string) => value.length >= 3;
    render(<InlineEdit {...defaultProps} onSave={onSave} validate={validate} />);

    fireEvent.click(screen.getByText('Test Value'));

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'AB' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows loading state during async save', async () => {
    const onSave = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 100)));
    render(<InlineEdit {...defaultProps} onSave={onSave} />);

    fireEvent.click(screen.getByText('Test Value'));

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'New Value' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input).toBeDisabled();
  });

  it('focuses input when entering edit mode', () => {
    render(<InlineEdit {...defaultProps} />);

    fireEvent.click(screen.getByText('Test Value'));

    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('selects all text when entering edit mode', () => {
    render(<InlineEdit {...defaultProps} selectOnFocus />);

    fireEvent.click(screen.getByText('Test Value'));

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });
});

describe('InlineEditableText', () => {
  const defaultProps = {
    value: 'Editable Text',
    onSave: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders as a span by default', () => {
    render(<InlineEditableText {...defaultProps} />);

    const span = screen.getByText('Editable Text');
    expect(span.tagName).toBe('SPAN');
  });

  it('renders with custom className', () => {
    render(<InlineEditableText {...defaultProps} className="custom-class" />);

    expect(screen.getByText('Editable Text')).toHaveClass('custom-class');
  });

  it('shows placeholder when value is empty', () => {
    render(<InlineEditableText {...defaultProps} value="" placeholder="Enter text..." />);

    expect(screen.getByText('Enter text...')).toBeInTheDocument();
  });

  it('applies edit mode styles when editing', () => {
    render(<InlineEditableText {...defaultProps} />);

    fireEvent.click(screen.getByText('Editable Text'));

    const input = screen.getByRole('textbox');
    expect(input).toHaveClass('ring-2');
  });

  it('supports multiline editing', () => {
    render(<InlineEditableText {...defaultProps} multiline />);

    fireEvent.click(screen.getByText('Editable Text'));

    expect(screen.getByRole('textbox').tagName).toBe('TEXTAREA');
  });

  it('requires double-click when doubleClick prop is true', () => {
    render(<InlineEditableText {...defaultProps} doubleClick />);

    // Single click should not enter edit mode
    fireEvent.click(screen.getByText('Editable Text'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    // Double click should enter edit mode
    fireEvent.doubleClick(screen.getByText('Editable Text'));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('validates before saving', () => {
    const onSave = vi.fn();
    render(
      <InlineEditableText
        {...defaultProps}
        onSave={onSave}
        validate={(v) => v.trim().length > 0}
      />
    );

    fireEvent.click(screen.getByText('Editable Text'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('calls onSave with valid input', () => {
    const onSave = vi.fn();
    render(<InlineEditableText {...defaultProps} onSave={onSave} />);

    fireEvent.click(screen.getByText('Editable Text'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'New Title' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSave).toHaveBeenCalledWith('New Title');
  });

  it('is disabled when disabled prop is true', () => {
    render(<InlineEditableText {...defaultProps} disabled />);

    fireEvent.click(screen.getByText('Editable Text'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
