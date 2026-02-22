import * as React from 'react';
import { useState } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { formatContactName } from '@/ui/lib/format-contact-name.ts';
import { useMergeContacts } from '@/ui/hooks/mutations/use-update-contact.ts';
import type { Contact } from './types';

export interface ContactMergeDialogProps {
  contacts: [Contact, Contact] | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged?: () => void;
}

export function ContactMergeDialog({ contacts, open, onOpenChange, onMerged }: ContactMergeDialogProps) {
  const [survivorIndex, setSurvivorIndex] = useState<0 | 1>(0);
  const merge = useMergeContacts();

  if (!contacts) return null;

  const survivor = contacts[survivorIndex];
  const loser = contacts[survivorIndex === 0 ? 1 : 0];
  const survivorName = formatContactName(survivor);
  const loserName = formatContactName(loser);

  const handleMerge = () => {
    merge.mutate(
      { survivor_id: survivor.id, loser_id: loser.id },
      {
        onSuccess: () => {
          onOpenChange(false);
          onMerged?.();
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge Contacts</DialogTitle>
          <DialogDescription>Combine two contact records into one. The surviving contact keeps all data from both records.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            {contacts.map((c, i) => {
              const name = formatContactName(c);
              const isSelected = survivorIndex === i;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`flex-1 rounded-lg border-2 p-3 text-left transition-colors ${isSelected ? 'border-primary bg-primary/5' : 'border-muted hover:border-muted-foreground/30'}`}
                  onClick={() => setSurvivorIndex(i as 0 | 1)}
                >
                  <p className="text-sm font-medium">{name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {c.endpoints?.length ?? 0} endpoint{(c.endpoints?.length ?? 0) !== 1 ? 's' : ''}
                  </p>
                  <p className="mt-1 text-xs font-medium text-primary">{isSelected ? 'Survivor (keep)' : 'Will be merged'}</p>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <span>{loserName}</span>
            <ArrowRight className="size-4" />
            <span className="font-medium text-foreground">{survivorName}</span>
          </div>

          <div className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>This action cannot be undone. All endpoints, addresses, dates, tags, and linked items from &quot;{loserName}&quot; will be moved to &quot;{survivorName}&quot;.</p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleMerge} disabled={merge.isPending}>
            {merge.isPending ? 'Merging...' : 'Merge Contacts'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
