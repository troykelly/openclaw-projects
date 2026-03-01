/**
 * One-time WebSocket ticket store for chat authentication (#1944).
 *
 * Tickets are short-lived (30s), single-use tokens exchanged via
 * POST /api/chat/ws/ticket (JWT-authenticated) and consumed on
 * GET /api/chat/ws (WebSocket upgrade). This avoids sending JWTs
 * in WebSocket query strings.
 *
 * Also tracks per-user connection counts to enforce limits.
 *
 * Epic #1940 — Agent Chat.
 */

import { randomBytes, randomUUID } from 'node:crypto';

/** Ticket TTL in milliseconds (30 seconds). */
export const TICKET_TTL_MS = 30_000;

/** Maximum concurrent WebSocket connections per user. */
export const MAX_CONNECTIONS_PER_USER = 5;

/** Data stored with each ticket. */
interface TicketData {
  userEmail: string;
  sessionId: string;
  createdAt: number;
}

/** In-memory ticket store. Key = ticket string. */
const tickets = new Map<string, TicketData>();

/** Per-user active connection tracking. Key = userEmail, Value = Set<connectionId>. */
const userConnections = new Map<string, Set<string>>();

/**
 * Create a one-time ticket for WebSocket authentication.
 * @param userEmail - The authenticated user's email
 * @param sessionId - The chat session ID to bind to
 * @returns The ticket string
 */
export function createTicket(userEmail: string, sessionId: string): string {
  const ticket = randomBytes(32).toString('hex');
  tickets.set(ticket, {
    userEmail,
    sessionId,
    createdAt: Date.now(),
  });
  return ticket;
}

/**
 * Consume a one-time ticket. Returns the ticket data if valid, null otherwise.
 * The ticket is deleted on first successful consumption (single-use).
 * @param ticket - The ticket string to consume
 * @returns Ticket data if valid and not expired, null otherwise
 */
export function consumeTicket(ticket: string): TicketData | null {
  const data = tickets.get(ticket);
  if (!data) return null;

  // Always delete — single use regardless of expiry
  tickets.delete(ticket);

  // Check TTL
  if (Date.now() - data.createdAt > TICKET_TTL_MS) {
    return null;
  }

  return data;
}

/**
 * Get the number of active WebSocket connections for a user.
 */
export function getActiveConnectionCount(userEmail: string): number {
  return userConnections.get(userEmail)?.size ?? 0;
}

/**
 * Register a new WebSocket connection for a user.
 * Returns the connection ID, or null if the user has reached the limit.
 */
export function addConnection(userEmail: string): string | null {
  let connections = userConnections.get(userEmail);
  if (!connections) {
    connections = new Set();
    userConnections.set(userEmail, connections);
  }

  if (connections.size >= MAX_CONNECTIONS_PER_USER) {
    return null;
  }

  const connectionId = randomUUID();
  connections.add(connectionId);
  return connectionId;
}

/**
 * Remove a WebSocket connection for a user.
 */
export function removeConnection(userEmail: string, connectionId: string): void {
  const connections = userConnections.get(userEmail);
  if (!connections) return;
  connections.delete(connectionId);
  if (connections.size === 0) {
    userConnections.delete(userEmail);
  }
}

/**
 * Reset all state (for testing).
 */
export function resetTicketStore(): void {
  tickets.clear();
  userConnections.clear();
}

/**
 * Clean up expired tickets. Called periodically to prevent memory leaks.
 */
export function cleanExpiredTickets(): number {
  const now = Date.now();
  let cleaned = 0;
  for (const [ticket, data] of tickets) {
    if (now - data.createdAt > TICKET_TTL_MS) {
      tickets.delete(ticket);
      cleaned++;
    }
  }
  return cleaned;
}
