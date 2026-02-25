/**
 * TOFU host key approval dialog (Epic #1667, #1694).
 */
import * as React from 'react';
import { Button } from '@/ui/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { ShieldAlert, Loader2 } from 'lucide-react';

interface HostKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  onApprove: () => void;
  onReject: () => void;
  isPending?: boolean;
}

export function HostKeyDialog({ open, onOpenChange, host, port, keyType, fingerprint, onApprove, onReject, isPending }: HostKeyDialogProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-amber-500" />
            Host Key Verification
          </DialogTitle>
          <DialogDescription>
            The authenticity of host '{host}:{port}' cannot be established.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm" data-testid="host-key-details">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Key Type</span>
            <span className="font-mono text-xs">{keyType}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Fingerprint</span>
            <span className="font-mono text-xs break-all">{fingerprint}</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Are you sure you want to continue connecting? This will add the key to your known hosts.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onReject}>Reject</Button>
          <Button onClick={onApprove} disabled={isPending}>
            {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Trust & Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
