/**
 * OAuth service exports.
 * Part of Issue #206.
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
  isProviderConfigured,
  validateState,
  cleanExpiredStates,
} from './service.ts';
export { syncContacts, getContactSyncCursor } from './contacts.ts';
export * as microsoft from './microsoft.ts';
export * as google from './google.ts';
