/**
 * Keyboard shortcuts help dialog.
 *
 * Renders a modal that lists every registered shortcut grouped by category.
 * The dialog is opened/closed via the `open` / `onOpenChange` controlled props,
 * typically driven by the `useKeyboardShortcuts` hook (Cmd+/).
 */
import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/ui/components/ui/dialog';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { Separator } from '@/ui/components/ui/separator';
import type { ShortcutDefinition } from '@/ui/hooks/use-keyboard-shortcuts';

export interface KeyboardShortcutsDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Called when the dialog requests to close. */
  onOpenChange: (open: boolean) => void;
  /** The shortcut definitions to display, typically from useKeyboardShortcuts. */
  shortcuts: ShortcutDefinition[];
}

/** Renders a single keyboard key badge. */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-xs font-medium text-muted-foreground">
      {children}
    </kbd>
  );
}

/**
 * Group an array of shortcut definitions by their `group` field,
 * preserving insertion order.
 */
function groupShortcuts(shortcuts: ShortcutDefinition[]): Map<string, ShortcutDefinition[]> {
  const groups = new Map<string, ShortcutDefinition[]>();
  for (const shortcut of shortcuts) {
    const existing = groups.get(shortcut.group);
    if (existing) {
      existing.push(shortcut);
    } else {
      groups.set(shortcut.group, [shortcut]);
    }
  }
  return groups;
}

/**
 * Controlled dialog component that displays all keyboard shortcuts
 * organised into labelled groups.
 */
export function KeyboardShortcutsDialog({ open, onOpenChange, shortcuts }: KeyboardShortcutsDialogProps): React.JSX.Element {
  const groups = React.useMemo(() => groupShortcuts(shortcuts), [shortcuts]);
  const groupEntries = Array.from(groups.entries());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="keyboard-shortcuts-dialog">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Navigate and act faster with these shortcuts. Press <Kbd>{'\u2318'}</Kbd> <Kbd>/</Kbd> to toggle this help.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-6 pr-4">
            {groupEntries.map(([group_name, items], groupIndex) => (
              <div key={group_name}>
                {groupIndex > 0 && <Separator className="mb-4" />}
                <h3 className="mb-3 text-sm font-medium text-foreground">{group_name}</h3>
                <div className="space-y-2">
                  {items.map((shortcut) => (
                    <div key={shortcut.id} className="flex items-center justify-between py-1">
                      <span className="text-sm text-muted-foreground">{shortcut.description}</span>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, i) => (
                          <React.Fragment key={`${shortcut.id}-key-${i}`}>
                            <Kbd>{key}</Kbd>
                            {i < shortcut.keys.length - 1 && <span className="text-xs text-muted-foreground">then</span>}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
        <div className="text-center text-xs text-muted-foreground">
          <span className="opacity-75">Shortcuts are disabled when typing in text fields</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
