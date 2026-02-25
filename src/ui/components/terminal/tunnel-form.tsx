/**
 * Tunnel creation form (Epic #1667, #1696).
 */
import * as React from 'react';
import { useState } from 'react';
import { Button } from '@/ui/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { Loader2 } from 'lucide-react';
import type { TerminalConnection } from '@/ui/lib/api-types';

interface TunnelFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { connection_id: string; direction: string; bind_host?: string; bind_port: number; target_host?: string; target_port?: number }) => void;
  connections: TerminalConnection[];
  isPending?: boolean;
}

export function TunnelForm({ open, onOpenChange, onSubmit, connections, isPending }: TunnelFormProps): React.JSX.Element {
  const [connectionId, setConnectionId] = useState('');
  const [direction, setDirection] = useState('local');
  const [bindHost, setBindHost] = useState('127.0.0.1');
  const [bindPort, setBindPort] = useState('');
  const [targetHost, setTargetHost] = useState('');
  const [targetPort, setTargetPort] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      connection_id: connectionId,
      direction,
      bind_host: bindHost || undefined,
      bind_port: Number(bindPort),
      target_host: direction !== 'dynamic' ? targetHost || undefined : undefined,
      target_port: direction !== 'dynamic' ? Number(targetPort) || undefined : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Tunnel</DialogTitle>
          <DialogDescription>Create an SSH tunnel through a connection.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" data-testid="tunnel-form">
          <div className="space-y-2">
            <Label>Connection</Label>
            <Select value={connectionId} onValueChange={setConnectionId}>
              <SelectTrigger><SelectValue placeholder="Select connection..." /></SelectTrigger>
              <SelectContent>
                {connections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Direction</Label>
            <Select value={direction} onValueChange={setDirection}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local (forward)</SelectItem>
                <SelectItem value="remote">Remote (reverse)</SelectItem>
                <SelectItem value="dynamic">Dynamic (SOCKS)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 space-y-2">
              <Label>Bind Host</Label>
              <Input value={bindHost} onChange={(e) => setBindHost(e.target.value)} placeholder="127.0.0.1" />
            </div>
            <div className="space-y-2">
              <Label>Bind Port</Label>
              <Input type="number" value={bindPort} onChange={(e) => setBindPort(e.target.value)} placeholder="8080" required />
            </div>
          </div>

          {direction !== 'dynamic' && (
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 space-y-2">
                <Label>Target Host</Label>
                <Input value={targetHost} onChange={(e) => setTargetHost(e.target.value)} placeholder="localhost" />
              </div>
              <div className="space-y-2">
                <Label>Target Port</Label>
                <Input type="number" value={targetPort} onChange={(e) => setTargetPort(e.target.value)} placeholder="80" />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending || !connectionId || !bindPort}>
              {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
