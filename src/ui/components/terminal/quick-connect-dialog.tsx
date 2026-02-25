/**
 * Quick connect dialog for starting a new session (Epic #1667, #1691).
 *
 * Lets users select a saved connection and start a terminal session.
 */
import * as React from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/ui/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/ui/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { Play, Loader2 } from 'lucide-react';
import { useTerminalConnections } from '@/ui/hooks/queries/use-terminal-connections';
import { useCreateTerminalSession } from '@/ui/hooks/queries/use-terminal-sessions';

export function QuickConnectDialog(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('');
  const navigate = useNavigate();

  const connectionsQuery = useTerminalConnections();
  const createSession = useCreateTerminalSession();

  const connections = Array.isArray(connectionsQuery.data?.connections) ? connectionsQuery.data.connections : [];

  const handleConnect = () => {
    if (!selectedConnectionId) return;

    createSession.mutate(
      { connection_id: selectedConnectionId },
      {
        onSuccess: (session) => {
          setOpen(false);
          setSelectedConnectionId('');
          navigate(`/terminal/sessions/${session.id}`);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="quick-connect-button">
          <Play className="mr-2 size-4" />
          Quick Connect
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Quick Connect</DialogTitle>
          <DialogDescription>Select a saved connection to start a new terminal session.</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Select value={selectedConnectionId} onValueChange={setSelectedConnectionId}>
            <SelectTrigger data-testid="connection-select">
              <SelectValue placeholder="Select a connection..." />
            </SelectTrigger>
            <SelectContent>
              {connections.map((conn) => (
                <SelectItem key={conn.id} value={conn.id}>
                  {conn.name} {conn.host ? `(${conn.host}:${conn.port})` : '(local)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={handleConnect}
            disabled={!selectedConnectionId || createSession.isPending}
            data-testid="connect-button"
          >
            {createSession.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
