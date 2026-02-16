/**
 * Hook for managing labels via API
 */
import * as React from 'react';
import { apiClient } from '@/ui/lib/api-client';
import type { Label, CreateLabelData, UpdateLabelData, UseLabelsReturn } from './types';

export function useLabels(): UseLabelsReturn {
  const [labels, setLabels] = React.useState<Label[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchLabels = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.get<Label[]>('/api/labels');
      setLabels(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch labels');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchLabels();
  }, [fetchLabels]);

  const createLabel = React.useCallback(async (data: CreateLabelData): Promise<Label> => {
    const newLabel = await apiClient.post<Label>('/api/labels', data);
    setLabels((prev) => [...prev, newLabel]);
    return newLabel;
  }, []);

  const updateLabel = React.useCallback(async (id: string, data: UpdateLabelData): Promise<Label> => {
    const updatedLabel = await apiClient.patch<Label>(`/api/labels/${id}`, data);
    setLabels((prev) => prev.map((label) => (label.id === id ? updatedLabel : label)));
    return updatedLabel;
  }, []);

  const deleteLabel = React.useCallback(async (id: string): Promise<void> => {
    await apiClient.delete(`/api/labels/${id}`);
    setLabels((prev) => prev.filter((label) => label.id !== id));
  }, []);

  return {
    labels,
    loading,
    error,
    createLabel,
    updateLabel,
    deleteLabel,
    refresh: fetchLabels,
  };
}
