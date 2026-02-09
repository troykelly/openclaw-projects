/**
 * Confirmation dialog for bulk delete
 * Issue #397: Implement bulk contact operations
 */
import * as React from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/ui/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/components/ui/dialog';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import type { Contact } from './types';

export interface BulkDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: Contact[];
  onConfirm: () => void;
  loading?: boolean;
}

export function BulkDeleteDialog({ open, onOpenChange, contacts, onConfirm, loading = false }: BulkDeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-full bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <DialogTitle>Delete {contacts.length} contacts?</DialogTitle>
          </div>
          <DialogDescription>This action cannot be undone. The following contacts will be permanently deleted.</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-48 border rounded-md">
          <div className="p-3 space-y-2">
            {contacts.map((contact) => (
              <div key={contact.id} className="flex items-center gap-2 text-sm">
                <span className="font-medium">{contact.name}</span>
                {contact.email && <span className="text-muted-foreground">({contact.email})</span>}
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Deleting...
              </>
            ) : (
              'Delete'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
