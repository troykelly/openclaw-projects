/**
 * Dashboard components
 * Issue #405: Implement custom dashboard builder
 */
export { DashboardGrid } from './dashboard-grid';
export type { DashboardGridProps } from './dashboard-grid';
export { DashboardWidget } from './dashboard-widget';
export type { DashboardWidgetProps } from './dashboard-widget';
export { WidgetPicker } from './widget-picker';
export type { WidgetPickerProps } from './widget-picker';
export type {
  Widget,
  WidgetType,
  WidgetConfig,
  DashboardLayout,
  WidgetTypeInfo,
} from './types';
export { WIDGET_TYPES, getWidgetTypeInfo } from './types';

// Re-export widgets
export * from './widgets';
