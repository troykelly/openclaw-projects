import * as React from "react";
import { useEffect, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/ui/components/ui/dialog";
import { ScrollArea } from "@/ui/components/ui/scroll-area";
import { Separator } from "@/ui/components/ui/separator";

interface ShortcutGroup {
  title: string;
  shortcuts: Array<{
    keys: string[];
    description: string;
  }>;
}

const shortcutGroups: ShortcutGroup[] = [
  {
    title: "Global",
    shortcuts: [
      { keys: ["⌘", "K"], description: "Open command palette" },
      { keys: ["⌘", "/"], description: "Show keyboard shortcuts" },
      { keys: ["Esc"], description: "Close modal / cancel" },
    ],
  },
  {
    title: "Navigation",
    shortcuts: [
      { keys: ["G", "A"], description: "Go to Activity" },
      { keys: ["G", "P"], description: "Go to Projects" },
      { keys: ["G", "T"], description: "Go to Timeline" },
      { keys: ["G", "C"], description: "Go to Contacts" },
      { keys: ["G", "S"], description: "Go to Settings" },
    ],
  },
  {
    title: "Lists",
    shortcuts: [
      { keys: ["J"], description: "Move down" },
      { keys: ["K"], description: "Move up" },
      { keys: ["Enter"], description: "Open selected item" },
      { keys: ["⌫"], description: "Go back / up hierarchy" },
    ],
  },
  {
    title: "Actions",
    shortcuts: [
      { keys: ["N"], description: "New item" },
      { keys: ["E"], description: "Edit current item" },
      { keys: ["S"], description: "Change status" },
      { keys: ["Space"], description: "Toggle selection" },
    ],
  },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-xs font-medium text-muted-foreground">
      {children}
    </kbd>
  );
}

export function KeyboardShortcutsModal() {
  const [open, setOpen] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Check if user is in an input field
    const target = e.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    ) {
      return;
    }

    // ⌘/ or Ctrl+/ to toggle shortcuts modal
    if ((e.metaKey || e.ctrlKey) && e.key === "/") {
      e.preventDefault();
      setOpen((prev) => !prev);
    }

    // ? (without modifier) also opens shortcuts
    if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      setOpen(true);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Navigate and act faster with these shortcuts. Press{" "}
            <Kbd>⌘</Kbd> <Kbd>/</Kbd> to toggle this help.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-6 pr-4">
            {shortcutGroups.map((group, groupIndex) => (
              <div key={group.title}>
                {groupIndex > 0 && <Separator className="mb-4" />}
                <h3 className="mb-3 text-sm font-medium text-foreground">
                  {group.title}
                </h3>
                <div className="space-y-2">
                  {group.shortcuts.map((shortcut) => (
                    <div
                      key={shortcut.description}
                      className="flex items-center justify-between py-1"
                    >
                      <span className="text-sm text-muted-foreground">
                        {shortcut.description}
                      </span>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, i) => (
                          <React.Fragment key={i}>
                            <Kbd>{key}</Kbd>
                            {i < shortcut.keys.length - 1 && (
                              <span className="text-xs text-muted-foreground">
                                +
                              </span>
                            )}
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
          <span className="opacity-75">
            Shortcuts are disabled when typing in text fields
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
