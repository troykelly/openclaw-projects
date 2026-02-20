/**
 * Voice conversation WebSocket hub.
 * Manages WebSocket connections and routes voice conversation messages.
 *
 * Issue #1432 — WebSocket conversation endpoint.
 * Epic #1431.
 */

import type { WebSocket } from 'ws';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type {
  ClientMessage,
  ConversationTextMessage,
  EntityContextMessage,
  EntityInfo,
  AreaInfo,
  ServiceCallResultMessage,
  ServerMessage,
  VoiceConversationRow,
  VoiceMessageRow,
  ServiceCall,
} from './types.ts';
import { WS_HEARTBEAT_INTERVAL_MS, WS_STALE_THRESHOLD_MS } from './types.ts';
import { resolveAgent, getAgentResponse } from './routing.ts';
import { validateServiceCalls, getServiceAllowlist } from './service-calls.ts';

/** Internal representation of a connected voice WebSocket client. */
interface VoiceClient {
  client_id: string;
  socket: WebSocket;
  user_email: string | null;
  namespace: string;
  connected_at: Date;
  last_ping: Date;
  /** Entity context synced from the client (e.g., HA entities). */
  entity_context: EntityInfo[];
  /** Area context synced from the client. */
  area_context: AreaInfo[];
}

/**
 * Voice conversation hub — manages WebSocket connections and conversation routing.
 */
export class VoiceConversationHub {
  private clients: Map<string, VoiceClient> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /** Start the heartbeat interval for stale connection detection. */
  start(): void {
    this.heartbeatInterval = setInterval(() => {
      this.checkStaleClients();
    }, WS_HEARTBEAT_INTERVAL_MS);
  }

  /** Shut down the hub and close all connections. */
  async shutdown(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    for (const client of this.clients.values()) {
      client.socket.close(1001, 'Server shutdown');
    }
    this.clients.clear();
  }

  /** Add a new WebSocket client. Returns the client_id. */
  addClient(socket: WebSocket, namespace: string, user_email: string | null): string {
    const client_id = randomUUID();
    const now = new Date();

    const client: VoiceClient = {
      client_id,
      socket,
      user_email,
      namespace,
      connected_at: now,
      last_ping: now,
      entity_context: [],
      area_context: [],
    };

    this.clients.set(client_id, client);

    this.sendToClient(client_id, {
      type: 'connection.established',
      client_id,
    });

    socket.on('message', (data: Buffer) => {
      this.handleMessage(client_id, data).catch((err) => {
        console.error(`[VoiceHub] Error handling message from ${client_id}:`, err);
      });
    });

    socket.on('close', () => {
      this.clients.delete(client_id);
    });

    socket.on('error', (err: Error) => {
      console.error(`[VoiceHub] Client ${client_id} error:`, err);
      this.clients.delete(client_id);
    });

    return client_id;
  }

  /** Get the number of connected clients. */
  getClientCount(): number {
    return this.clients.size;
  }

  /** Send a message to a specific client. */
  sendToClient(client_id: string, message: ServerMessage): boolean {
    const client = this.clients.get(client_id);
    if (!client) return false;

    try {
      if (client.socket.readyState === 1) {
        client.socket.send(JSON.stringify(message));
        return true;
      }
    } catch (err) {
      console.error(`[VoiceHub] Error sending to client ${client_id}:`, err);
    }
    return false;
  }

  /** Handle an incoming WebSocket message. */
  private async handleMessage(client_id: string, raw: Buffer): Promise<void> {
    const client = this.clients.get(client_id);
    if (!client) return;

    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      this.sendToClient(client_id, {
        type: 'conversation.error',
        conversation_id: '',
        error: 'parse_error',
        message: 'Invalid JSON message',
      });
      return;
    }

    if (!message.type) {
      this.sendToClient(client_id, {
        type: 'conversation.error',
        conversation_id: '',
        error: 'invalid_message',
        message: 'Message must include a "type" field',
      });
      return;
    }

