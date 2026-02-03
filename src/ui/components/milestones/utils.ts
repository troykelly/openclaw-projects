/**
 * Utility functions for milestones
 */
import type { MilestoneStatus } from './types';

/**
 * Calculate milestone status based on progress and target date
 */
export function calculateMilestoneStatus(
  progress: number,
  targetDate: string
): MilestoneStatus {
  // Completed if progress is 100%
  if (progress >= 1) {
    return 'completed';
  }

  const now = new Date();
  const target = new Date(targetDate);

  // Missed if past target date and not completed
  if (target < now) {
    return 'missed';
  }

  // In progress if has any progress
  if (progress > 0) {
    return 'in-progress';
  }

  // Upcoming if no progress and in future
  return 'upcoming';
}

/**
 * Format a date for display
 */
export function formatMilestoneDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Check if milestone is at risk (low progress with approaching deadline)
 */
export function isMilestoneAtRisk(
  progress: number,
  targetDate: string,
  thresholdDays = 7
): boolean {
  const now = new Date();
  const target = new Date(targetDate);
  const daysUntilTarget = Math.ceil(
    (target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  // At risk if less than threshold days remaining and progress is less than expected
  if (daysUntilTarget <= thresholdDays && daysUntilTarget > 0) {
    // Expected progress based on time elapsed (rough estimate)
    const expectedProgress = 1 - daysUntilTarget / 30; // assuming 30-day milestone
    return progress < expectedProgress * 0.8; // 80% of expected
  }

  return false;
}

/**
 * Get color class for milestone status
 */
export function getMilestoneStatusColor(
  status: MilestoneStatus,
  isAtRisk: boolean
): string {
  if (isAtRisk && status !== 'completed' && status !== 'missed') {
    return 'yellow';
  }

  switch (status) {
    case 'completed':
      return 'green';
    case 'missed':
      return 'red';
    case 'in-progress':
      return 'blue';
    case 'upcoming':
    default:
      return 'green';
  }
}
