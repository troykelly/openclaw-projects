/**
 * OAuth service exports.
 * Part of Issue #206.
 */

export * from './types.js';
export * from './config.js';
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
} from './service.js';
export { syncContacts, getContactSyncCursor } from './contacts.js';
export * as microsoft from './microsoft.js';
export * as google from './google.js';
