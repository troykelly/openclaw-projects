/**
 * Credential create/edit form (Epic #1667, #1693).
 *
 * Tabs for SSH key (upload/paste), password, and command-based credentials.
 */
import * as React from 'react';
import { useState } from 'react';
import { Button } from '@/ui/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/components/ui/tabs';
import { Textarea } from '@/ui/components/ui/textarea';
import { Loader2 } from 'lucide-react';

interface CredentialFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { name: string; kind: string; value?: string; command?: string; command_timeout_s?: number }) => void;
  isPending?: boolean;
}

export function CredentialForm({ open, onOpenChange, onSubmit, isPending }: CredentialFormProps): React.JSX.Element {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('ssh_key');
  const [value, setValue] = useState('');
  const [command, setCommand] = useState('');
  const [commandTimeout, setCommandTimeout] = useState('10');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: { name: string; kind: string; value?: string; command?: string; command_timeout_s?: number } = { name, kind };
    if (kind === 'command') {
      data.command = command;
      data.command_timeout_s = Number(commandTimeout);
    } else {
      data.value = value;
    }
    onSubmit(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Credential</DialogTitle>
          <DialogDescription>Add an SSH key, password, or command-based credential.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" data-testid="credential-form">
          <div className="space-y-2">
            <Label htmlFor="cred-name">Name</Label>
            <Input id="cred-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-ed25519-key" required />
          </div>

          <Tabs value={kind} onValueChange={setKind}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="ssh_key">SSH Key</TabsTrigger>
              <TabsTrigger value="password">Password</TabsTrigger>
              <TabsTrigger value="command">Command</TabsTrigger>
            </TabsList>

            <TabsContent value="ssh_key" className="space-y-2">
              <Label htmlFor="ssh-key-value">Private Key</Label>
              <Textarea
                id="ssh-key-value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                rows={6}
                className="font-mono text-xs"
              />
            </TabsContent>

            <TabsContent value="password" className="space-y-2">
              <Label htmlFor="password-value">Password</Label>
              <Input id="password-value" type="password" value={value} onChange={(e) => setValue(e.target.value)} />
            </TabsContent>

            <TabsContent value="command" className="space-y-2">
              <Label htmlFor="command-value">Command</Label>
              <Input id="command-value" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="op read op://vault/key" />
              <Label htmlFor="command-timeout">Timeout (seconds)</Label>
              <Input id="command-timeout" type="number" value={commandTimeout} onChange={(e) => setCommandTimeout(e.target.value)} />
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending || !name}>
              {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
