/**
 * Context extraction utilities for OpenClaw plugin.
 * Extracts user, agent, and session context from the OpenClaw runtime.
 */

/** User identity information */
export interface UserContext {
  /** Unique user identifier */
  userId: string
  /** User display name (if available) */
  displayName?: string
  /** User email (if available) */
  email?: string
}

/** Agent information */
export interface AgentContext {
  /** Agent identifier */
  agentId: string
  /** Agent name */
  name: string
  /** Agent version */
  version?: string
}

/** Session information */
export interface SessionContext {
  /** Session identifier */
  sessionId: string
  /** Session start timestamp */
  startedAt: Date
  /** Conversation thread ID (if part of a thread) */
  threadId?: string
}

/** Combined context from all sources */
export interface PluginContext {
  user?: UserContext
  agent: AgentContext
  session: SessionContext
}

/**
 * Extracts user context from OpenClaw runtime context.
 * Returns undefined if user information is not available.
 */
export function extractUserContext(runtimeContext: unknown): UserContext | undefined {
  if (!runtimeContext || typeof runtimeContext !== 'object') {
    return undefined
  }

  const ctx = runtimeContext as Record<string, unknown>
  const user = ctx.user as Record<string, unknown> | undefined

  if (!user || typeof user.id !== 'string') {
    return undefined
  }

  return {
    userId: user.id,
    displayName: typeof user.displayName === 'string' ? user.displayName : undefined,
    email: typeof user.email === 'string' ? user.email : undefined,
  }
}

/**
 * Extracts agent context from OpenClaw runtime context.
 */
export function extractAgentContext(runtimeContext: unknown): AgentContext {
  const defaultAgent: AgentContext = {
    agentId: 'unknown',
    name: 'Unknown Agent',
  }

  if (!runtimeContext || typeof runtimeContext !== 'object') {
    return defaultAgent
  }

  const ctx = runtimeContext as Record<string, unknown>
  const agent = ctx.agent as Record<string, unknown> | undefined

  if (!agent) {
    return defaultAgent
  }

  return {
    agentId: typeof agent.id === 'string' ? agent.id : 'unknown',
    name: typeof agent.name === 'string' ? agent.name : 'Unknown Agent',
    version: typeof agent.version === 'string' ? agent.version : undefined,
  }
}

/**
 * Extracts session context from OpenClaw runtime context.
 */
export function extractSessionContext(runtimeContext: unknown): SessionContext {
  const defaultSession: SessionContext = {
    sessionId: crypto.randomUUID(),
    startedAt: new Date(),
  }

  if (!runtimeContext || typeof runtimeContext !== 'object') {
    return defaultSession
  }

  const ctx = runtimeContext as Record<string, unknown>
  const session = ctx.session as Record<string, unknown> | undefined

  if (!session) {
    return defaultSession
  }

  return {
    sessionId: typeof session.id === 'string' ? session.id : crypto.randomUUID(),
    startedAt:
      session.startedAt instanceof Date
        ? session.startedAt
        : typeof session.startedAt === 'string'
          ? new Date(session.startedAt)
          : new Date(),
    threadId: typeof session.threadId === 'string' ? session.threadId : undefined,
  }
}

/**
 * Extracts complete plugin context from OpenClaw runtime.
 */
export function extractContext(runtimeContext: unknown): PluginContext {
  return {
    user: extractUserContext(runtimeContext),
    agent: extractAgentContext(runtimeContext),
    session: extractSessionContext(runtimeContext),
  }
}

/** Allowed characters in session keys: alphanumeric, colon, hyphen, underscore */
const SESSION_KEY_REGEX = /^[a-zA-Z0-9:_-]+$/

/** Maximum length for session keys */
const MAX_SESSION_KEY_LENGTH = 500

/**
 * Validates a session key format.
 * - Max length: 500 characters
 * - Allowed characters: alphanumeric, colon, hyphen, underscore
 */
export function validateSessionKey(sessionKey: string | null | undefined): boolean {
  if (!sessionKey || sessionKey.length === 0) {
    return false
  }
  if (sessionKey.length > MAX_SESSION_KEY_LENGTH) {
    return false
  }
  return SESSION_KEY_REGEX.test(sessionKey)
}

/**
 * Parse agentId from session key.
 * Session key format: agent:<agentId>:<channel>:...
 * Returns "unknown" for invalid or missing keys.
 */
export function parseAgentIdFromSessionKey(sessionKey: string | null | undefined): string {
  if (!sessionKey || sessionKey.length === 0) {
    return 'unknown'
  }

  // Validate session key format first
  if (!validateSessionKey(sessionKey)) {
    return 'unknown'
  }

  // Parse format: agent:<agentId>:<channel>:...
  const parts = sessionKey.split(':')
  if (parts.length < 3 || parts[0] !== 'agent') {
    return 'unknown'
  }

  const agentId = parts[1]
  if (!agentId || agentId.length === 0) {
    return 'unknown'
  }

  return agentId
}

/** Context for user scoping */
export interface ScopingContext {
  /** Agent ID for agent-level scoping */
  agentId: string
  /** Full session key for session-level isolation */
  sessionKey?: string
  /** External sender ID */
  senderId?: string
  /** Communication channel */
  channel?: string
  /** Canonical identity key for cross-agent queries */
  identityKey?: string
}

/**
 * Get the user scope key based on configured scoping mode.
 * @param context - User scoping context
 * @param scopeMode - "agent" | "identity" | "session"
 * @returns Scope key to pass to backend API
 */
export function getUserScopeKey(
  context: ScopingContext,
  scopeMode: 'agent' | 'identity' | 'session'
): string {
  switch (scopeMode) {
    case 'agent':
      return context.agentId || 'unknown'

    case 'identity':
      // Prefer identity key if available, fall back to agent
      return context.identityKey || context.agentId || 'unknown'

    case 'session':
      // Prefer full session key if available, fall back to agent
      return context.sessionKey || context.agentId || 'unknown'

    default:
      return context.agentId || 'unknown'
  }
}
