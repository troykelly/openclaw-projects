/**
 * Types for milestones and checkpoints
 */

/**
 * Milestone status
 */
export type MilestoneStatus = 'upcoming' | 'in-progress' | 'completed' | 'missed';

/**
 * A milestone entity
 */
export interface Milestone {
  id: string;
  name: string;
  targetDate: string;
  description?: string;
  status: MilestoneStatus;
  projectId: string;
  progress: number;
  totalItems: number;
  completedItems: number;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Data for creating a milestone
 */
export interface CreateMilestoneData {
  name: string;
  targetDate: string;
  description?: string;
}

/**
 * Data for updating a milestone
 */
export interface UpdateMilestoneData {
  name?: string;
  targetDate?: string;
  description?: string;
}

/**
 * Props for MilestoneCard component
 */
export interface MilestoneCardProps {
  milestone: Milestone;
  onClick?: (milestone: Milestone) => void;
  className?: string;
}

/**
 * Props for MilestoneProgress component
 */
export interface MilestoneProgressProps {
  progress: number;
  status?: MilestoneStatus;
  isAtRisk?: boolean;
  className?: string;
}

/**
 * Props for MilestoneList component
 */
export interface MilestoneListProps {
  milestones: Milestone[];
  filterStatus?: MilestoneStatus;
  onMilestoneClick?: (milestone: Milestone) => void;
  onCreateClick?: () => void;
  className?: string;
}

/**
 * Props for MilestoneDialog component
 */
export interface MilestoneDialogProps {
  open: boolean;
  projectId: string;
  milestone?: Milestone;
  onSave: (data: CreateMilestoneData | UpdateMilestoneData) => void;
  onCancel: () => void;
}

/**
 * Return type for useMilestones hook
 */
export interface UseMilestonesReturn {
  milestones: Milestone[];
  loading: boolean;
  error: string | null;
  createMilestone: (data: CreateMilestoneData) => Promise<Milestone>;
  updateMilestone: (id: string, data: UpdateMilestoneData) => Promise<Milestone>;
  deleteMilestone: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Status display labels
 */
export const STATUS_LABELS: Record<MilestoneStatus, string> = {
  upcoming: 'Upcoming',
  'in-progress': 'In Progress',
  completed: 'Completed',
  missed: 'Missed',
};
