/**
 * Service call handler for the HA Connector.
 *
 * Receives NOTIFY payloads from the `ha_service_call` channel,
 * validates the payload, resolves the provider connection,
 * and forwards the call via the connection's sendServiceCall method.
 *
 * Issue #1637, parent #1603.
 */

import type { Connection } from '../api/geolocation/types.ts';
import type { ProviderLifecycleManager } from './lifecycle.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServiceCallResult {
  success: boolean;
  error?: string;
}

interface ServiceCallPayload {
  provider_id: string;
  domain: string;
  service: string;
  entity_id?: string;
  service_data?: Record<string, unknown>;
  request_id?: string;
}

/** Extended connection interface with service call support. */
interface ServiceCallConnection extends Connection {
  sendServiceCall(call: {
    domain: string;
    service: string;
    entity_id?: string;
    service_data?: Record<string, unknown>;
    request_id?: string;
  }): Promise<ServiceCallResult>;
}

// ---------------------------------------------------------------------------
// ServiceCallHandler
// ---------------------------------------------------------------------------

export class ServiceCallHandler {
  private lifecycle: ProviderLifecycleManager;

  constructor(lifecycle: ProviderLifecycleManager) {
    this.lifecycle = lifecycle;
  }

  /**
   * Handle an `ha_service_call` NOTIFY payload.
   *
   * Parses the JSON, validates required fields, resolves the provider
   * connection, and forwards the service call.
   */
  async handleNotification(raw: string): Promise<ServiceCallResult> {
    // 1. Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { success: false, error: 'Invalid JSON payload' };
    }

    // 2. Validate required fields
    const obj = parsed as Record<string, unknown>;

    if (!obj.provider_id || typeof obj.provider_id !== 'string') {
      return { success: false, error: 'Missing required field: provider_id' };
    }
    if (!obj.domain || typeof obj.domain !== 'string') {
      return { success: false, error: 'Missing required field: domain' };
    }
    if (!obj.service || typeof obj.service !== 'string') {
      return { success: false, error: 'Missing required field: service' };
    }

    const payload: ServiceCallPayload = {
      provider_id: obj.provider_id,
      domain: obj.domain,
      service: obj.service,
      ...(typeof obj.entity_id === 'string' ? { entity_id: obj.entity_id } : {}),
      ...(obj.service_data && typeof obj.service_data === 'object'
        ? { service_data: obj.service_data as Record<string, unknown> }
        : {}),
      ...(typeof obj.request_id === 'string' ? { request_id: obj.request_id } : {}),
    };

    // 3. Resolve provider connection
    const conn = this.lifecycle.getConnection(payload.provider_id);
    if (!conn) {
      return { success: false, error: `Provider ${payload.provider_id} is not connected` };
    }

    // 4. Forward the service call
    const serviceConn = conn as unknown as ServiceCallConnection;
    if (typeof serviceConn.sendServiceCall === 'function') {
      return serviceConn.sendServiceCall({
        domain: payload.domain,
        service: payload.service,
        entity_id: payload.entity_id,
        service_data: payload.service_data,
        request_id: payload.request_id,
      });
    }

    return { success: true };
  }
}
