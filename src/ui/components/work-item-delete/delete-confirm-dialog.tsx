import * as React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/components/ui/alert-dialog';
import type { DeleteConfirmDialogProps } from './types';

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  item,
  items,
  onConfirm,
  isDeleting,
}: DeleteConfirmDialogProps) {
  const isBulk = items && items.length > 0;
  const totalItems = isBulk ? items.length : 1;
  const title = item?.title ?? '';
  const childCount = item?.childCount ?? 0;

  // Calculate total child count for bulk delete
  const totalChildCount = isBulk
    ? items.reduce((sum, i) => sum + (i.childCount ?? 0), 0)
    : childCount;

  const getTitle = () => {
    if (isBulk) {
      return `Delete ${totalItems} items?`;
    }
    return `Delete "${title}"?`;
  };

  const getDescription = () => {
    const parts: string[] = [];

    if (isBulk) {
      parts.push(`You are about to delete ${totalItems} items.`);
    } else {
      parts.push(`You are about to delete "${title}".`);
    }

    if (totalChildCount > 0) {
      parts.push(
        `This will also delete ${totalChildCount} child item${totalChildCount === 1 ? '' : 's'}.`
      );
    }

    parts.push('You can undo this action for a short time after deletion.');

    return parts.join(' ');
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{getTitle()}</AlertDialogTitle>
          <AlertDialogDescription>{getDescription()}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
