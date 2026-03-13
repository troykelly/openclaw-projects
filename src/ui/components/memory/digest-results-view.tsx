/**
 * Digest results view — displays memory clusters and orphans.
 * Issue #2449: Digest results view + reaper activity log + new hooks.
 */
import * as React from 'react';
import { Brain, FileText } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { ClusterCard } from './cluster-card';
import type { DigestResponse, MemoryCluster } from '@/ui/lib/api-types';

export interface DigestResultsViewProps {
  data: DigestResponse;
  onPromoteCluster?: (cluster: MemoryCluster) => void;
  onDismissCluster?: (cluster: MemoryCluster) => void;
  className?: string;
}

export function DigestResultsView({ data, onPromoteCluster, onDismissCluster, className }: DigestResultsViewProps) {
  if (data.total_memories === 0 && data.clusters.length === 0 && data.orphans.length === 0) {
    return (
      <div role="region" aria-label="Digest results" className={cn('py-12 text-center', className)}>
        <Brain className="mx-auto size-12 text-muted-foreground/50" />
        <p className="mt-4 text-muted-foreground">No digest results found</p>
      </div>
    );
  }

  return (
    <div role="region" aria-label="Digest results" className={cn('space-y-6', className)}>
      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border p-4 text-center">
          <div className="text-2xl font-bold">{data.total_memories}</div>
          <div className="text-sm text-muted-foreground">Total Memories</div>
        </div>
        <div className="rounded-lg border p-4 text-center">
          <div className="text-2xl font-bold">{data.clusters.length}</div>
          <div className="text-sm text-muted-foreground">Clusters</div>
        </div>
        <div className="rounded-lg border p-4 text-center">
          <div className="text-2xl font-bold">{data.orphans.length}</div>
          <div className="text-sm text-muted-foreground">Orphans</div>
        </div>
      </div>

      {/* Clusters */}
      {data.clusters.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Clusters</h3>
          {data.clusters.map((cluster) => (
            <ClusterCard
              key={cluster.centroid_id}
              cluster={cluster}
              onPromote={onPromoteCluster ? () => onPromoteCluster(cluster) : undefined}
              onDismiss={onDismissCluster ? () => onDismissCluster(cluster) : undefined}
            />
          ))}
        </div>
      )}

      {/* Orphans */}
      {data.orphans.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold">Unclustered Memories</h3>
          <div className="space-y-2">
            {data.orphans.map((memory) => (
              <div key={memory.id} className="flex items-start gap-3 rounded-lg border p-3">
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="font-medium">{memory.title}</div>
                  <div className="truncate text-sm text-muted-foreground">{memory.content}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
