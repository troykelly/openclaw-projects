/**
 * Expandable card for a single memory cluster.
 * Issue #2449: Digest results view + reaper activity log + new hooks.
 */
import * as React from 'react';
import { useState } from 'react';
import { ChevronDown, ChevronRight, Sparkles, X } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import type { MemoryCluster } from '@/ui/lib/api-types';

export interface ClusterCardProps {
  cluster: MemoryCluster;
  onPromote?: () => void;
  onDismiss?: () => void;
  className?: string;
}

export function ClusterCard({ cluster, onPromote, onDismiss, className }: ClusterCardProps) {
  const [expanded, setExpanded] = useState(false);

  const similarityPercent = Math.round(cluster.avg_similarity * 100);
  const startDate = new Date(cluster.time_span.start).toLocaleDateString();
  const endDate = new Date(cluster.time_span.end).toLocaleDateString();

  return (
    <div className={cn('rounded-lg border', className)}>
      <div className="flex items-center gap-3 p-4">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 rounded p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={expanded ? 'Collapse cluster' : 'Expand cluster'}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="font-medium">{cluster.topic}</div>
          <div className="flex gap-3 text-sm text-muted-foreground">
            <span>{cluster.size} memories</span>
            <span>{similarityPercent}% similarity</span>
            <span>{startDate} — {endDate}</span>
          </div>
        </div>

        <div className="flex gap-1">
          {onPromote && (
            <Button variant="outline" size="sm" onClick={onPromote} aria-label="Promote cluster">
              <Sparkles className="mr-1 size-3" />
              Promote
            </Button>
          )}
          {onDismiss && (
            <Button variant="ghost" size="sm" onClick={onDismiss} aria-label="Dismiss cluster">
              <X className="mr-1 size-3" />
              Dismiss
            </Button>
          )}
        </div>
      </div>

      {expanded && cluster.memories.length > 0 && (
        <div className="border-t px-4 py-3">
          <div className="space-y-2">
            {cluster.memories.map((memory) => (
              <div key={memory.id} className="rounded border p-2 text-sm">
                <div className="font-medium">{memory.title}</div>
                <div className="truncate text-muted-foreground">{memory.content}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
