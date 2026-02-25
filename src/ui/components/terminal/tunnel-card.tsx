/**
 * Tunnel card (Epic #1667, #1696).
 */
import * as React from 'react';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { ArrowLeftRight, Trash2 } from 'lucide-react';
import { TunnelDirectionDiagram } from './tunnel-direction-diagram';
import type { TerminalTunnel } from '@/ui/lib/api-types';

interface TunnelCardProps {
  tunnel: TerminalTunnel;
  onDelete?: (id: string) => void;
}

const statusColors: Record<string, string> = {
  active: 'bg-green-500/10 text-green-600 dark:text-green-400',
  failed: 'bg-red-500/10 text-red-600 dark:text-red-400',
  closed: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
};

export function TunnelCard({ tunnel, onDelete }: TunnelCardProps): React.JSX.Element {
  return (
    <Card data-testid="tunnel-card">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ArrowLeftRight className="size-4 text-muted-foreground" />
          {tunnel.direction.charAt(0).toUpperCase() + tunnel.direction.slice(1)} Tunnel
        </CardTitle>
        <Badge variant="secondary" className={`text-xs ${statusColors[tunnel.status] ?? ''}`}>
          {tunnel.status}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        <TunnelDirectionDiagram tunnel={tunnel} />
        {tunnel.error_message && (
          <p className="text-xs text-red-500">{tunnel.error_message}</p>
        )}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Created {new Date(tunnel.created_at).toLocaleString()}
          </span>
          {tunnel.status === 'active' && onDelete && (
            <Button size="sm" variant="ghost" className="text-red-500 h-7" onClick={() => onDelete(tunnel.id)}>
              <Trash2 className="size-3 mr-1" /> Close
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
