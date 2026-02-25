/**
 * Parse SSH config text into connection definitions.
 *
 * Handles the common Host/Hostname/User/Port/IdentityFile/ProxyJump directives.
 * Ignores wildcards and unsupported directives.
 */

export interface ParsedSSHHost {
  name: string;
  host: string | null;
  port: number;
  username: string | null;
  identityFile: string | null;
  proxyJump: string | null;
}

/**
 * Parse SSH config text (contents of ~/.ssh/config) into connection entries.
 * Skips wildcard hosts (e.g., Host *).
 */
export function parseSSHConfig(configText: string): ParsedSSHHost[] {
  const lines = configText.split('\n');
  const hosts: ParsedSSHHost[] = [];
  let current: ParsedSSHHost | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith('#')) continue;

    // Parse key-value pair
    const match = line.match(/^(\S+)\s+(.+)$/);
    if (!match) continue;

    const [, key, value] = match;
    const keyLower = key.toLowerCase();

    if (keyLower === 'host') {
      // Save previous host if any
      if (current) {
        hosts.push(current);
      }

      // Skip wildcards
      if (value.includes('*') || value.includes('?')) {
        current = null;
        continue;
      }

      current = {
        name: value.trim(),
        host: null,
        port: 22,
        username: null,
        identityFile: null,
        proxyJump: null,
      };
      continue;
    }

    // Only process directives inside a Host block
    if (!current) continue;

    switch (keyLower) {
      case 'hostname':
        current.host = value.trim();
        break;
      case 'user':
        current.username = value.trim();
        break;
      case 'port':
        current.port = parseInt(value.trim(), 10) || 22;
        break;
      case 'identityfile':
        current.identityFile = value.trim();
        break;
      case 'proxyjump':
        current.proxyJump = value.trim();
        break;
    }
  }

  // Don't forget last host
  if (current) {
    hosts.push(current);
  }

  return hosts;
}
