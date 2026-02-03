/**
 * Hook for managing labels via API
 */
import * as React from 'react';
import type { Label, CreateLabelData, UpdateLabelData, UseLabelsReturn } from './types';

export function useLabels(): UseLabelsReturn {
  const [labels, setLabels] = React.useState<Label[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchLabels = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/labels');
      if (!response.ok) {
        throw new Error(`Failed to fetch labels: ${response.status}`);
      }
      const data = await response.json();
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

  const createLabel = React.useCallback(
    async (data: CreateLabelData): Promise<Label> => {
      const response = await fetch('/api/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        throw new Error(`Failed to create label: ${response.status}`);
      }
      const newLabel = await response.json();
      setLabels((prev) => [...prev, newLabel]);
      return newLabel;
    },
    []
  );

  const updateLabel = React.useCallback(
    async (id: string, data: UpdateLabelData): Promise<Label> => {
      const response = await fetch(`/api/labels/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        throw new Error(`Failed to update label: ${response.status}`);
      }
      const updatedLabel = await response.json();
      setLabels((prev) =>
        prev.map((label) => (label.id === id ? updatedLabel : label))
      );
      return updatedLabel;
    },
    []
  );

  const deleteLabel = React.useCallback(async (id: string): Promise<void> => {
    const response = await fetch(`/api/labels/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`Failed to delete label: ${response.status}`);
    }
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
