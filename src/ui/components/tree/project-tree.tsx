import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { cn } from '@/ui/lib/utils';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { TreeItemRow } from './tree-item';
import { canMoveToParent } from '@/ui/components/work-item-move';
import type { TreeItem, TreeItemKind, TreeDragData } from './types';

function flattenTree(
  items: TreeItem[],
  expandedIds: Set<string>,
  depth = 0
): Array<{ item: TreeItem; depth: number }> {
  const result: Array<{ item: TreeItem; depth: number }> = [];

  for (const item of items) {
    result.push({ item, depth });
    if (item.children && expandedIds.has(item.id)) {
      result.push(...flattenTree(item.children, expandedIds, depth + 1));
    }
  }

  return result;
}

function findItemById(items: TreeItem[], id: string): TreeItem | null {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.children) {
      const found = findItemById(item.children, id);
      if (found) return found;
    }
  }
  return null;
}

function findParentAndIndex(
  items: TreeItem[],
  id: string
): { parent: TreeItem | null; index: number } | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) {
      return { parent: null, index: i };
    }
    if (items[i].children) {
      const found = findParentAndIndex(items[i].children!, id);
      if (found) {
        return found.parent === null
          ? { parent: items[i], index: found.index }
          : found;
      }
    }
  }
  return null;
}

function removeItemFromTree(items: TreeItem[], id: string): TreeItem[] {
  return items
    .filter((item) => item.id !== id)
    .map((item) => ({
      ...item,
      children: item.children ? removeItemFromTree(item.children, id) : undefined,
    }));
}

function insertItemIntoTree(
  items: TreeItem[],
  targetId: string,
  itemToInsert: TreeItem,
  position: 'before' | 'after' | 'inside'
): TreeItem[] {
  return items.flatMap((item) => {
    if (item.id === targetId) {
      if (position === 'inside') {
        return {
          ...item,
          children: [...(item.children || []), itemToInsert],
        };
      }
      if (position === 'before') {
        return [itemToInsert, item];
      }
      return [item, itemToInsert];
    }
    if (item.children) {
      return {
        ...item,
        children: insertItemIntoTree(item.children, targetId, itemToInsert, position),
      };
    }
    return item;
  });
}

export interface ProjectTreeProps {
  items: TreeItem[];
  onItemsChange?: (items: TreeItem[]) => void;
  onSelect?: (id: string) => void;
  onAddChild?: (parentId: string, kind: TreeItemKind) => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  /** Called when an item is moved to a new parent via drag-drop */
  onMove?: (itemId: string, newParentId: string | null) => void;
  /** Called when user requests to move an item via the "Move to..." menu */
  onMoveRequest?: (item: TreeItem) => void;
  /** Called when a title is changed via inline edit */
  onTitleChange?: (id: string, newTitle: string) => void;
  className?: string;
}

export function ProjectTree({
  items,
  onItemsChange,
  onSelect,
  onAddChild,
  onEdit,
  onDelete,
  onMove,
  onMoveRequest,
  onTitleChange,
  className,
}: ProjectTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<TreeItem | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const flatItems = useMemo(
    () => flattenTree(items, expandedIds),
    [items, expandedIds]
  );

  const itemIds = useMemo(() => flatItems.map((f) => f.item.id), [flatItems]);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      onSelect?.(id);
    },
    [onSelect]
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const item = findItemById(items, event.active.id as string);
      setActiveItem(item);
    },
    [items]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveItem(null);

      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      const activeItem = findItemById(items, activeId);
      const overItem = findItemById(items, overId);
      const activeInfo = findParentAndIndex(items, activeId);
      const overInfo = findParentAndIndex(items, overId);

      if (!activeInfo || !overInfo || !activeItem || !overItem) return;

      // Same parent - reorder within siblings
      if (activeInfo.parent?.id === overInfo.parent?.id) {
        const siblings = activeInfo.parent?.children || items;
        const oldIndex = siblings.findIndex((i) => i.id === activeId);
        const newIndex = siblings.findIndex((i) => i.id === overId);

        if (oldIndex !== -1 && newIndex !== -1) {
          const newSiblings = arrayMove(siblings, oldIndex, newIndex);

          if (!activeInfo.parent) {
            onItemsChange?.(newSiblings);
          } else {
            const updateParent = (treeItems: TreeItem[]): TreeItem[] =>
              treeItems.map((treeItem) => {
                if (treeItem.id === activeInfo.parent!.id) {
                  return { ...treeItem, children: newSiblings };
                }
                if (treeItem.children) {
                  return { ...treeItem, children: updateParent(treeItem.children) };
                }
                return treeItem;
              });
            onItemsChange?.(updateParent(items));
          }
        }
      } else {
        // Different parent - reparent if valid hierarchy
        // Check if the dragged item can be moved under the target item
        const canMove = canMoveToParent(
          { id: activeItem.id, kind: activeItem.kind },
          { id: overItem.id, kind: overItem.kind }
        );

        if (canMove && onMove) {
          // Call the onMove handler to persist the change via API
          onMove(activeId, overId);
        }
      }
    },
    [items, onItemsChange, onMove]
  );

  const handleDragCancel = useCallback(() => {
    setActiveItem(null);
  }, []);

  return (
    <div className={cn('flex h-full flex-col', className)} role="tree" aria-label="Project hierarchy">
      <ScrollArea className="flex-1">
        <div className="p-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
              {flatItems.map(({ item, depth }) => (
                <TreeItemRow
                  key={item.id}
                  item={item}
                  depth={depth}
                  isExpanded={expandedIds.has(item.id)}
                  isSelected={selectedId === item.id}
                  onToggleExpand={handleToggleExpand}
                  onSelect={handleSelect}
                  onAddChild={onAddChild}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onMoveRequest={onMoveRequest}
                  onTitleChange={onTitleChange}
                />
              ))}
            </SortableContext>
            <DragOverlay>
              {activeItem && (
                <div className="rounded-md bg-background px-4 py-2 shadow-lg ring-2 ring-primary">
                  <span className="text-sm font-medium">{activeItem.title}</span>
                </div>
              )}
            </DragOverlay>
          </DndContext>

          {items.length === 0 && (
            <div className="py-8 text-center text-muted-foreground">
              <p>No projects yet</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
