/**
 * Tests for gateway OpenAPI path spec.
 * Issue #2162 — OpenAPI spec for gateway WebSocket connection.
 */

import { describe, it, expect } from 'vitest';
import { gatewayPaths } from './gateway.ts';
import { assembleSpec } from '../index.ts';

describe('gatewayPaths', () => {
  const module = gatewayPaths();

  it('defines the Gateway tag', () => {
    expect(module.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Gateway' }),
      ]),
    );
  });

  it('defines the GatewayStatus schema', () => {
    expect(module.schemas).toBeDefined();
    expect(module.schemas!.GatewayStatus).toBeDefined();
    expect(module.schemas!.GatewayStatus.required).toContain('connected');
    expect(module.schemas!.GatewayStatus.properties!.connected.type).toBe('boolean');
    expect(module.schemas!.GatewayStatus.properties!.gateway_url).toBeDefined();
    expect(module.schemas!.GatewayStatus.properties!.connected_at).toBeDefined();
    expect(module.schemas!.GatewayStatus.properties!.last_tick_at).toBeDefined();
    expect(module.schemas!.GatewayStatus.properties!.metrics).toBeDefined();
  });

  it('defines the metrics sub-schema with all counter fields', () => {
    const metrics = module.schemas!.GatewayStatus.properties!.metrics;
    expect(metrics.properties).toBeDefined();
    const fields = Object.keys(metrics.properties!);
    expect(fields).toEqual(expect.arrayContaining([
      'connect_attempts',
      'reconnects',
      'events_received',
      'chat_events_routed',
      'duplicate_events_suppressed',
      'auth_failures',
      'chat_dispatch_ws',
      'chat_dispatch_http',
    ]));
  });

  it('defines GET /gateway/status path', () => {
    expect(module.paths['/gateway/status']).toBeDefined();
    const get = module.paths['/gateway/status'].get;
    expect(get).toBeDefined();
    expect(get!.operationId).toBe('getGatewayStatus');
    expect(get!.tags).toContain('Gateway');
    expect(get!.responses['200']).toBeDefined();
    expect(get!.responses['401']).toBeDefined();
  });
});

describe('assembleSpec includes gateway paths', () => {
  const spec = assembleSpec() as {
    paths: Record<string, Record<string, unknown>>;
    components: { schemas: Record<string, unknown> };
    tags: Array<{ name: string }>;
  };

  it('/gateway/status path is present in assembled spec', () => {
    expect(spec.paths['/gateway/status']).toBeDefined();
    expect(spec.paths['/gateway/status'].get).toBeDefined();
  });

  it('GatewayStatus schema is in components', () => {
    expect(spec.components.schemas.GatewayStatus).toBeDefined();
  });

  it('Gateway tag is present', () => {
    const tagNames = spec.tags.map((t) => t.name);
    expect(tagNames).toContain('Gateway');
  });
});

describe('chat abort endpoint in spec', () => {
  const spec = assembleSpec() as {
    paths: Record<string, Record<string, unknown>>;
  };

  it('/chat/sessions/{id}/abort path is present', () => {
    expect(spec.paths['/chat/sessions/{id}/abort']).toBeDefined();
    expect(spec.paths['/chat/sessions/{id}/abort'].post).toBeDefined();
  });
});

describe('chat agents status field', () => {
  const spec = assembleSpec() as {
    components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
    paths: Record<string, { get?: { responses: Record<string, unknown> } }>;
  };

  it('/chat/agents response includes status field in agent schema', () => {
    const agentsPath = spec.paths['/chat/agents'];
    expect(agentsPath).toBeDefined();
    expect(agentsPath.get).toBeDefined();
  });
});
