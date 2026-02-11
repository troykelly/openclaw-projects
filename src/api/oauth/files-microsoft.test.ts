/**
 * Tests for Microsoft OneDrive file operations — response normalization.
 * Part of Issue #1049.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import type { DriveFile, DriveListResult } from './files.ts';

// We test the normalization functions by mocking fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after stubbing global fetch
import { listDriveItems, searchDriveItems, getDriveItem } from './microsoft.ts';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Helper to create a mock Microsoft Graph DriveItem response. */
function makeMicrosoftDriveItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-abc',
    name: 'document.docx',
    size: 54321,
    createdDateTime: '2025-01-15T10:30:00Z',
    lastModifiedDateTime: '2025-06-20T14:00:00Z',
    webUrl: 'https://onedrive.live.com/redir?resid=item-abc',
    file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    parentReference: { id: 'parent-folder-1', path: '/drive/root:/Documents' },
    '@microsoft.graph.downloadUrl': 'https://download.example.com/item-abc?token=xyz',
    thumbnails: [{ large: { url: 'https://thumb.example.com/item-abc' } }],
    ...overrides,
  };
}

function makeMicrosoftFolder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'folder-xyz',
    name: 'Documents',
    size: 0,
    createdDateTime: '2025-01-01T00:00:00Z',
    lastModifiedDateTime: '2025-06-01T00:00:00Z',
    webUrl: 'https://onedrive.live.com/redir?resid=folder-xyz',
    folder: { childCount: 5 },
    parentReference: { id: 'root', path: '/drive/root:' },
    ...overrides,
  };
}

describe('microsoft — listDriveItems', () => {
  it('should list files from root when no folderId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        value: [makeMicrosoftDriveItem(), makeMicrosoftFolder()],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=abc',
      }),
    });

    const result = await listDriveItems('access-token', 'conn-1');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/me/drive/root/children');
    expect(opts.headers.Authorization).toBe('Bearer access-token');

    expect(result.files).toHaveLength(2);

    // File
    const file = result.files[0];
    expect(file.id).toBe('item-abc');
    expect(file.name).toBe('document.docx');
    expect(file.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(file.size).toBe(54321);
    expect(file.isFolder).toBe(false);
    expect(file.provider).toBe('microsoft');
    expect(file.connectionId).toBe('conn-1');
    expect(file.downloadUrl).toBe('https://download.example.com/item-abc?token=xyz');
    expect(file.parentId).toBe('parent-folder-1');

    // Folder
    const folder = result.files[1];
    expect(folder.id).toBe('folder-xyz');
    expect(folder.name).toBe('Documents');
    expect(folder.isFolder).toBe(true);

    expect(result.nextPageToken).toBe('https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=abc');
  });

  it('should list files from a specific folder', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ value: [] }),
    });

    await listDriveItems('tok', 'conn-1', 'folder-123');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/me/drive/items/folder-123/children');
  });

  it('should use pageToken as direct URL for pagination', async () => {
    const pageUrl = 'https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=page2';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ value: [] }),
    });

    await listDriveItems('tok', 'conn-1', undefined, pageUrl);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(pageUrl);
  });

  it('should throw OAuthError on API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(listDriveItems('bad-tok', 'conn-1')).rejects.toMatchObject({
      code: 'FILES_LIST_FAILED',
      statusCode: 401,
    });
  });

  it('should handle items without optional fields', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        value: [{
          id: 'min-item',
          name: 'minimal.txt',
          file: { mimeType: 'text/plain' },
        }],
      }),
    });

    const result = await listDriveItems('tok', 'conn-1');

    expect(result.files).toHaveLength(1);
    const file = result.files[0];
    expect(file.id).toBe('min-item');
    expect(file.size).toBeUndefined();
    expect(file.downloadUrl).toBeUndefined();
    expect(file.thumbnailUrl).toBeUndefined();
    expect(file.parentId).toBeUndefined();
    expect(file.isFolder).toBe(false);
  });
});

describe('microsoft — searchDriveItems', () => {
  it('should search files across the drive', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        value: [makeMicrosoftDriveItem({ name: 'report-q4.docx' })],
      }),
    });

    const result = await searchDriveItems('tok', 'conn-1', 'quarterly report');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/me/drive/root/search(q='quarterly report')");
    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe('report-q4.docx');
  });

  it('should pass pagination token', async () => {
    const pageUrl = 'https://graph.microsoft.com/v1.0/me/drive/root/search?$skiptoken=next';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ value: [] }),
    });

    await searchDriveItems('tok', 'conn-1', 'budget', pageUrl);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(pageUrl);
  });
});

describe('microsoft — getDriveItem', () => {
  it('should get a single file with metadata', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeMicrosoftDriveItem(),
    });

    const result = await getDriveItem('tok', 'conn-1', 'item-abc');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/me/drive/items/item-abc');
    expect(result.id).toBe('item-abc');
    expect(result.name).toBe('document.docx');
    expect(result.provider).toBe('microsoft');
    expect(result.connectionId).toBe('conn-1');
  });

  it('should throw OAuthError on 404', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    });

    await expect(getDriveItem('tok', 'conn-1', 'no-such')).rejects.toMatchObject({
      code: 'FILE_NOT_FOUND',
      statusCode: 404,
    });
  });
});
