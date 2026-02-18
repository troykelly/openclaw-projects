/**
 * Settings panel for viewing and editing the agent identity.
 */
import * as React from 'react';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Textarea } from '@/ui/components/ui/textarea';
import { useAgentIdentity, useSaveAgentIdentity } from '@/ui/hooks/queries/use-agent-identity';

export function IdentitySettings() {
  const { data: identity, isLoading } = useAgentIdentity();
  const saveMutation = useSaveAgentIdentity();

  const [name, setName] = React.useState('');
  const [display_name, setDisplayName] = React.useState('');
  const [emoji, setEmoji] = React.useState('');
  const [persona, setPersona] = React.useState('');
  const [principles, setPrinciples] = React.useState('');
  const [quirks, setQuirks] = React.useState('');

  React.useEffect(() => {
    if (identity) {
      setName(identity.name);
      setDisplayName(identity.display_name);
      setEmoji(identity.emoji ?? '');
      setPersona(identity.persona);
      setPrinciples(identity.principles.join('\n'));
      setQuirks(identity.quirks.join('\n'));
    }
  }, [identity]);

  const handleSave = () => {
    saveMutation.mutate({
      name,
      display_name: display_name,
      emoji: emoji || undefined,
      persona,
      principles: principles.split('\n').filter(Boolean),
      quirks: quirks.split('\n').filter(Boolean),
    });
  };

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading identity...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Agent Identity</h3>
        {identity && (
          <Badge variant="outline">v{identity.version}</Badge>
        )}
      </div>

      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="identity-name">Name</Label>
            <Input id="identity-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="quasar" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="identity-display-name">Display Name</Label>
            <Input id="identity-display-name" value={display_name} onChange={(e) => setDisplayName(e.target.value)} placeholder="Quasar" />
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="identity-emoji">Emoji</Label>
          <Input id="identity-emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="✦" className="w-20" />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="identity-persona">Persona</Label>
          <Textarea id="identity-persona" value={persona} onChange={(e) => setPersona(e.target.value)} rows={4} placeholder="Core personality description..." />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="identity-principles">Principles (one per line)</Label>
          <Textarea id="identity-principles" value={principles} onChange={(e) => setPrinciples(e.target.value)} rows={3} placeholder="Be helpful\nBe honest" />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="identity-quirks">Quirks (one per line)</Label>
          <Textarea id="identity-quirks" value={quirks} onChange={(e) => setQuirks(e.target.value)} rows={3} placeholder="Uses bullet points for status updates" />
        </div>

        <Button onClick={handleSave} disabled={!name || !persona || saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving...' : 'Save Identity'}
        </Button>
      </div>
    </div>
  );
}
