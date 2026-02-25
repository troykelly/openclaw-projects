/**
 * Enrollment token creation form (Epic #1667, #1696).
 */
import * as React from 'react';
import { useState } from 'react';
import { Button } from '@/ui/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { Input } from '@/ui/components/ui/input';
import { Label } from '@/ui/components/ui/label';
import { Loader2 } from 'lucide-react';

interface EnrollmentFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { label: string; max_uses?: number; expires_at?: string; allowed_tags?: string[] }) => void;
  isPending?: boolean;
}

export function EnrollmentForm({ open, onOpenChange, onSubmit, isPending }: EnrollmentFormProps): React.JSX.Element {
  const [label, setLabel] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [tags, setTags] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      label,
      max_uses: maxUses ? Number(maxUses) : undefined,
      expires_at: expiresAt || undefined,
      allowed_tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Enrollment Token</DialogTitle>
          <DialogDescription>Generate a token for remote servers to self-register.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" data-testid="enrollment-form">
          <div className="space-y-2">
            <Label htmlFor="enroll-label">Label</Label>
            <Input id="enroll-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="staging-servers" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="enroll-max-uses">Max Uses (optional)</Label>
            <Input id="enroll-max-uses" type="number" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="Unlimited" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="enroll-expires">Expires At (optional)</Label>
            <Input id="enroll-expires" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="enroll-tags">Auto-applied Tags (comma-separated)</Label>
            <Input id="enroll-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="staging, auto-enrolled" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending || !label}>
              {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Generate Token
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
