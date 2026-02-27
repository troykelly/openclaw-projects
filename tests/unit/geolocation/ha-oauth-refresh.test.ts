import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('HA OAuth refresh', () => {
  it('uses PUBLIC_BASE_URL for clientId, not HA origin', () => {
    const haContent = readFileSync('src/api/geolocation/providers/home-assistant.ts', 'utf8');

    // Extract the connect() method of the plugin (where refreshCb is assigned)
    const connectMethodMatch = haContent.match(
      /connect\(\s*config:\s*ProviderConfig[\s\S]*?return connectWs\(config/
    );
    expect(connectMethodMatch).not.toBeNull();
    const connectMethod = connectMethodMatch![0];

    // Should reference PUBLIC_BASE_URL for clientId consistency
    expect(connectMethod).toContain('PUBLIC_BASE_URL');
    // Should NOT use HA baseUrl origin as clientId
    expect(connectMethod).not.toMatch(/new URL\(baseUrl\)\.origin/);
  });
});
