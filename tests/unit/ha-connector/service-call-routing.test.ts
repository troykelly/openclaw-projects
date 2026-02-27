import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('HA service call routing', () => {
  it('run.ts routes ha_service_call channel to ServiceCallHandler', () => {
    const runContent = readFileSync('src/ha-connector/run.ts', 'utf8');

    // Should import ServiceCallHandler
    expect(runContent).toContain("import { ServiceCallHandler } from './service-calls.ts'");

    // Should instantiate ServiceCallHandler
    expect(runContent).toContain('new ServiceCallHandler(lifecycle)');

    // Should check for ha_service_call channel in onNotification
    expect(runContent).toContain("channel === 'ha_service_call'");

    // Should call serviceCallHandler.handleNotification
    expect(runContent).toContain('serviceCallHandler.handleNotification(payload)');
  });

  it('NotifyListener callback passes channel and payload', () => {
    const listenerContent = readFileSync('src/worker/listener.ts', 'utf8');

    // Callback should accept channel and payload parameters
    expect(listenerContent).toMatch(/onNotification:\s*\(channel:\s*string,\s*payload:\s*string\)/);

    // Notification handler should pass msg.channel and msg.payload
    expect(listenerContent).toContain('msg.channel');
    expect(listenerContent).toContain('msg.payload');
  });
});
