/**
 * OAuth service exports.
 * Part of Issue #206, updated in Issue #1045 for multi-account support.
 */

export * from './types.ts';
export * from './config.ts';
export {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  getUserEmail,
  refreshTokens,
  fetchProviderContacts,
  saveConnection,
  getConnection,
  getValidAccessToken,
  deleteConnection,
  listConnections,
  updateConnection,
  validateFeatures,
  isProviderConfigured,
  validateState,
  cleanExpiredStates,
} from './service.ts';
export { getRequiredScopes, getMissingScopes } from './scopes.ts';
export { syncContacts, getContactSyncCursor } from './contacts.ts';
export * as emailService from './email.ts';
export * from './email-types.ts';
export * as microsoft from './microsoft.ts';
export * as google from './google.ts';
export {
  executeContactSync,
  enqueueSyncJob,
  removePendingSyncJobs,
  getSyncStatus,
  updateFeatureSyncStatus,
  getContactSyncInterval,
  parseIntervalToMs,
  SYNC_JOB_KIND,
  LOCAL_SYNC_FEATURES,
} from './sync.ts';
export type { SyncJobResult, FeatureSyncStatus, LocalSyncFeature } from './sync.ts';
