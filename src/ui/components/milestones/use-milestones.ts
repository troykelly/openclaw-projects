/**
 * Hook for managing milestones via API
 */
import * as React from 'react';
import { apiClient } from '@/ui/lib/api-client';
import type { Milestone, CreateMilestoneData, UpdateMilestoneData, UseMilestonesReturn } from './types';

export function useMilestones(projectId: string): UseMilestonesReturn {
  const [milestones, setMilestones] = React.useState<Milestone[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchMilestones = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.get<Milestone[]>(`/api/projects/${projectId}/milestones`);
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
      const newMilestone = await apiClient.post<Milestone>(`/api/projects/${projectId}/milestones`, data);
      setMilestones((prev) => [...prev, newMilestone]);
      return newMilestone;
    },
    [projectId],
  );

  const updateMilestone = React.useCallback(async (id: string, data: UpdateMilestoneData): Promise<Milestone> => {
    const updatedMilestone = await apiClient.patch<Milestone>(`/api/milestones/${id}`, data);
    setMilestones((prev) => prev.map((m) => (m.id === id ? updatedMilestone : m)));
    return updatedMilestone;
  }, []);

  const deleteMilestone = React.useCallback(async (id: string): Promise<void> => {
    await apiClient.delete(`/api/milestones/${id}`);
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
