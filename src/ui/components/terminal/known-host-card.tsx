/**
 * Known host card (Epic #1667, #1696).
 */
import * as React from 'react';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Shield, Trash2, Eye } from 'lucide-react';
import type { TerminalKnownHost } from '@/ui/lib/api-types';

interface KnownHostCardProps {
  knownHost: TerminalKnownHost;
  onDelete?: (id: string) => void;
  onVerify?: () => void;
}

export function KnownHostCard({ knownHost, onDelete, onVerify }: KnownHostCardProps): React.JSX.Element {
  return (
    <Card data-testid="known-host-card">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Shield className="size-4 text-green-500" />
          {knownHost.host}:{knownHost.port}
        </CardTitle>
        <Badge variant="outline" className="text-xs">{knownHost.key_type}</Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">Fingerprint:</span>{' '}
          <span className="font-mono break-all">{knownHost.key_fingerprint}</span>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Trusted {new Date(knownHost.trusted_at).toLocaleDateString()}
            {knownHost.trusted_by && ` by ${knownHost.trusted_by}`}
          </span>
          <div className="flex items-center gap-1">
            {onVerify && (
              <Button size="sm" variant="ghost" className="h-7" onClick={onVerify}>
                <Eye className="size-3 mr-1" /> Verify
              </Button>
            )}
            {onDelete && (
              <Button size="sm" variant="ghost" className="text-red-500 h-7" onClick={() => onDelete(knownHost.id)}>
                <Trash2 className="size-3 mr-1" /> Revoke
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
