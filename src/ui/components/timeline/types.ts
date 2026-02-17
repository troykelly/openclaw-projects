export type TimelineZoom = 'day' | 'week' | 'month' | 'quarter';

export type TimelineItemKind = 'project' | 'initiative' | 'epic' | 'issue';

export type TimelineItemStatus = 'not_started' | 'in_progress' | 'blocked' | 'done';

export interface TimelineItem {
  id: string;
  title: string;
  kind: TimelineItemKind;
  status: TimelineItemStatus;
  startDate: Date;
  endDate: Date;
  parent_id?: string;
  progress?: number; // 0-100
  dependencies?: string[]; // IDs of items this depends on
  isCriticalPath?: boolean;
}

export interface TimelineDependency {
  fromId: string;
  toId: string;
}

export interface TimelineViewState {
  zoom: TimelineZoom;
  scrollLeft: number;
  showCriticalPath: boolean;
  showDependencies: boolean;
}

export interface TimelineDateRange {
  start: Date;
  end: Date;
}
