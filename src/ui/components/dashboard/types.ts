/**
 * Types for custom dashboard builder
 * Issue #405: Implement custom dashboard builder
 */

export type WidgetType = 'my-tasks' | 'upcoming-due' | 'activity' | 'stats' | 'quick-actions' | 'calendar' | 'notifications';

export interface Widget {
  id: string;
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
  config?: WidgetConfig;
}

export interface WidgetConfig {
  title?: string;
  limit?: number;
  filters?: Record<string, unknown>;
}

export interface DashboardLayout {
  id: string;
  name: string;
  widgets: Widget[];
  isDefault?: boolean;
}

export interface WidgetTypeInfo {
  type: WidgetType;
  name: string;
  description: string;
  icon: string;
  minW: number;
  minH: number;
  maxW?: number;
  maxH?: number;
}

export const WIDGET_TYPES: WidgetTypeInfo[] = [
  {
    type: 'my-tasks',
    name: 'My Tasks',
    description: 'Items assigned to you',
    icon: 'CheckSquare',
    minW: 2,
    minH: 2,
  },
  {
    type: 'upcoming-due',
    name: 'Upcoming Due',
    description: 'Items due soon or overdue',
    icon: 'Calendar',
    minW: 2,
    minH: 2,
  },
  {
    type: 'activity',
    name: 'Activity',
    description: 'Recent activity stream',
    icon: 'Activity',
    minW: 2,
    minH: 2,
  },
  {
    type: 'stats',
    name: 'Statistics',
    description: 'Overview statistics',
    icon: 'BarChart',
    minW: 2,
    minH: 1,
  },
  {
    type: 'quick-actions',
    name: 'Quick Actions',
    description: 'Common actions',
    icon: 'Zap',
    minW: 1,
    minH: 1,
  },
  {
    type: 'notifications',
    name: 'Notifications',
    description: 'Unread notifications',
    icon: 'Bell',
    minW: 2,
    minH: 2,
  },
];

export function getWidgetTypeInfo(type: WidgetType): WidgetTypeInfo | undefined {
  return WIDGET_TYPES.find((w) => w.type === type);
}
