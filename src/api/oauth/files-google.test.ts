/**
 * Tests for Google Drive file operations — response normalization.
 * Part of Issue #1049.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import type { DriveFile, DriveListResult } from './files.ts';

// We test the normalization functions by mocking fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after stubbing global fetch
import { listDriveFiles, searchDriveFiles, getDriveFile } from './google.ts';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Helper to create a mock Google Drive file response. */
function makeGoogleDriveFile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-xyz',
    name: 'presentation.pptx',
    mimeType: 'application/vnd.google-apps.presentation',
    size: '67890',
    createdTime: '2025-02-10T08:00:00Z',
    modifiedTime: '2025-07-05T16:30:00Z',
    webViewLink: 'https://docs.google.com/presentation/d/file-xyz/view',
    webContentLink: 'https://drive.google.com/uc?id=file-xyz&export=download',
    thumbnailLink: 'https://lh3.googleusercontent.com/file-xyz-thumb',
    parents: ['folder-root'],
    iconLink: 'https://drive-thirdparty.googleusercontent.com/16/type/application/vnd.google-apps.presentation',
    ...overrides,
  };
}

function makeGoogleFolder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'folder-abc',
    name: 'My Folder',
    mimeType: 'application/vnd.google-apps.folder',
    createdTime: '2025-01-05T12:00:00Z',
    modifiedTime: '2025-05-20T09:00:00Z',
    webViewLink: 'https://drive.google.com/drive/folders/folder-abc',
    parents: ['root'],
    ...overrides,
  };
}

describe('google — listDriveFiles', () => {
  it('should list files from root when no folder_id', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        files: [makeGoogleDriveFile(), makeGoogleFolder()],
        next_page_token: 'page2token',
      }),
    });

    const result = await listDriveFiles('access-token', 'conn-g1');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('https://www.googleapis.com/drive/v3/files');
    // URLSearchParams encodes quotes — check decoded form
    // URLSearchParams encodes quotes as %27 and spaces as +
    const decodedUrl = decodeURIComponent(url).replace(/\+/g, ' ');
    expect(decodedUrl).toContain("'root' in parents");
    expect(opts.headers.Authorization).toBe('Bearer access-token');

    expect(result.files).toHaveLength(2);

    // File
    const file = result.files[0];
    expect(file.id).toBe('file-xyz');
    expect(file.name).toBe('presentation.pptx');
    expect(file.mime_type).toBe('application/vnd.google-apps.presentation');
    expect(file.size).toBe(67890);
    expect(file.is_folder).toBe(false);
    expect(file.provider).toBe('google');
    expect(file.connection_id).toBe('conn-g1');
    expect(file.web_url).toBe('https://docs.google.com/presentation/d/file-xyz/view');
    expect(file.download_url).toBe('https://drive.google.com/uc?id=file-xyz&export=download');
    expect(file.parent_id).toBe('folder-root');

    // Folder
    const folder = result.files[1];
    expect(folder.id).toBe('folder-abc');
    expect(folder.is_folder).toBe(true);

    expect(result.next_page_token).toBe('page2token');
  });

  it('should list files from a specific folder', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ files: [] }),
    });

    await listDriveFiles('tok', 'conn-g1', 'folder-123');

    const [url] = mockFetch.mock.calls[0];
    const decodedUrl = decodeURIComponent(url).replace(/\+/g, ' ');
    expect(decodedUrl).toContain("'folder-123' in parents");
  });

  it('should use page_token for pagination', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ files: [] }),
    });

    await listDriveFiles('tok', 'conn-g1', undefined, 'page2token');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('page_token=page2token');
  });

  it('should throw OAuthError on API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    });

    await expect(listDriveFiles('bad-tok', 'conn-g1')).rejects.toMatchObject({
      code: 'FILES_LIST_FAILED',
      status_code: 403,
    });
  });

  it('should handle files without optional fields', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        files: [{
          id: 'min-file',
          name: 'plain.txt',
          mimeType: 'text/plain',
        }],
      }),
    });

    const result = await listDriveFiles('tok', 'conn-g1');

    expect(result.files).toHaveLength(1);
    const file = result.files[0];
    expect(file.id).toBe('min-file');
    expect(file.size).toBeUndefined();
    expect(file.download_url).toBeUndefined();
    expect(file.thumbnail_url).toBeUndefined();
    expect(file.parent_id).toBeUndefined();
    expect(file.is_folder).toBe(false);
  });
});

describe('google — searchDriveFiles', () => {
  it('should search files across the drive', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        files: [makeGoogleDriveFile({ name: 'Q4-budget.xlsx' })],
      }),
    });

    const result = await searchDriveFiles('tok', 'conn-g1', 'budget');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('https://www.googleapis.com/drive/v3/files');
    // URLSearchParams encodes quotes — check decoded form
    const decodedUrl = decodeURIComponent(url).replace(/\+/g, ' ');
    expect(decodedUrl).toContain("fullText contains 'budget'");
    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe('Q4-budget.xlsx');
  });

  it('should pass pagination token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ files: [] }),
    });

    await searchDriveFiles('tok', 'conn-g1', 'invoice', 'next-page-token');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('page_token=next-page-token');
  });

  it('should exclude trashed files', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ files: [] }),
    });

    await searchDriveFiles('tok', 'conn-g1', 'test');

    const [url] = mockFetch.mock.calls[0];
    const decodedUrl = decodeURIComponent(url).replace(/\+/g, ' ');
    expect(decodedUrl).toContain('trashed=false');
  });
});

describe('google — getDriveFile', () => {
  it('should get a single file with metadata', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeGoogleDriveFile(),
    });

    const result = await getDriveFile('tok', 'conn-g1', 'file-xyz');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('https://www.googleapis.com/drive/v3/files/file-xyz');
    expect(result.id).toBe('file-xyz');
    expect(result.name).toBe('presentation.pptx');
    expect(result.provider).toBe('google');
    expect(result.connection_id).toBe('conn-g1');
  });

  it('should throw OAuthError on 404', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    });

    await expect(getDriveFile('tok', 'conn-g1', 'no-such')).rejects.toMatchObject({
      code: 'FILE_NOT_FOUND',
      status_code: 404,
    });
  });
});
