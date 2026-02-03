import * as React from 'react';
import { Button } from '@/ui/components/ui/button';
import type { UndoToastProps } from './types';

const DEFAULT_TIMEOUT = 5000;

export function UndoToast({
  visible,
  itemTitle,
  itemCount,
  onUndo,
  onDismiss,
  timeout = DEFAULT_TIMEOUT,
}: UndoToastProps) {
  React.useEffect(() => {
    if (!visible) return;

    const timer = setTimeout(() => {
      onDismiss();
    }, timeout);

    return () => clearTimeout(timer);
  }, [visible, timeout, onDismiss]);

  if (!visible) {
    return null;
  }

  const getMessage = () => {
    if (itemCount && itemCount > 1) {
      return `Deleted ${itemCount} items`;
    }
    return `Deleted "${itemTitle}"`;
  };

  return (
    <div
      role="alert"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg border bg-background px-4 py-3 shadow-lg"
    >
      <span className="text-sm">{getMessage()}</span>
      <Button variant="outline" size="sm" onClick={onUndo}>
        Undo
      </Button>
    </div>
  );
}
