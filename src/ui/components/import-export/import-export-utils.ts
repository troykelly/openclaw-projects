/**
 * Utility functions for import/export
 * Issue #398: Implement contact import/export (CSV, vCard)
 */
import type { CSVParseResult, ColumnMapping, ParsedContact, ContactField } from './types';

/** Common column name mappings */
const COLUMN_NAME_MAPPINGS: Record<string, ContactField> = {
  // Name variations
  name: 'name',
  'full name': 'name',
  fullname: 'name',
  'display name': 'name',
  displayname: 'name',
  'contact name': 'name',

  // Email variations
  email: 'email',
  'email address': 'email',
  emailaddress: 'email',
  'e-mail': 'email',
  mail: 'email',

  // Phone variations
  phone: 'phone',
  'phone number': 'phone',
  phonenumber: 'phone',
  telephone: 'phone',
  tel: 'phone',
  mobile: 'phone',
  cell: 'phone',

  // Organization variations
  organization: 'organization',
  company: 'organization',
  'company name': 'organization',
  org: 'organization',
  employer: 'organization',

  // Role variations
  role: 'role',
  title: 'role',
  'job title': 'role',
  position: 'role',

  // Notes
  notes: 'notes',
  note: 'notes',
  comments: 'notes',
  description: 'notes',
};

/** Parse CSV string */
export function parseCSV(csvString: string): CSVParseResult {
  const lines = csvString.trim().split(/\r?\n/);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  // Parse header row
  const headers = parseCSVLine(lines[0]);

  // Parse data rows
  const rows: ParsedContact[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;

    const values = parseCSVLine(lines[i]);
    const row: ParsedContact = {};

    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }

    rows.push(row);
  }

  return { headers, rows };
}

/** Parse a single CSV line handling quotes */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/** Parse vCard string */
export function parseVCard(vcardString: string): ParsedContact[] {
  const contacts: ParsedContact[] = [];
  const vcards = vcardString.split(/(?=BEGIN:VCARD)/i).filter(Boolean);

  for (const vcard of vcards) {
    const contact: ParsedContact = {};
    const lines = vcard.split(/\r?\n/);

    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const key = line.substring(0, colonIndex).split(';')[0].toUpperCase();
      const value = line.substring(colonIndex + 1).trim();

      switch (key) {
        case 'FN':
          contact.name = value;
          break;
        case 'EMAIL':
          contact.email = value;
          break;
        case 'TEL':
          contact.phone = value;
          break;
        case 'ORG':
          contact.organization = value;
          break;
        case 'TITLE':
          contact.role = value;
          break;
        case 'NOTE':
          contact.notes = value;
          break;
      }
    }

    if (contact.name || contact.email) {
      contacts.push(contact);
    }
  }

  return contacts;
}

/** Auto-map columns to contact fields */
export function autoMapColumns(sourceColumns: string[]): ColumnMapping[] {
  return sourceColumns.map((column) => {
    const normalized = column.toLowerCase().trim();
    const targetField = COLUMN_NAME_MAPPINGS[normalized] || null;

    return {
      sourceColumn: column,
      targetField,
      autoMapped: targetField !== null,
    };
  });
}

/** Export contacts to CSV */
export function exportToCSV(contacts: ParsedContact[], fields: ContactField[]): string {
  const rows: string[] = [];

  // Header row
  rows.push(fields.filter((f) => f !== 'skip').join(','));

  // Data rows
  for (const contact of contacts) {
    const values = fields
      .filter((f) => f !== 'skip')
      .map((field) => {
        const value = contact[field] || '';
        // Escape if contains comma, quote, or newline
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      });
    rows.push(values.join(','));
  }

  return rows.join('\n');
}

/** Export contacts to vCard format */
export function exportToVCard(contacts: ParsedContact[]): string {
  const vcards: string[] = [];

  for (const contact of contacts) {
    const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0'];

    if (contact.name) {
      lines.push(`FN:${contact.name}`);
    }
    if (contact.email) {
      lines.push(`EMAIL:${contact.email}`);
    }
    if (contact.phone) {
      lines.push(`TEL:${contact.phone}`);
    }
    if (contact.organization) {
      lines.push(`ORG:${contact.organization}`);
    }
    if (contact.role) {
      lines.push(`TITLE:${contact.role}`);
    }
    if (contact.notes) {
      lines.push(`NOTE:${contact.notes}`);
    }

    lines.push('END:VCARD');
    vcards.push(lines.join('\n'));
  }

  return vcards.join('\n');
}

/** Contact field options for export */
export const CONTACT_FIELDS: { id: ContactField; label: string }[] = [
  { id: 'name', label: 'Name' },
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
  { id: 'organization', label: 'Organization' },
  { id: 'role', label: 'Role' },
  { id: 'notes', label: 'Notes' },
];
