/**
 * Credentials Management Page (Epic #1667, #1693).
 */
import * as React from 'react';
import { useState } from 'react';
import { Button } from '@/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/ui/card';
import { Badge } from '@/ui/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select';
import { Plus, Key, Trash2, Wand2, Loader2 } from 'lucide-react';
import { CredentialForm } from '@/ui/components/terminal/credential-form';
import { CredentialUsageList } from '@/ui/components/terminal/credential-usage-list';
import {
  useTerminalCredentials,
  useCreateTerminalCredential,
  useDeleteTerminalCredential,
  useGenerateTerminalKeyPair,
} from '@/ui/hooks/queries/use-terminal-credentials';
import { useTerminalConnections } from '@/ui/hooks/queries/use-terminal-connections';
import type { TerminalKeyPairResponse } from '@/ui/lib/api-types';

export function CredentialsPage(): React.JSX.Element {
  const [createOpen, setCreateOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [genName, setGenName] = useState('');
  const [genKeyType, setGenKeyType] = useState('ed25519');
  const [genResult, setGenResult] = useState<TerminalKeyPairResponse | null>(null);
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null);

  const credentialsQuery = useTerminalCredentials();
  const connectionsQuery = useTerminalConnections();
  const createCredential = useCreateTerminalCredential();
  const deleteCredential = useDeleteTerminalCredential();
  const generateKeyPair = useGenerateTerminalKeyPair();

  const credentials = Array.isArray(credentialsQuery.data?.credentials) ? credentialsQuery.data.credentials : [];
  const connections = Array.isArray(connectionsQuery.data?.connections) ? connectionsQuery.data.connections : [];

  const handleCreate = (data: { name: string; kind: string; value?: string; command?: string; command_timeout_s?: number }) => {
    createCredential.mutate(data, { onSuccess: () => setCreateOpen(false) });
  };

  const handleGenerate = () => {
    generateKeyPair.mutate({ name: genName, key_type: genKeyType }, {
      onSuccess: (result) => {
        setGenResult(result);
        setGenName('');
      },
    });
  };

  return (
    <div data-testid="page-credentials" className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Credentials</h1>
          <p className="text-sm text-muted-foreground">Manage SSH keys, passwords, and command-based credentials</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setGenerateOpen(true)}>
            <Wand2 className="mr-2 size-4" />
            Generate Key
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 size-4" />
            New Credential
          </Button>
        </div>
      </div>

      {credentials.length === 0 ? (
        <div className="py-12 text-center">
          <Key className="mx-auto size-10 text-muted-foreground/30" />
          <p className="mt-3 text-sm text-muted-foreground">No credentials yet.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {credentials.map((cred) => (
            <Card key={cred.id} data-testid="credential-card" className={selectedCredentialId === cred.id ? 'ring-2 ring-primary' : ''}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="flex items-center gap-2 text-sm cursor-pointer" onClick={() => setSelectedCredentialId(selectedCredentialId === cred.id ? null : cred.id)}>
                  <Key className="size-4 text-muted-foreground" />
                  {cred.name}
                </CardTitle>
                <Badge variant="outline" className="text-xs">{cred.kind}</Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                {cred.fingerprint && (
                  <p className="text-xs text-muted-foreground font-mono truncate" title={cred.fingerprint}>
                    {cred.fingerprint}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Created {new Date(cred.created_at).toLocaleDateString()}
                </p>
                {selectedCredentialId === cred.id && (
                  <div className="pt-2 border-t border-border">
                    <CredentialUsageList connections={connections} credentialId={cred.id} />
                  </div>
                )}
                <div className="flex justify-end">
                  <Button size="sm" variant="ghost" className="text-red-500 h-7" onClick={() => deleteCredential.mutate(cred.id)}>
                    <Trash2 className="size-3 mr-1" /> Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CredentialForm
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreate}
        isPending={createCredential.isPending}
      />

      {/* Key Generation Dialog */}
      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate SSH Key Pair</DialogTitle>
            <DialogDescription>Generate a new SSH key pair. The private key will be encrypted and stored securely.</DialogDescription>
          </DialogHeader>
          {genResult ? (
            <div className="space-y-3" data-testid="generated-key">
              <p className="text-sm font-medium text-green-600">Key generated successfully.</p>
              <div className="space-y-1">
                <Label>Public Key</Label>
                <pre className="text-xs font-mono bg-muted rounded p-2 whitespace-pre-wrap break-all">
                  {genResult.public_key}
                </pre>
              </div>
              <p className="text-xs text-muted-foreground">Copy this public key to your servers.</p>
              <DialogFooter>
                <Button onClick={() => { setGenResult(null); setGenerateOpen(false); }}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={genName} onChange={(e) => setGenName(e.target.value)} placeholder="my-new-key" required />
              </div>
              <div className="space-y-2">
                <Label>Key Type</Label>
                <Select value={genKeyType} onValueChange={setGenKeyType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ed25519">Ed25519 (recommended)</SelectItem>
                    <SelectItem value="rsa">RSA 4096</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setGenerateOpen(false)}>Cancel</Button>
                <Button onClick={handleGenerate} disabled={!genName || generateKeyPair.isPending}>
                  {generateKeyPair.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                  Generate
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
