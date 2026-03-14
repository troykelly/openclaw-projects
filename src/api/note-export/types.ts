/**
 * Note export types.
 * Part of Epic #2475, Issue #2477.
 *
 * All property names use snake_case to match the project-wide convention (Issue #1412).
 */

/** Supported export formats */
export type ExportFormat = 'pdf' | 'docx' | 'odf';

/** Export job status */
export type ExportStatus = 'pending' | 'generating' | 'ready' | 'failed' | 'expired';

/** Source type being exported */
export type ExportSourceType = 'note' | 'notebook';

/** PDF page size options */
export type PageSize = 'A4' | 'Letter';

/** Export options stored in JSONB */
export interface ExportOptions {
  page_size?: PageSize;
  margin?: string;
  include_toc?: boolean;
  /** IANA timezone for date rendering in exported documents (defaults to UTC) */
  timezone?: string;
}

/** Database row for note_export */
export interface NoteExport {
  id: string;
  namespace: string;
  requested_by: string;
  source_type: ExportSourceType;
  source_id: string;
  format: ExportFormat;
  options: ExportOptions;
  status: ExportStatus;
  error_message: string | null;
  storage_key: string | null;
  original_filename: string | null;
  size_bytes: number | null;
  attempt_count: number;
  started_at: Date | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

/** Parameters for creating an export job */
export interface CreateExportParams {
  namespace: string;
  requested_by: string;
  source_type: ExportSourceType;
  source_id: string;
  format: ExportFormat;
  options?: ExportOptions;
}

/** PDF generator input */
export interface PdfGeneratorInput {
  html: string;
  options?: {
    page_size?: PageSize;
    margin?: string;
  };
}

/** DOCX generator input */
export interface DocxGeneratorInput {
  markdown: string;
  metadata?: {
    title?: string;
    author?: string;
    created_at?: Date;
  };
}

/** ODF generator input */
export interface OdfGeneratorInput {
  markdown: string;
}
