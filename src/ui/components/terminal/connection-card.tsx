/**
 * Connection card for connections list (Epic #1667, #1692).
 */
import * as React from 'react';
import { Link } from 'react-router';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Server, Play, Settings2, Trash2, Loader2 } from 'lucide-react';
import { ConnectionStatusIndicator } from './connection-status-indicator';
import type { TerminalConnection } from '@/ui/lib/api-types';

interface ConnectionCardProps {
  connection: TerminalConnection;
  onTest?: (id: string) => void;
  onDelete?: (id: string) => void;
  isTesting?: boolean;
}

export function ConnectionCard({ connection, onTest, onDelete, isTesting }: ConnectionCardProps): React.JSX.Element {
  return (
    <Card data-testid="connection-card">
      <CardHeader className="flex flex-row items-start justify-between pb-2">
        <div className="flex items-center gap-2">
          <Server className="size-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium">
            <Link to={`/terminal/connections/${connection.id}`} className="hover:underline">
              {connection.name}
            </Link>
          </CardTitle>
        </div>
        <ConnectionStatusIndicator connection={connection} />
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {connection.is_local ? 'Local terminal' : `${connection.username ?? ''}@${connection.host}:${connection.port}`}
          </p>
          {connection.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {connection.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
              ))}
            </div>
          )}
          {connection.last_error && (
            <p className="text-xs text-red-500 truncate" title={connection.last_error}>
              {connection.last_error}
            </p>
          )}
          <div className="flex items-center gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={() => onTest?.(connection.id)} disabled={isTesting}>
              {isTesting ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Play className="mr-1 size-3" />}
              Test
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link to={`/terminal/connections/${connection.id}`}>
                <Settings2 className="mr-1 size-3" />
                Edit
              </Link>
            </Button>
            <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600" onClick={() => onDelete?.(connection.id)}>
              <Trash2 className="size-3" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