    switch (message.type) {
      case 'conversation.text':
        await this.handleConversationText(client_id, client, message);
        break;
      case 'context.entities':
        this.handleEntityContext(client, message);
        break;
      case 'service_call.result':
        await this.handleServiceCallResult(client, message);
        break;
      case 'pong':
        client.last_ping = new Date();
        break;
      default:
        this.sendToClient(client_id, {
          type: 'conversation.error',
          conversation_id: '',
          error: 'unknown_type',
          message: `Unknown message type: ${(message as { type: string }).type}`,
        });
    }
  }

  /** Handle a conversation text message. */
  private async handleConversationText(
    client_id: string,
    client: VoiceClient,
    message: ConversationTextMessage,
  ): Promise<void> {
    const { namespace } = client;

    // Resolve or create conversation
    let conversation_id = message.conversation_id;
    if (conversation_id) {
      // Verify conversation exists and belongs to this namespace
      const existing = await this.pool.query<VoiceConversationRow>(
        'SELECT id FROM voice_conversation WHERE id = $1 AND namespace = $2',
        [conversation_id, namespace],
      );
      if (existing.rows.length === 0) {
        this.sendToClient(client_id, {
          type: 'conversation.error',
          conversation_id,
          error: 'not_found',
          message: 'Conversation not found',
        });
        return;
      }
      // Update last_active_at
      await this.pool.query(
        'UPDATE voice_conversation SET last_active_at = NOW() WHERE id = $1',
        [conversation_id],
      );
    } else {
      // Create new conversation
      const result = await this.pool.query<VoiceConversationRow>(
        `INSERT INTO voice_conversation (namespace, agent_id, device_id, user_email)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [namespace, message.agent_id ?? null, null, client.user_email],
      );
      conversation_id = result.rows[0].id;
    }

    // Store the user message
    await this.pool.query(
      `INSERT INTO voice_message (conversation_id, role, text)
       VALUES ($1, 'user', $2)`,
      [conversation_id, message.text],
    );

    // Resolve which agent to route to
    const routing = await resolveAgent(
      this.pool,
      namespace,
      message.agent_id,
      undefined,
      client.user_email,
    );

    // Get response from agent (via OpenClaw gateway)
    try {
      const response = await getAgentResponse(
        this.pool,
        routing,
        message.text,
        conversation_id,
        namespace,
        {
          language: message.language,
          context: message.context,
          entities: client.entity_context.length > 0 ? client.entity_context : undefined,
          areas: client.area_context.length > 0 ? client.area_context : undefined,
        },
      );

      // Validate service calls if present
      let validatedServiceCalls: ServiceCall[] | undefined;
      if (response.service_calls && response.service_calls.length > 0) {
        const allowlist = await getServiceAllowlist(this.pool, namespace);
        validatedServiceCalls = validateServiceCalls(response.service_calls, allowlist);
      }

      // Store the assistant message
      await this.pool.query(
        `INSERT INTO voice_message (conversation_id, role, text, service_calls)
         VALUES ($1, 'assistant', $2, $3)`,
        [conversation_id, response.text, validatedServiceCalls ? JSON.stringify(validatedServiceCalls) : null],
      );

      this.sendToClient(client_id, {
        type: 'conversation.response',
        conversation_id,
        text: response.text,
        continue_conversation: response.continue_conversation,
        service_calls: validatedServiceCalls,
      });
    } catch (err) {
      console.error(`[VoiceHub] Agent routing error for conversation ${conversation_id}:`, err);
      this.sendToClient(client_id, {
        type: 'conversation.error',
        conversation_id,
        error: 'agent_error',
        message: err instanceof Error ? err.message : 'Failed to get agent response',
      });
    }
  }

  /** Handle entity context sync from client. */
  private handleEntityContext(client: VoiceClient, message: EntityContextMessage): void {
    client.entity_context = message.entities;
    if (message.areas) {
      client.area_context = message.areas;
    }
  }

  /** Handle service call result acknowledgment. */
  private async handleServiceCallResult(
    client: VoiceClient,
    message: ServiceCallResultMessage,
  ): Promise<void> {
    // Verify conversation exists
    const result = await this.pool.query<VoiceMessageRow>(
      `SELECT id, service_calls FROM voice_message
       WHERE conversation_id = $1 AND role = 'assistant' AND service_calls IS NOT NULL
       ORDER BY timestamp DESC LIMIT 1`,
      [message.conversation_id],
    );

    if (result.rows.length > 0) {
      const msgRow = result.rows[0];
      const calls = msgRow.service_calls;
      if (calls && calls[message.call_index]) {
        // Store result in the service call data
        const updatedCalls = [...calls];
        updatedCalls[message.call_index] = {
          ...updatedCalls[message.call_index],
          result: {
            success: message.success,
            error: message.error,
            data: message.result,
          },
        } as ServiceCall & { result: unknown };

        await this.pool.query(
          'UPDATE voice_message SET service_calls = $1 WHERE id = $2',
          [JSON.stringify(updatedCalls), msgRow.id],
        );
      }
    }
  }

  /** Check for and remove stale connections. */
  private checkStaleClients(): void {
    const now = new Date();

    for (const [client_id, client] of this.clients.entries()) {
      const timeSinceLastPing = now.getTime() - client.last_ping.getTime();
      if (timeSinceLastPing > WS_STALE_THRESHOLD_MS) {
        console.log(`[VoiceHub] Removing stale client ${client_id}`);
        client.socket.close(1001, 'Connection timeout');
        this.clients.delete(client_id);
        continue;
      }

      // Send ping
      this.sendToClient(client_id, {
        type: 'ping',
        timestamp: now.toISOString(),
      });
    }
  }
}
