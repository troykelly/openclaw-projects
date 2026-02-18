/**
 * Tests for file/drive browsing service.
 * Part of Issue #1049.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { DriveFile, DriveListResult } from './files.ts';
import type { OAuthConnection } from './types.ts';
import { OAuthError, NoConnectionError } from './types.ts';

// Mock the service and provider modules
vi.mock('./service.ts', () => ({
  getConnection: vi.fn(),
  getValidAccessToken: vi.fn(),
}));

vi.mock('./microsoft.ts', () => ({
  listDriveItems: vi.fn(),
  searchDriveItems: vi.fn(),
  getDriveItem: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  refreshAccessToken: vi.fn(),
  getUserEmail: vi.fn(),
  fetchContacts: vi.fn(),
  fetchAllContacts: vi.fn(),
}));

vi.mock('./google.ts', () => ({
  listDriveFiles: vi.fn(),
  searchDriveFiles: vi.fn(),
  getDriveFile: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  refreshAccessToken: vi.fn(),
  getUserEmail: vi.fn(),
  fetchContacts: vi.fn(),
  fetchAllContacts: vi.fn(),
}));

import { listFiles, searchFiles, getFile } from './files.ts';
import { getConnection, getValidAccessToken } from './service.ts';
import * as microsoft from './microsoft.ts';
import * as google from './google.ts';

const mockGetConnection = getConnection as Mock;
const mockGetValidAccessToken = getValidAccessToken as Mock;

function makeConnection(overrides: Partial<OAuthConnection> = {}): OAuthConnection {
  return {
    id: 'conn-123',
    user_email: 'user@example.com',
    provider: 'microsoft',
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    scopes: ['Files.Read'],
    expires_at: new Date(Date.now() + 3600 * 1000),
    token_metadata: {},
    label: 'Work OneDrive',
    permission_level: 'read',
    enabled_features: ['files'],
    is_active: true,
    sync_status: {},
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

const sampleMicrosoftFile: DriveFile = {
  id: 'item-1',
  name: 'document.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  size: 12345,
  created_at: new Date('2025-01-01'),
  modified_at: new Date('2025-06-15'),
  web_url: 'https://onedrive.live.com/item-1',
  download_url: 'https://download.example.com/item-1',
  is_folder: false,
  provider: 'microsoft',
  connection_id: 'conn-123',
  metadata: {},
};

const sampleGoogleFile: DriveFile = {
  id: 'file-abc',
  name: 'spreadsheet.xlsx',
  mimeType: 'application/vnd.google-apps.spreadsheet',
  size: 9876,
  created_at: new Date('2025-02-01'),
  modified_at: new Date('2025-07-01'),
  web_url: 'https://docs.google.com/spreadsheets/d/file-abc',
  is_folder: false,
  provider: 'google',
  connection_id: 'conn-456',
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('files service — listFiles', () => {
  it('should list files from OneDrive for a microsoft connection', async () => {
    const conn = makeConnection({ provider: 'microsoft' });
    mockGetConnection.mockResolvedValue(conn);
    mockGetValidAccessToken.mockResolvedValue('access-token');

    const expected: DriveListResult = {
      files: [sampleMicrosoftFile],
      next_page_token: 'page2',
    };
    (microsoft.listDriveItems as Mock).mockResolvedValue(expected);

    const result = await listFiles({} as never, 'conn-123');

    expect(microsoft.listDriveItems).toHaveBeenCalledWith('access-token', 'conn-123', undefined, undefined);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe('document.docx');
    expect(result.next_page_token).toBe('page2');
  });

  it('should list files from Google Drive for a google connection', async () => {
    const conn = makeConnection({ provider: 'google', id: 'conn-456' });
    mockGetConnection.mockResolvedValue(conn);
    mockGetValidAccessToken.mockResolvedValue('g-token');

    const expected: DriveListResult = {
      files: [sampleGoogleFile],
    };
    (google.listDriveFiles as Mock).mockResolvedValue(expected);

    const result = await listFiles({} as never, 'conn-456', 'folder-root');

    expect(google.listDriveFiles).toHaveBeenCalledWith('g-token', 'conn-456', 'folder-root', undefined);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].provider).toBe('google');
  });

  it('should pass folder_id and page_token to provider', async () => {
    const conn = makeConnection();
    mockGetConnection.mockResolvedValue(conn);
    mockGetValidAccessToken.mockResolvedValue('tok');

    (microsoft.listDriveItems as Mock).mockResolvedValue({ files: [] });

    await listFiles({} as never, 'conn-123', 'folder-abc', 'page-xyz');

    expect(microsoft.listDriveItems).toHaveBeenCalledWith('tok', 'conn-123', 'folder-abc', 'page-xyz');
  });

  it('should throw NoConnectionError when connection not found', async () => {
    mockGetConnection.mockResolvedValue(null);

    await expect(listFiles({} as never, 'no-such-conn')).rejects.toThrow(NoConnectionError);
  });

  it('should throw 403 when files feature is not enabled', async () => {
    const conn = makeConnection({ enabled_features: ['contacts'] });
    mockGetConnection.mockResolvedValue(conn);

    await expect(listFiles({} as never, 'conn-123')).rejects.toThrow(OAuthError);
    await expect(listFiles({} as never, 'conn-123')).rejects.toMatchObject({
      code: 'FILES_NOT_ENABLED',
      status_code: 403,
    });
  });

  it('should throw 403 when connection is inactive', async () => {
    const conn = makeConnection({ is_active: false });
    mockGetConnection.mockResolvedValue(conn);

    await expect(listFiles({} as never, 'conn-123')).rejects.toThrow(OAuthError);
    await expect(listFiles({} as never, 'conn-123')).rejects.toMatchObject({
      code: 'CONNECTION_DISABLED',
      status_code: 403,
    });
  });
});

describe('files service — searchFiles', () => {
  it('should search OneDrive for a microsoft connection', async () => {
    const conn = makeConnection({ provider: 'microsoft' });
    mockGetConnection.mockResolvedValue(conn);
    mockGetValidAccessToken.mockResolvedValue('access-token');

    const expected: DriveListResult = {
      files: [sampleMicrosoftFile],
    };
    (microsoft.searchDriveItems as Mock).mockResolvedValue(expected);

    const result = await searchFiles({} as never, 'conn-123', 'quarterly report');

    expect(microsoft.searchDriveItems).toHaveBeenCalledWith('access-token', 'conn-123', 'quarterly report', undefined);
    expect(result.files).toHaveLength(1);
  });

  it('should search Google Drive for a google connection', async () => {
    const conn = makeConnection({ provider: 'google', id: 'conn-456' });
    mockGetConnection.mockResolvedValue(conn);
    mockGetValidAccessToken.mockResolvedValue('g-tok');

    const expected: DriveListResult = {
      files: [sampleGoogleFile],
    };
    (google.searchDriveFiles as Mock).mockResolvedValue(expected);

    const result = await searchFiles({} as never, 'conn-456', 'budget');

    expect(google.searchDriveFiles).toHaveBeenCalledWith('g-tok', 'conn-456', 'budget', undefined);
    expect(result.files).toHaveLength(1);
  });

  it('should pass page_token for paginated search', async () => {
    const conn = makeConnection();
    mockGetConnection.mockResolvedValue(conn);
    mockGetValidAccessToken.mockResolvedValue('tok');

    (microsoft.searchDriveItems as Mock).mockResolvedValue({ files: [] });

    await searchFiles({} as never, 'conn-123', 'invoice', 'next-page');

    expect(microsoft.searchDriveItems).toHaveBeenCalledWith('tok', 'conn-123', 'invoice', 'next-page');
  });

  it('should throw 403 when files not enabled', async () => {
    const conn = makeConnection({ enabled_features: ['email'] });
    mockGetConnection.mockResolvedValue(conn);

    await expect(searchFiles({} as never, 'conn-123', 'test')).rejects.toMatchObject({
      code: 'FILES_NOT_ENABLED',
      status_code: 403,
    });
  });
});

describe('files service — getFile', () => {
  it('should get a file from OneDrive', async () => {
    const conn = makeConnection({ provider: 'microsoft' });
    mockGetConnection.mockResolvedValue(conn);
    mockGetValidAccessToken.mockResolvedValue('access-token');

    (microsoft.getDriveItem as Mock).mockResolvedValue(sampleMicrosoftFile);

    const result = await getFile({} as never, 'conn-123', 'item-1');

    expect(microsoft.getDriveItem).toHaveBeenCalledWith('access-token', 'conn-123', 'item-1');
    expect(result.name).toBe('document.docx');
    expect(result.provider).toBe('microsoft');
  });

  it('should get a file from Google Drive', async () => {
    const conn = makeConnection({ provider: 'google', id: 'conn-456' });
    mockGetConnection.mockResolvedValue(conn);
    mockGetValidAccessToken.mockResolvedValue('g-tok');

    (google.getDriveFile as Mock).mockResolvedValue(sampleGoogleFile);

    const result = await getFile({} as never, 'conn-456', 'file-abc');

    expect(google.getDriveFile).toHaveBeenCalledWith('g-tok', 'conn-456', 'file-abc');
    expect(result.name).toBe('spreadsheet.xlsx');
    expect(result.provider).toBe('google');
  });

  it('should throw NoConnectionError for missing connection', async () => {
    mockGetConnection.mockResolvedValue(null);

    await expect(getFile({} as never, 'missing', 'file-1')).rejects.toThrow(NoConnectionError);
  });

  it('should throw 403 when files not enabled', async () => {
    const conn = makeConnection({ enabled_features: [] });
    mockGetConnection.mockResolvedValue(conn);

    await expect(getFile({} as never, 'conn-123', 'file-1')).rejects.toMatchObject({
      code: 'FILES_NOT_ENABLED',
      status_code: 403,
    });
  });
});
