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
