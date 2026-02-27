import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('HA WebSocket reconnect', () => {
  it('initial close handler should always schedule reconnect', () => {
    const haContent = readFileSync('src/api/geolocation/providers/home-assistant.ts', 'utf8');

    // The close handler for the initial WS connection should NOT check ctx.attempt > 0
    // because after successful auth, attempt is reset to 0, preventing reconnection.
    const closeHandlerMatch = haContent.match(
      /ws\.on\('close',\s*\(\)\s*=>\s*\{[^}]*ctx\.attempt\s*>\s*0/
    );
    expect(closeHandlerMatch).toBeNull();
  });
});
