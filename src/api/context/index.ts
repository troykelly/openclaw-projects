/**
 * Context retrieval module.
 * Part of Epic #235 - Issue #251.
 * Graph-aware retrieval added in Issue #496.
 */

export {
  retrieveContext,
  validateContextInput,
  type ContextRetrievalInput,
  type ContextRetrievalResult,
  type ContextSources,
  type ContextMetadata,
  type MemorySource,
  type ProjectSource,
  type TodoSource,
} from './service.ts';

export {
  retrieveGraphAwareContext,
  collectGraphScopes,
  type ScopeType,
  type ScopeDetail,
  type GraphScope,
  type GraphTraversalOptions,
  type GraphAwareContextInput,
  type ScopedMemoryResult,
  type GraphContextMetadata,
  type GraphAwareContextResult,
} from './graph-aware-service.ts';
