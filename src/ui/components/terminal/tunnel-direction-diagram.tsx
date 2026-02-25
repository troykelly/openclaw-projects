/**
 * Tunnel direction arrow visualization (Epic #1667, #1696).
 */
import * as React from 'react';
import { ArrowRight, ArrowLeft, RotateCcw } from 'lucide-react';
import type { TerminalTunnel } from '@/ui/lib/api-types';

interface TunnelDirectionDiagramProps {
  tunnel: TerminalTunnel;
}

export function TunnelDirectionDiagram({ tunnel }: TunnelDirectionDiagramProps): React.JSX.Element {
  const local = `${tunnel.bind_host}:${tunnel.bind_port}`;
  const remote = tunnel.target_host && tunnel.target_port ? `${tunnel.target_host}:${tunnel.target_port}` : 'SOCKS';

  return (
    <div className="flex items-center gap-2 text-xs font-mono" data-testid="tunnel-direction">
      {tunnel.direction === 'local' && (
        <>
          <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-600 dark:text-blue-400">{local}</span>
          <ArrowRight className="size-3 text-muted-foreground" />
          <span className="rounded bg-green-500/10 px-1.5 py-0.5 text-green-600 dark:text-green-400">{remote}</span>
        </>
      )}
      {tunnel.direction === 'remote' && (
        <>
          <span className="rounded bg-green-500/10 px-1.5 py-0.5 text-green-600 dark:text-green-400">{remote}</span>
          <ArrowLeft className="size-3 text-muted-foreground" />
          <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-600 dark:text-blue-400">{local}</span>
        </>
      )}
      {tunnel.direction === 'dynamic' && (
        <>
          <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-purple-600 dark:text-purple-400">{local}</span>
          <RotateCcw className="size-3 text-muted-foreground" />
          <span className="text-muted-foreground">SOCKS proxy</span>
        </>
      )}
    </div>
  );
}
