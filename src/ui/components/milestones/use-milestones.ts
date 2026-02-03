/**
 * Hook for managing milestones via API
 */
import * as React from 'react';
import type {
  Milestone,
  CreateMilestoneData,
  UpdateMilestoneData,
  UseMilestonesReturn,
} from './types';

export function useMilestones(projectId: string): UseMilestonesReturn {
  const [milestones, setMilestones] = React.useState<Milestone[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchMilestones = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/projects/${projectId}/milestones`);
      if (!response.ok) {
        throw new Error(`Failed to fetch milestones: ${response.status}`);
      }
      const data = await response.json();
      setMilestones(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch milestones');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  React.useEffect(() => {
    fetchMilestones();
  }, [fetchMilestones]);

  const createMilestone = React.useCallback(
    async (data: CreateMilestoneData): Promise<Milestone> => {
      const response = await fetch(`/api/projects/${projectId}/milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        throw new Error(`Failed to create milestone: ${response.status}`);
      }
      const newMilestone = await response.json();
      setMilestones((prev) => [...prev, newMilestone]);
      return newMilestone;
    },
    [projectId]
  );

  const updateMilestone = React.useCallback(
    async (id: string, data: UpdateMilestoneData): Promise<Milestone> => {
      const response = await fetch(`/api/milestones/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        throw new Error(`Failed to update milestone: ${response.status}`);
      }
      const updatedMilestone = await response.json();
      setMilestones((prev) =>
        prev.map((m) => (m.id === id ? updatedMilestone : m))
      );
      return updatedMilestone;
    },
    []
  );

  const deleteMilestone = React.useCallback(async (id: string): Promise<void> => {
    const response = await fetch(`/api/milestones/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`Failed to delete milestone: ${response.status}`);
    }
    setMilestones((prev) => prev.filter((m) => m.id !== id));
  }, []);

  return {
    milestones,
    loading,
    error,
    createMilestone,
    updateMilestone,
    deleteMilestone,
    refresh: fetchMilestones,
  };
}
