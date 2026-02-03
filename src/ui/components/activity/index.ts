/**
 * Activity timeline components
 * Issue #396: Implement contact activity timeline
 */
export { ActivityCard } from './activity-card';
export type { ActivityCardProps } from './activity-card';
export { ActivityTimeline } from './activity-timeline';
export type { ActivityTimelineProps } from './activity-timeline';
export { ActivityFilter } from './activity-filter';
export type { ActivityFilterProps } from './activity-filter';
export { ActivityStats } from './activity-stats';
export type { ActivityStatsProps } from './activity-stats';
export { ContactActivitySection } from './contact-activity-section';
export type { ContactActivitySectionProps } from './contact-activity-section';
export type {
  Activity,
  ActivityType,
  ActivitySourceType,
  ActivityGroup,
  DateRange,
  ActivityStatistics,
} from './types';
export {
  groupActivitiesByDate,
  getActivityIcon,
  getActivityLabel,
  calculateStats,
  formatTimestamp,
  FILTER_CATEGORIES,
} from './activity-utils';
