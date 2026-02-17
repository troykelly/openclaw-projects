/**
 * Utility functions for workload and resource allocation
 * Issue #392: Implement resource allocation and workload view
 */

/**
 * Team member with capacity information
 */
export interface TeamMember {
  id: string;
  name: string;
  hoursPerWeek: number;
  avatar?: string;
  email?: string;
}

/**
 * A work assignment to a team member
 */
export interface WorkAssignment {
  id: string;
  title: string;
  member_id: string;
  hours: number;
  startDate?: string;
  endDate?: string;
  color?: string;
}

/**
 * Summary of workload for a team member
 */
export interface WorkloadSummary {
  member_id: string;
  totalHours: number;
  capacityHours: number;
  utilizationPercent: number;
  isOverallocated: boolean;
  availableHours: number;
}

/**
 * Calculate utilization percentage
 * @returns Percentage (0-100+)
 */
export function calculateUtilization(assignedHours: number, capacityHours: number): number {
  if (capacityHours === 0) {
    return Infinity;
  }
  return (assignedHours / capacityHours) * 100;
}

/**
 * Calculate total workload per team member
 * @returns Map of member_id -> total hours
 */
export function calculateWorkload(assignments: WorkAssignment[]): Map<string, number> {
  const workload = new Map<string, number>();

  for (const assignment of assignments) {
    const current = workload.get(assignment.member_id) || 0;
    workload.set(assignment.member_id, current + assignment.hours);
  }

  return workload;
}

/**
 * Detect which team members are over-allocated
 * @returns Array of member IDs that are over their capacity
 */
export function detectOverallocation(members: TeamMember[], workload: Map<string, number>): string[] {
  const overallocated: string[] = [];

  for (const member of members) {
    const hours = workload.get(member.id) || 0;
    if (hours > member.hoursPerWeek) {
      overallocated.push(member.id);
    }
  }

  return overallocated;
}

/**
 * Format hours for display
 */
export function formatHours(hours: number): string {
  // Round to one decimal place
  const rounded = Math.round(hours * 10) / 10;
  // Remove trailing .0
  const formatted = rounded % 1 === 0 ? rounded.toString() : rounded.toFixed(1);
  return `${formatted}h`;
}

/**
 * Get utilization status for styling
 */
export function getUtilizationStatus(utilizationPercent: number): 'low' | 'medium' | 'high' {
  if (utilizationPercent > 100) {
    return 'high';
  }
  if (utilizationPercent >= 80) {
    return 'medium';
  }
  return 'low';
}

/**
 * Calculate workload summary for a team member
 */
export function getWorkloadSummary(member: TeamMember, assignments: WorkAssignment[]): WorkloadSummary {
  const memberAssignments = assignments.filter((a) => a.member_id === member.id);
  const totalHours = memberAssignments.reduce((sum, a) => sum + a.hours, 0);
  const utilizationPercent = calculateUtilization(totalHours, member.hoursPerWeek);
  const isOverallocated = utilizationPercent > 100;
  const availableHours = Math.max(0, member.hoursPerWeek - totalHours);

  return {
    member_id: member.id,
    totalHours,
    capacityHours: member.hoursPerWeek,
    utilizationPercent,
    isOverallocated,
    availableHours,
  };
}
