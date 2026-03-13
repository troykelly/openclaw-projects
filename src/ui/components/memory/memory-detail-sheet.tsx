import * as React from 'react';
import { Folder, Target, Layers, FileText, Pencil, Trash2, Calendar, Tag, Clock, Pin } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { Separator } from '@/ui/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/ui/components/ui/sheet';
import { MemoryTtlBadge } from './memory-ttl-badge';
import { SupersessionChain } from './supersession-chain';
import { LifecycleTimeline } from './lifecycle-timeline';
import type { MemoryItem, MemoryLifecycleEvent, SupersessionNode } from './types';

function getLinkedItemIcon(kind: MemoryItem['linked_item_kind']) {
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

/**
 * Compute human-readable time difference for TTL detail display.
 */
function formatTtlDetail(expiresAt: string): { expiryText: string; countdownText: string; isExpired: boolean } {
  const now = Date.now();
  const expiry = new Date(expiresAt).getTime();
  const diffMs = expiry - now;
  const isExpired = diffMs <= 0;

  const expiryText = new Date(expiresAt).toLocaleString();

  if (isExpired) {
    const agoMs = Math.abs(diffMs);
    const hours = Math.floor(agoMs / (1000 * 60 * 60));
    const minutes = Math.floor(agoMs / (1000 * 60));
    const countdownText = hours > 0 ? `expired ${hours}h ago` : `expired ${minutes}m ago`;
    return { expiryText, countdownText, isExpired };
  }

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const countdownText = days > 0 ? `in ${days}d ${hours % 24}h` : `in ${hours}h`;
  return { expiryText, countdownText, isExpired };
}

export interface MemoryDetailSheetProps {
  memory: MemoryItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (memory: MemoryItem) => void;
  onDelete?: (memory: MemoryItem) => void;
  onLinkedItemClick?: (memory: MemoryItem) => void;
  /** Full supersession chain for this memory */
  supersessionChain?: SupersessionNode[];
  /** Lifecycle events for timeline display */
  lifecycleEvents?: MemoryLifecycleEvent[];
  /** Called when a supersession chain node is clicked */
  onChainNodeClick?: (id: string) => void;
}

export function MemoryDetailSheet({
  memory,
  open,
  onOpenChange,
  onEdit,
  onDelete,
  onLinkedItemClick,
  supersessionChain,
  lifecycleEvents,
  onChainNodeClick,
}: MemoryDetailSheetProps) {
  if (!memory) return null;

  // Simple markdown rendering for display
  const renderContent = (text: string) => {
    return text.split('\n').map((line, i) => {
      if (line.startsWith('### ')) {
        return (
          <h3 key={i} className="text-lg font-semibold mt-4 mb-2">
            {line.slice(4)}
          </h3>
        );
      }
      if (line.startsWith('## ')) {
        return (
          <h2 key={i} className="text-xl font-semibold mt-4 mb-2">
            {line.slice(3)}
          </h2>
        );
      }
      if (line.startsWith('# ')) {
        return (
          <h1 key={i} className="text-2xl font-bold mt-4 mb-2">
            {line.slice(2)}
          </h1>
        );
      }
      if (line.startsWith('- ') || line.startsWith('* ')) {
        return (
          <li key={i} className="ml-4">
            {line.slice(2)}
          </li>
        );
      }
      if (/^\d+\. /.test(line)) {
        return (
          <li key={i} className="ml-4 list-decimal">
            {line.replace(/^\d+\. /, '')}
          </li>
        );
      }
      if (!line.trim()) {
        return <br key={i} />;
      }
      return (
        <p key={i} className="my-1">
          {line}
        </p>
      );
    });
  };

  const ttlDetail = memory.expires_at ? formatTtlDetail(memory.expires_at) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-96 sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="sr-only">Memory Details</SheetTitle>
          <SheetDescription className="sr-only">View memory content, lifecycle, tags, and linked items</SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-full">
          <div className="space-y-6 pb-6">
            {/* Title + pinned indicator */}
            <div className="flex items-start gap-2">
              <h2 className="flex-1 text-xl font-semibold">{memory.title}</h2>
              {memory.pinned && (
                <div aria-label="Memory is pinned" className="text-muted-foreground">
                  <Pin className="size-4" />
                </div>
              )}
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
                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => onDelete(memory)}>
                  <Trash2 className="mr-1 size-3" />
                  Delete
                </Button>
              )}
            </div>

            <Separator />

            {/* Meta info */}
            <div className="space-y-3 text-sm">
              {memory.linked_item_kind && memory.linked_item_title && (
                <button className="flex items-center gap-2 text-left hover:text-primary" onClick={() => onLinkedItemClick?.(memory)}>
                  <span className="text-muted-foreground">{getLinkedItemIcon(memory.linked_item_kind)}</span>
                  <span>Linked to: {memory.linked_item_title}</span>
                </button>
              )}

              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="size-4" />
                <span>Created: {memory.created_at.toLocaleDateString()}</span>
              </div>

              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="size-4" />
                <span>Updated: {memory.updated_at.toLocaleDateString()}</span>
              </div>
            </div>

            {/* TTL details */}
            {ttlDetail && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Clock className="size-4" />
                    TTL Details
                  </h4>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <div>Expires: {ttlDetail.expiryText} ({ttlDetail.countdownText})</div>
                    {ttlDetail.isExpired && (
                      <Badge variant="outline" className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                        Expired
                      </Badge>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Supersession chain */}
            {supersessionChain && supersessionChain.length > 0 && (
              <>
                <Separator />
                <SupersessionChain
                  chain={supersessionChain}
                  currentId={memory.id}
                  onNodeClick={onChainNodeClick}
                />
                {memory.supersedes && memory.supersedes.length > 0 && (
                  <div className="text-sm text-muted-foreground">
                    Supersedes: {memory.supersedes.length} {memory.supersedes.length === 1 ? 'memory' : 'memories'}
                  </div>
                )}
              </>
            )}

            {/* Lifecycle timeline */}
            {lifecycleEvents && lifecycleEvents.length > 0 && (
              <>
                <Separator />
                <LifecycleTimeline events={lifecycleEvents} />
              </>
            )}

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
              <div className="prose prose-sm dark:prose-invert max-w-none">{renderContent(memory.content)}</div>
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
