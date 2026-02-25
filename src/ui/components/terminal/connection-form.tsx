/**
 * Connection create/edit form dialog (Epic #1667, #1692).
 */
import * as React from 'react';
import { useState } from 'react';
import { Button } from '@/ui/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { Switch } from '@/ui/components/ui/switch';
import { Textarea } from '@/ui/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import type { TerminalConnection } from '@/ui/lib/api-types';

interface ConnectionFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: Partial<TerminalConnection>) => void;
  initial?: TerminalConnection;
  isPending?: boolean;
  credentials?: Array<{ id: string; name: string }>;
}

export function ConnectionForm({ open, onOpenChange, onSubmit, initial, isPending, credentials }: ConnectionFormProps): React.JSX.Element {
  const [name, setName] = useState(initial?.name ?? '');
  const [host, setHost] = useState(initial?.host ?? '');
  const [port, setPort] = useState(String(initial?.port ?? 22));
  const [username, setUsername] = useState(initial?.username ?? '');
  const [authMethod, setAuthMethod] = useState(initial?.auth_method ?? 'key');
  const [credentialId, setCredentialId] = useState(initial?.credential_id ?? '');
  const [isLocal, setIsLocal] = useState(initial?.is_local ?? false);
  const [hostKeyPolicy, setHostKeyPolicy] = useState(initial?.host_key_policy ?? 'strict');
  const [tags, setTags] = useState(initial?.tags?.join(', ') ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      host: isLocal ? null : host,
      port: Number(port),
      username: isLocal ? null : username,
      auth_method: isLocal ? null : authMethod,
      credential_id: credentialId || null,
      is_local: isLocal,
      host_key_policy: hostKeyPolicy,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      notes: notes || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit Connection' : 'New Connection'}</DialogTitle>
          <DialogDescription>
            {initial ? 'Update the connection configuration.' : 'Add a new SSH connection.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" data-testid="connection-form">
          <div className="space-y-2">
            <Label htmlFor="conn-name">Name</Label>
            <Input id="conn-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="prod-web-1" required />
          </div>

          <div className="flex items-center gap-2">
            <Switch id="is-local" checked={isLocal} onCheckedChange={setIsLocal} />
            <Label htmlFor="is-local">Local terminal (no SSH)</Label>
          </div>

          {!isLocal && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="conn-host">Host</Label>
                  <Input id="conn-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.100" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="conn-port">Port</Label>
                  <Input id="conn-port" type="number" value={port} onChange={(e) => setPort(e.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="conn-user">Username</Label>
                <Input id="conn-user" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="root" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="auth-method">Auth Method</Label>
                <Select value={authMethod} onValueChange={setAuthMethod}>
                  <SelectTrigger id="auth-method"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="key">SSH Key</SelectItem>
                    <SelectItem value="password">Password</SelectItem>
                    <SelectItem value="agent">SSH Agent</SelectItem>
                    <SelectItem value="command">Command</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {credentials && credentials.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="credential">Credential</Label>
                  <Select value={credentialId} onValueChange={setCredentialId}>
                    <SelectTrigger id="credential"><SelectValue placeholder="Select credential..." /></SelectTrigger>
                    <SelectContent>
                      {credentials.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="host-key-policy">Host Key Policy</Label>
                <Select value={hostKeyPolicy} onValueChange={setHostKeyPolicy}>
                  <SelectTrigger id="host-key-policy"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="strict">Strict</SelectItem>
                    <SelectItem value="tofu">Trust on First Use</SelectItem>
                    <SelectItem value="skip">Skip Verification</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="conn-tags">Tags (comma-separated)</Label>
            <Input id="conn-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="production, web" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="conn-notes">Notes</Label>
            <Textarea id="conn-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes..." rows={2} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending || !name}>
              {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              {initial ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
