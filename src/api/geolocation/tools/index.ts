/**
 * Barrel export for Home Assistant OpenClaw agent tools.
 *
 * These tool definitions are designed for registration in the OpenClaw
 * gateway plugin system, enabling LLM agents to query and manage
 * HA observations, routines, and anomalies.
 *
 * Issue #1462, Epic #1440.
 */

// Observations
export {
  HA_OBSERVATIONS_QUERY_TOOL,
  executeObservationsQuery,
  type HaObservationsQueryParams,
  type HaObservationsQueryResponse,
  type ObservationResult,
} from './ha-observations-tool.ts';

// Routines
export {
  HA_ROUTINES_LIST_TOOL,
  HA_ROUTINE_UPDATE_TOOL,
  executeRoutinesList,
  executeRoutineUpdate,
  type HaRoutinesListParams,
  type HaRoutineUpdateParams,
  type HaRoutinesListResponse,
  type HaRoutineUpdateResponse,
  type RoutineResult,
} from './ha-routines-tool.ts';

// Anomalies
export {
  HA_ANOMALIES_LIST_TOOL,
  HA_ANOMALY_RESOLVE_TOOL,
  executeAnomaliesList,
  executeAnomalyResolve,
  type HaAnomaliesListParams,
  type HaAnomalyResolveParams,
  type HaAnomaliesListResponse,
  type HaAnomalyResolveResponse,
  type AnomalyResult,
} from './ha-anomalies-tool.ts';

/** All HA tool definitions for bulk registration. */
export { HA_OBSERVATIONS_QUERY_TOOL as observationsQueryTool } from './ha-observations-tool.ts';
export { HA_ROUTINES_LIST_TOOL as routinesListTool } from './ha-routines-tool.ts';
export { HA_ROUTINE_UPDATE_TOOL as routineUpdateTool } from './ha-routines-tool.ts';
export { HA_ANOMALIES_LIST_TOOL as anomaliesListTool } from './ha-anomalies-tool.ts';
export { HA_ANOMALY_RESOLVE_TOOL as anomalyResolveTool } from './ha-anomalies-tool.ts';
