import * as React from 'react';
import {
  Folder,
  Target,
  Layers,
  FileText,
  Pencil,
  Trash2,
  Calendar,
  Tag,
} from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { Separator } from '@/ui/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/ui/components/ui/sheet';
import type { MemoryItem } from './types';

function getLinkedItemIcon(kind: MemoryItem['linkedItemKind']) {
  switch (kind) {
    case 'project':
      return <Folder className="size-4" />;
    case 'initiative':
      return <Target className="size-4" />;
    case 'epic':
      return <Layers className="size-4" />;
    case 'issue':
      return <FileText className="size-4" />;
    default:
      return null;
  }
}

export interface MemoryDetailSheetProps {
  memory: MemoryItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (memory: MemoryItem) => void;
  onDelete?: (memory: MemoryItem) => void;
  onLinkedItemClick?: (memory: MemoryItem) => void;
}

export function MemoryDetailSheet({
  memory,
  open,
  onOpenChange,
  onEdit,
  onDelete,
  onLinkedItemClick,
}: MemoryDetailSheetProps) {
  if (!memory) return null;

  // Simple markdown rendering for display
  const renderContent = (text: string) => {
    return text.split('\n').map((line, i) => {
      // Headers
      if (line.startsWith('### ')) {
        return <h3 key={i} className="text-lg font-semibold mt-4 mb-2">{line.slice(4)}</h3>;
      }
      if (line.startsWith('## ')) {
        return <h2 key={i} className="text-xl font-semibold mt-4 mb-2">{line.slice(3)}</h2>;
      }
      if (line.startsWith('# ')) {
        return <h1 key={i} className="text-2xl font-bold mt-4 mb-2">{line.slice(2)}</h1>;
      }

      // List items
      if (line.startsWith('- ') || line.startsWith('* ')) {
        return <li key={i} className="ml-4">{line.slice(2)}</li>;
      }

      // Numbered list
      if (/^\d+\. /.test(line)) {
        return <li key={i} className="ml-4 list-decimal">{line.replace(/^\d+\. /, '')}</li>;
      }

      // Empty line
      if (!line.trim()) {
        return <br key={i} />;
      }

      // Regular paragraph
      return <p key={i} className="my-1">{line}</p>;
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-96 sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="sr-only">Memory Details</SheetTitle>
          <SheetDescription className="sr-only">View memory content, tags, and linked items</SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-full">
          <div className="space-y-6 pb-6">
            {/* Title */}
            <div>
              <h2 className="text-xl font-semibold">{memory.title}</h2>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              {onEdit && (
                <Button variant="outline" size="sm" onClick={() => onEdit(memory)}>
                  <Pencil className="mr-1 size-3" />
                  Edit
                </Button>
              )}
              {onDelete && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onDelete(memory)}
                >
                  <Trash2 className="mr-1 size-3" />
                  Delete
                </Button>
              )}
            </div>

            <Separator />

            {/* Meta info */}
            <div className="space-y-3 text-sm">
              {memory.linkedItemKind && memory.linkedItemTitle && (
                <button
                  className="flex items-center gap-2 text-left hover:text-primary"
                  onClick={() => onLinkedItemClick?.(memory)}
                >
                  <span className="text-muted-foreground">
                    {getLinkedItemIcon(memory.linkedItemKind)}
                  </span>
                  <span>Linked to: {memory.linkedItemTitle}</span>
                </button>
              )}

              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="size-4" />
                <span>Created: {memory.createdAt.toLocaleDateString()}</span>
              </div>

              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="size-4" />
                <span>Updated: {memory.updatedAt.toLocaleDateString()}</span>
              </div>
            </div>

            {/* Tags */}
            {memory.tags && memory.tags.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Tag className="size-4" />
                    Tags
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {memory.tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            <Separator />

            {/* Content */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Content</h3>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                {renderContent(memory.content)}
              </div>
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
