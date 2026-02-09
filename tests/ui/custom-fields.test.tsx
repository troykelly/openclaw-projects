/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { CustomFieldInput } from '@/ui/components/custom-fields/custom-field-input';
import { CustomFieldList } from '@/ui/components/custom-fields/custom-field-list';
import { CustomFieldManager } from '@/ui/components/custom-fields/custom-field-manager';
import { validateFieldValue } from '@/ui/components/custom-fields/validation';
import type { CustomFieldDefinition, CustomFieldValue } from '@/ui/components/custom-fields/types';

describe('CustomFieldInput', () => {
  const baseField: CustomFieldDefinition = {
    id: 'field-1',
    name: 'Sprint',
    type: 'text',
    projectId: 'proj-1',
    order: 0,
  };

  it('renders text input for text type', () => {
    render(<CustomFieldInput field={baseField} value="" onChange={vi.fn()} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders textarea for longtext type', () => {
    const field: CustomFieldDefinition = { ...baseField, type: 'longtext' };
    render(<CustomFieldInput field={field} value="" onChange={vi.fn()} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('rows');
  });

  it('renders number input for number type', () => {
    const field: CustomFieldDefinition = { ...baseField, type: 'number' };
    render(<CustomFieldInput field={field} value={0} onChange={vi.fn()} />);
    expect(screen.getByRole('spinbutton')).toBeInTheDocument();
  });

  it('renders date picker for date type', () => {
    const field: CustomFieldDefinition = { ...baseField, type: 'date' };
    render(<CustomFieldInput field={field} value="" onChange={vi.fn()} />);
    // Date input has no accessible role, query by attribute
    const input = document.querySelector('input[type="date"]');
    expect(input).toBeInTheDocument();
  });

  it('renders select for select type', () => {
    const field: CustomFieldDefinition = {
      ...baseField,
      type: 'select',
      options: ['Option 1', 'Option 2', 'Option 3'],
    };
    render(<CustomFieldInput field={field} value="" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders multi-select checkboxes for multiselect type', () => {
    const field: CustomFieldDefinition = {
      ...baseField,
      type: 'multiselect',
      options: ['Tag 1', 'Tag 2', 'Tag 3'],
    };
    render(<CustomFieldInput field={field} value={[]} onChange={vi.fn()} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  });

  it('renders checkbox for checkbox type', () => {
    const field: CustomFieldDefinition = { ...baseField, type: 'checkbox' };
    render(<CustomFieldInput field={field} value={false} onChange={vi.fn()} />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('renders URL input for url type', () => {
    const field: CustomFieldDefinition = { ...baseField, type: 'url' };
    render(<CustomFieldInput field={field} value="" onChange={vi.fn()} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('type', 'url');
  });

  it('calls onChange when value changes', () => {
    const onChange = vi.fn();
    render(<CustomFieldInput field={baseField} value="" onChange={onChange} />);

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'New value' },
    });

    expect(onChange).toHaveBeenCalledWith('New value');
  });

  it('shows required indicator when field is required', () => {
    const field: CustomFieldDefinition = { ...baseField, required: true };
    render(<CustomFieldInput field={field} value="" onChange={vi.fn()} />);
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('shows description when provided', () => {
    // For text fields, description is used as placeholder
    const field: CustomFieldDefinition = {
      ...baseField,
      type: 'number', // Use non-text type so description shows as text
      description: 'Enter the sprint number',
    };
    render(<CustomFieldInput field={field} value={0} onChange={vi.fn()} />);
    expect(screen.getByText('Enter the sprint number')).toBeInTheDocument();
  });

  it('respects validation rules for number fields', () => {
    const field: CustomFieldDefinition = {
      ...baseField,
      type: 'number',
      validation: { min: 0, max: 100 },
    };
    render(<CustomFieldInput field={field} value={50} onChange={vi.fn()} />);
    const input = screen.getByRole('spinbutton');
    expect(input).toHaveAttribute('min', '0');
    expect(input).toHaveAttribute('max', '100');
  });
});

describe('CustomFieldList', () => {
  const mockFields: CustomFieldDefinition[] = [
    { id: 'f1', name: 'Sprint', type: 'text', projectId: 'p1', order: 0 },
    { id: 'f2', name: 'Points', type: 'number', projectId: 'p1', order: 1 },
    {
      id: 'f3',
      name: 'Environment',
      type: 'select',
      projectId: 'p1',
      order: 2,
      options: ['Dev', 'Staging', 'Prod'],
    },
  ];

  const mockValues: CustomFieldValue[] = [
    { fieldId: 'f1', value: 'Sprint 5' },
    { fieldId: 'f2', value: 8 },
    { fieldId: 'f3', value: 'Dev' },
  ];

  it('renders all custom fields', () => {
    render(<CustomFieldList fields={mockFields} values={mockValues} onChange={vi.fn()} />);

    expect(screen.getByText('Sprint')).toBeInTheDocument();
    expect(screen.getByText('Points')).toBeInTheDocument();
    expect(screen.getByText('Environment')).toBeInTheDocument();
  });

  it('displays field values', () => {
    render(<CustomFieldList fields={mockFields} values={mockValues} onChange={vi.fn()} />);

    expect(screen.getByDisplayValue('Sprint 5')).toBeInTheDocument();
    expect(screen.getByDisplayValue('8')).toBeInTheDocument();
  });

  it('calls onChange with updated values', () => {
    const onChange = vi.fn();
    render(<CustomFieldList fields={mockFields} values={mockValues} onChange={onChange} />);

    const sprintInput = screen.getByDisplayValue('Sprint 5');
    fireEvent.change(sprintInput, { target: { value: 'Sprint 6' } });

    expect(onChange).toHaveBeenCalledWith('f1', 'Sprint 6');
  });

  it('renders in read-only mode', () => {
    render(<CustomFieldList fields={mockFields} values={mockValues} onChange={vi.fn()} readOnly />);

    expect(screen.getByText('Sprint 5')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

describe('CustomFieldManager', () => {
  const mockFields: CustomFieldDefinition[] = [
    { id: 'f1', name: 'Sprint', type: 'text', projectId: 'p1', order: 0 },
    { id: 'f2', name: 'Points', type: 'number', projectId: 'p1', order: 1 },
  ];

  const defaultProps = {
    projectId: 'p1',
    fields: mockFields,
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onReorder: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays existing fields', () => {
    render(<CustomFieldManager {...defaultProps} />);

    expect(screen.getByText('Sprint')).toBeInTheDocument();
    expect(screen.getByText('Points')).toBeInTheDocument();
  });

  it('shows field type badges', () => {
    render(<CustomFieldManager {...defaultProps} />);

    expect(screen.getByText('text')).toBeInTheDocument();
    expect(screen.getByText('number')).toBeInTheDocument();
  });

  it('opens create field dialog', () => {
    render(<CustomFieldManager {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /add field/i }));

    expect(screen.getByText('Create Custom Field')).toBeInTheDocument();
  });

  it('calls onCreate when creating a field', () => {
    const onCreate = vi.fn();
    render(<CustomFieldManager {...defaultProps} onCreate={onCreate} />);

    fireEvent.click(screen.getByRole('button', { name: /add field/i }));

    // Fill in field details
    fireEvent.change(screen.getByLabelText(/field name/i), {
      target: { value: 'New Field' },
    });

    // Select type
    fireEvent.change(screen.getByLabelText(/field type/i), {
      target: { value: 'text' },
    });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'New Field',
        type: 'text',
      }),
    );
  });

  it('shows delete confirmation', () => {
    render(<CustomFieldManager {...defaultProps} />);

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    fireEvent.click(deleteButtons[0]);

    expect(screen.getByText(/are you sure/i)).toBeInTheDocument();
  });

  it('calls onDelete when confirmed', () => {
    const onDelete = vi.fn();
    render(<CustomFieldManager {...defaultProps} onDelete={onDelete} />);

    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    fireEvent.click(deleteButtons[0]);

    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    expect(onDelete).toHaveBeenCalledWith('f1');
  });

  it('shows options input for select type', () => {
    render(<CustomFieldManager {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: /add field/i }));

    // Select select type
    fireEvent.change(screen.getByLabelText(/field type/i), {
      target: { value: 'select' },
    });

    expect(screen.getByText(/options/i)).toBeInTheDocument();
  });
});

describe('Field Type Validation', () => {
  it('validates URL format', () => {
    const field: CustomFieldDefinition = {
      id: 'url-field',
      name: 'Website',
      type: 'url',
      projectId: 'p1',
      order: 0,
    };

    expect(validateFieldValue(field, 'https://example.com')).toBeNull();
    expect(validateFieldValue(field, 'not-a-url')).toBe('Invalid URL format');
  });

  it('validates required fields', () => {
    const field: CustomFieldDefinition = {
      id: 'req-field',
      name: 'Required',
      type: 'text',
      projectId: 'p1',
      order: 0,
      required: true,
    };

    expect(validateFieldValue(field, '')).toBe('This field is required');
    expect(validateFieldValue(field, 'value')).toBeNull();
  });

  it('validates number range', () => {
    const field: CustomFieldDefinition = {
      id: 'num-field',
      name: 'Score',
      type: 'number',
      projectId: 'p1',
      order: 0,
      validation: { min: 0, max: 10 },
    };

    expect(validateFieldValue(field, 5)).toBeNull();
    expect(validateFieldValue(field, -1)).toBe('Value must be at least 0');
    expect(validateFieldValue(field, 11)).toBe('Value must be at most 10');
  });
});
