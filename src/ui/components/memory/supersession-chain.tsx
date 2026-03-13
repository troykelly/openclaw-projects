import * as React from 'react';
import { ArrowRight, AlertTriangle } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Badge } from '@/ui/components/ui/badge';
import type { SupersessionNode } from './types';

export interface SupersessionChainProps {
  chain: SupersessionNode[];
  currentId: string;
  onNodeClick?: (id: string) => void;
  className?: string;
}

export function SupersessionChain({ chain, currentId, onNodeClick, className }: SupersessionChainProps) {
  if (chain.length === 0) return null;

  return (
    <div className={cn('space-y-2', className)}>
      <h4 className="text-sm font-medium">Supersession Chain</h4>
      <div className="flex flex-wrap items-center gap-1" role="list" aria-label="Supersession chain">
        {chain.map((node, i) => (
          <React.Fragment key={node.id}>
            {i > 0 && <ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" />}
            <div role="listitem">
              {node.exists ? (
                <button
                  className={cn(
                    'rounded-sm px-2 py-0.5 text-xs transition-colors hover:bg-accent',
                    node.id === currentId && 'bg-accent font-medium',
                  )}
                  onClick={() => onNodeClick?.(node.id)}
                  disabled={node.id === currentId}
                  aria-current={node.id === currentId ? 'true' : undefined}
                >
                  {node.title}
                </button>
              ) : (
                <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
                  <AlertTriangle className="size-3" />
                  Memory deleted
                </Badge>
              )}
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
