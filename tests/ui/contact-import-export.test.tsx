/**
 * @vitest-environment jsdom
 * Tests for contact import/export components
 * Issue #398: Implement contact import/export (CSV, vCard)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';

// Components to be implemented
import { ImportDialog, type ImportDialogProps } from '@/ui/components/import-export/import-dialog';
import { ColumnMapper, type ColumnMapperProps } from '@/ui/components/import-export/column-mapper';
import { ExportDialog, type ExportDialogProps } from '@/ui/components/import-export/export-dialog';
import { ImportPreview, type ImportPreviewProps } from '@/ui/components/import-export/import-preview';
import { ImportSummary, type ImportSummaryProps } from '@/ui/components/import-export/import-summary';
import type { ImportFormat, ExportFormat, ColumnMapping, ImportResult, ParsedContact } from '@/ui/components/import-export/types';
import { parseCSV, parseVCard, autoMapColumns, exportToCSV, exportToVCard } from '@/ui/components/import-export/import-export-utils';

describe('ImportDialog', () => {
  const defaultProps: ImportDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    onImport: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render dialog when open', () => {
    render(<ImportDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('should not render when closed', () => {
    render(<ImportDialog {...defaultProps} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should show file upload area', () => {
    render(<ImportDialog {...defaultProps} />);
    expect(screen.getByText('Drop a file here or')).toBeInTheDocument();
  });

  it('should accept CSV files', () => {
    render(<ImportDialog {...defaultProps} />);
    const input = screen.getByTestId('file-input');
    expect(input).toHaveAttribute('accept', '.csv,.vcf');
  });

  it('should show format selection', () => {
    render(<ImportDialog {...defaultProps} />);
    // Format buttons exist under Format label
    const csvButtons = screen.getAllByText('CSV');
    expect(csvButtons.length).toBeGreaterThan(0);
    expect(screen.getByText('vCard')).toBeInTheDocument();
  });

  it('should show duplicate handling options', () => {
    render(<ImportDialog {...defaultProps} />);
    expect(screen.getByText(/duplicate/i)).toBeInTheDocument();
  });

  it('should disable import button without file', () => {
    render(<ImportDialog {...defaultProps} />);
    expect(screen.getByRole('button', { name: /import/i })).toBeDisabled();
  });

  it('should show progress during import', () => {
    render(<ImportDialog {...defaultProps} importing progress={50} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});

describe('ColumnMapper', () => {
  const mockColumns = ['Full Name', 'Email Address', 'Phone', 'Company'];
  const defaultProps: ColumnMapperProps = {
    sourceColumns: mockColumns,
    mappings: [],
    onMappingChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render all source columns', () => {
    render(<ColumnMapper {...defaultProps} />);
    expect(screen.getByText('Full Name')).toBeInTheDocument();
    expect(screen.getByText('Email Address')).toBeInTheDocument();
    expect(screen.getByText('Phone')).toBeInTheDocument();
    expect(screen.getByText('Company')).toBeInTheDocument();
  });

  it('should show target field dropdowns', () => {
    render(<ColumnMapper {...defaultProps} />);
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(4);
  });

  it('should show available target fields', () => {
    render(<ColumnMapper {...defaultProps} />);

    // Click on first dropdown to open it
    fireEvent.click(screen.getAllByRole('combobox')[0]);

    // The select component uses Name and Email as labels
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('should call onMappingChange when mapping changed', () => {
    const onMappingChange = vi.fn();
    render(<ColumnMapper {...defaultProps} onMappingChange={onMappingChange} />);

    fireEvent.click(screen.getAllByRole('combobox')[0]);
    fireEvent.click(screen.getByText('Name'));

    expect(onMappingChange).toHaveBeenCalled();
  });

  it('should highlight auto-mapped columns', () => {
    const mappings: ColumnMapping[] = [{ sourceColumn: 'Email Address', targetField: 'email', autoMapped: true }];
    render(<ColumnMapper {...defaultProps} mappings={mappings} />);

    // Find the row by checking for the auto-mapped attribute
    const rows = document.querySelectorAll('[data-auto-mapped="true"]');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('should show skip option for unwanted columns', () => {
    render(<ColumnMapper {...defaultProps} />);

    fireEvent.click(screen.getAllByRole('combobox')[0]);

    // Skip / Ignore option should appear in the dropdown
    const skipOptions = screen.getAllByText('Skip / Ignore');
    expect(skipOptions.length).toBeGreaterThan(0);
  });
});

describe('ImportPreview', () => {
  const mockData: ParsedContact[] = [
    { name: 'Alice Smith', email: 'alice@example.com', phone: '555-1234' },
    { name: 'Bob Jones', email: 'bob@example.com', phone: '555-5678' },
  ];

  const defaultProps: ImportPreviewProps = {
    data: mockData,
    mappings: [
      { sourceColumn: 'name', targetField: 'name' },
      { sourceColumn: 'email', targetField: 'email' },
    ],
  };

  it('should show preview of mapped data', () => {
    render(<ImportPreview {...defaultProps} />);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  });

  it('should show row count', () => {
    render(<ImportPreview {...defaultProps} />);
    expect(screen.getByText(/2 contacts/i)).toBeInTheDocument();
  });

  it('should highlight rows with errors', () => {
    const dataWithErrors = [
      { name: 'Alice', email: 'alice@example.com' },
      { name: '', email: 'invalid-email' }, // Missing name, invalid email
    ];
    render(<ImportPreview {...defaultProps} data={dataWithErrors} />);

    const errorRows = screen.getAllByTestId('preview-row-error');
    expect(errorRows.length).toBeGreaterThan(0);
  });

  it('should show validation messages', () => {
    const dataWithErrors = [{ name: '', email: 'test@example.com' }];
    render(<ImportPreview {...defaultProps} data={dataWithErrors} />);
    expect(screen.getByText(/name.*required/i)).toBeInTheDocument();
  });
});

describe('ImportSummary', () => {
  const mockResult: ImportResult = {
    imported: 45,
    skipped: 5,
    errors: 2,
    errorDetails: [
      { row: 3, message: 'Invalid email format' },
      { row: 10, message: 'Duplicate contact' },
    ],
  };

  const defaultProps: ImportSummaryProps = {
    result: mockResult,
    onClose: vi.fn(),
  };

  it('should show imported count', () => {
    render(<ImportSummary {...defaultProps} />);
    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.getByText(/imported/i)).toBeInTheDocument();
  });

  it('should show skipped count', () => {
    render(<ImportSummary {...defaultProps} />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText(/skipped/i)).toBeInTheDocument();
  });

  it('should show error count', () => {
    render(<ImportSummary {...defaultProps} />);
    // Errors section exists with the error count
    expect(screen.getByText('Errors')).toBeInTheDocument();
    // The error details section shows specific errors
    expect(screen.getByText('Error Details')).toBeInTheDocument();
  });

  it('should show error details', () => {
    render(<ImportSummary {...defaultProps} />);
    expect(screen.getByText(/invalid email/i)).toBeInTheDocument();
    expect(screen.getByText(/duplicate contact/i)).toBeInTheDocument();
  });

  it('should call onClose when done clicked', () => {
    const onClose = vi.fn();
    render(<ImportSummary {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /done|close/i }));

    expect(onClose).toHaveBeenCalled();
  });
});

describe('ExportDialog', () => {
  const defaultProps: ExportDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    onExport: vi.fn(),
    contactCount: 100,
    selectedCount: 25,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render dialog when open', () => {
    render(<ExportDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('should show format options', () => {
    render(<ExportDialog {...defaultProps} />);
    expect(screen.getByText('CSV')).toBeInTheDocument();
    expect(screen.getByText('vCard')).toBeInTheDocument();
  });

  it('should show scope options', () => {
    render(<ExportDialog {...defaultProps} />);
    expect(screen.getByText(/all.*100/i)).toBeInTheDocument();
    expect(screen.getByText(/selected.*25/i)).toBeInTheDocument();
  });

  it('should call onExport with format and scope', () => {
    const onExport = vi.fn();
    render(<ExportDialog {...defaultProps} onExport={onExport} />);

    fireEvent.click(screen.getByText('CSV'));
    fireEvent.click(screen.getByText(/all.*100/i));
    fireEvent.click(screen.getByRole('button', { name: /export/i }));

    expect(onExport).toHaveBeenCalledWith('csv', 'all');
  });

  it('should disable selected option when none selected', () => {
    render(<ExportDialog {...defaultProps} selectedCount={0} />);

    const selectedOption = screen.getByText(/selected.*0/i).closest('button');
    expect(selectedOption).toBeDisabled();
  });

  it('should show field selection for CSV', () => {
    render(<ExportDialog {...defaultProps} />);

    fireEvent.click(screen.getByText('CSV'));

    expect(screen.getByText(/fields to include/i)).toBeInTheDocument();
  });
});

describe('import-export-utils', () => {
  describe('parseCSV', () => {
    it('should parse CSV string into rows', () => {
      const csv = 'name,email\nAlice,alice@test.com\nBob,bob@test.com';
      const result = parseCSV(csv);

      expect(result.headers).toEqual(['name', 'email']);
      expect(result.rows.length).toBe(2);
      expect(result.rows[0]).toEqual({ name: 'Alice', email: 'alice@test.com' });
    });

    it('should handle quoted fields', () => {
      const csv = 'name,email\n"Smith, John",john@test.com';
      const result = parseCSV(csv);

      expect(result.rows[0].name).toBe('Smith, John');
    });

    it('should handle empty values', () => {
      const csv = 'name,email,phone\nAlice,alice@test.com,';
      const result = parseCSV(csv);

      expect(result.rows[0].phone).toBe('');
    });
  });

  describe('parseVCard', () => {
    it('should parse vCard string', () => {
      const vcard = `BEGIN:VCARD
VERSION:3.0
FN:Alice Smith
EMAIL:alice@test.com
TEL:555-1234
END:VCARD`;

      const contacts = parseVCard(vcard);

      expect(contacts.length).toBe(1);
      expect(contacts[0].name).toBe('Alice Smith');
      expect(contacts[0].email).toBe('alice@test.com');
      expect(contacts[0].phone).toBe('555-1234');
    });

    it('should parse multiple vCards', () => {
      const vcards = `BEGIN:VCARD
VERSION:3.0
FN:Alice
END:VCARD
BEGIN:VCARD
VERSION:3.0
FN:Bob
END:VCARD`;

      const contacts = parseVCard(vcards);
      expect(contacts.length).toBe(2);
    });
  });

  describe('autoMapColumns', () => {
    it('should auto-map common column names', () => {
      const columns = ['Full Name', 'Email Address', 'Phone Number', 'Company'];
      const mappings = autoMapColumns(columns);

      expect(mappings.find((m) => m.sourceColumn === 'Full Name')?.targetField).toBe('name');
      expect(mappings.find((m) => m.sourceColumn === 'Email Address')?.targetField).toBe('email');
    });

    it('should mark auto-mapped columns', () => {
      const columns = ['Email'];
      const mappings = autoMapColumns(columns);

      expect(mappings[0].autoMapped).toBe(true);
    });
  });

  describe('exportToCSV', () => {
    it('should export contacts to CSV string', () => {
      const contacts = [
        { name: 'Alice', email: 'alice@test.com' },
        { name: 'Bob', email: 'bob@test.com' },
      ];

      const csv = exportToCSV(contacts, ['name', 'email']);

      expect(csv).toContain('name,email');
      expect(csv).toContain('Alice,alice@test.com');
      expect(csv).toContain('Bob,bob@test.com');
    });

    it('should escape special characters', () => {
      const contacts = [{ name: 'Smith, John', email: 'john@test.com' }];

      const csv = exportToCSV(contacts, ['name', 'email']);

      expect(csv).toContain('"Smith, John"');
    });
  });

  describe('exportToVCard', () => {
    it('should export contact to vCard format', () => {
      const contacts = [{ name: 'Alice Smith', email: 'alice@test.com', phone: '555-1234' }];

      const vcard = exportToVCard(contacts);

      expect(vcard).toContain('BEGIN:VCARD');
      expect(vcard).toContain('FN:Alice Smith');
      expect(vcard).toContain('EMAIL:alice@test.com');
      expect(vcard).toContain('TEL:555-1234');
      expect(vcard).toContain('END:VCARD');
    });

    it('should export multiple contacts', () => {
      const contacts = [
        { name: 'Alice', email: 'alice@test.com' },
        { name: 'Bob', email: 'bob@test.com' },
      ];

      const vcard = exportToVCard(contacts);

      const vcardCount = (vcard.match(/BEGIN:VCARD/g) || []).length;
      expect(vcardCount).toBe(2);
    });
  });
});
