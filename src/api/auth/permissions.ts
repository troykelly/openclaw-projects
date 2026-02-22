/**
 * Namespace-based permissions (#1581).
 *
 * Permissions are defined in platform configuration, not database schema.
 * A permission check = "does this human have a grant for the permission's namespace?"
 *
 * Example config:
 * {
 *   "permissions": {
 *     "platform_admin": { "namespace": "admins", "description": "Full platform administration" },
 *     "ha_admin": { "namespace": "home-assistant-admins", "description": "Configure HA integrations" },
 *     "contacts_admin": { "namespace": "contacts-admins", "description": "Merge contacts, manage tags" }
 *   }
 * }
 */

export interface PermissionConfig {
  namespace: string;
  description: string;
}

export interface PlatformConfig {
  permissions?: Record<string, PermissionConfig>;
}

/**
 * Check if a user has a specific permission based on namespace membership.
 *
 * @param userNamespaces - Set of namespaces the user has grants for
 * @param permissionName - The permission to check (e.g., 'platform_admin')
 * @param config - Platform configuration containing permission definitions
 * @returns true if the user is a member of the permission's namespace
 */
export function hasPermission(
  userNamespaces: Set<string> | string[],
  permissionName: string,
  config: PlatformConfig,
): boolean {
  const permDef = config.permissions?.[permissionName];
  if (!permDef) return false;

  const nsSet = userNamespaces instanceof Set ? userNamespaces : new Set(userNamespaces);
  return nsSet.has(permDef.namespace);
}

/**
 * Get all permissions a user has based on their namespace memberships.
 *
 * @param userNamespaces - Set of namespaces the user has grants for
 * @param config - Platform configuration containing permission definitions
 * @returns Set of permission names the user holds
 */
export function getPermissions(
  userNamespaces: Set<string> | string[],
  config: PlatformConfig,
): Set<string> {
  const nsSet = userNamespaces instanceof Set ? userNamespaces : new Set(userNamespaces);
  const result = new Set<string>();

  if (!config.permissions) return result;

  for (const [permName, permDef] of Object.entries(config.permissions)) {
    if (nsSet.has(permDef.namespace)) {
      result.add(permName);
    }
  }

  return result;
}

/**
 * Load platform config from environment or file.
 * Returns a minimal config if none is configured.
 */
export function loadPlatformConfig(): PlatformConfig {
  const configJson = process.env.OPENCLAW_PLATFORM_CONFIG;
  if (configJson) {
    try {
      return JSON.parse(configJson) as PlatformConfig;
    } catch {
      console.warn('[Permissions] Failed to parse OPENCLAW_PLATFORM_CONFIG, using defaults');
    }
  }
  return { permissions: {} };
}
