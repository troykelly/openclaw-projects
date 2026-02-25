/**
 * SSH config import dialog (Epic #1667, #1692).
 */
import * as React from 'react';
import { useState } from 'react';
import { Button } from '@/ui/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Textarea } from '@/ui/components/ui/textarea';
import { Loader2, Upload } from 'lucide-react';

interface SshConfigImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (config: string) => void;
  isPending?: boolean;
}

export function SshConfigImportDialog({ open, onOpenChange, onImport, isPending }: SshConfigImportDialogProps): React.JSX.Element {
  const [config, setConfig] = useState('');

  const handleImport = () => {
    if (config.trim()) {
      onImport(config);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import SSH Config</DialogTitle>
          <DialogDescription>
            Paste your ~/.ssh/config contents to import connections.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={config}
          onChange={(e) => setConfig(e.target.value)}
          placeholder={`Host prod-web\n  HostName 192.168.1.100\n  User root\n  Port 22`}
          rows={12}
          className="font-mono text-xs"
          data-testid="ssh-config-input"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleImport} disabled={!config.trim() || isPending}>
            {isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Upload className="mr-2 size-4" />}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
