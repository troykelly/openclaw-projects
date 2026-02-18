/**
 * Work items list page with project tree panel.
 *
 * Displays a table of work items with a collapsible tree panel for
 * hierarchical navigation. Supports inline delete, move, and title
 * editing via the tree panel context menu.
 */
import React, { useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router';
import { useWorkItems, workItemKeys } from '@/ui/hooks/queries/use-work-items';
import { useWorkItemTree } from '@/ui/hooks/queries/use-work-items';
import { useUpdateWorkItem } from '@/ui/hooks/mutations/use-update-work-item';
import { useDeleteWorkItem } from '@/ui/hooks/mutations/use-delete-work-item';
import { useQueryClient } from '@tanstack/react-query';
import { Skeleton, SkeletonList, ErrorState, EmptyState } from '@/ui/components/feedback';
import { Button } from '@/ui/components/ui/button';
import { Badge } from '@/ui/components/ui/badge';
import { Card, CardContent } from '@/ui/components/ui/card';
import { ProjectTree } from '@/ui/components/tree/project-tree';
import type { TreeItem } from '@/ui/components/tree/types';
import { DeleteConfirmDialog, UndoToast, useWorkItemDelete, type DeleteItem } from '@/ui/components/work-item-delete';
import { MoveToDialog, useWorkItemMove, type MoveItem, type PotentialParent } from '@/ui/components/work-item-move';
import { mapApiTreeToTreeItems, findTreeItem, flattenTreeForParents, priorityColors } from '@/ui/lib/work-item-utils';
import { apiClient } from '@/ui/lib/api-client';
import { LayoutGrid, Calendar, Network, Clock, AlertCircle, CheckCircle2, Circle, FolderTree, PanelLeftClose, PanelLeft } from 'lucide-react';

/** Status icons mapped by status key. */
const statusIcons: Record<string, React.ReactNode> = {
  open: <Circle className="size-4 text-blue-500" />,
  in_progress: <Clock className="size-4 text-yellow-500" />,
  blocked: <AlertCircle className="size-4 text-red-500" />,
  closed: <CheckCircle2 className="size-4 text-green-500" />,
  done: <CheckCircle2 className="size-4 text-green-500" />,
};

export function ProjectListPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const { data: workItemsData, isLoading, error, refetch } = useWorkItems();
  const { data: treeData, isLoading: treeLoading } = useWorkItemTree();

  const [treePanelOpen, setTreePanelOpen] = useState(true);

  // Map tree data
  const treeItems = useMemo(() => (treeData ? mapApiTreeToTreeItems(treeData.items) : []), [treeData]);

  // Delete state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<DeleteItem | null>(null);

  const {
    deleteItem: performDelete,
    isDeleting,
    undoState,
    dismissUndo,
  } = useWorkItemDelete({
    onDeleted: () => {
      queryClient.invalidateQueries({ queryKey: workItemKeys.all });
    },
    onRestored: () => {
      queryClient.invalidateQueries({ queryKey: workItemKeys.all });
    },
  });

  const handleTreeSelect = useCallback((id: string) => {
    // Use Link-based navigation instead of page reload
    window.location.href = `/app/work-items/${id}`;
  }, []);

  const handleTreeDelete = useCallback(
    (id: string) => {
      const item = findTreeItem(treeItems, id);
      if (item) {
        setItemToDelete({
          id: item.id,
          title: item.title,
          kind: item.kind,
          childCount: item.childCount ?? 0,
        });
        setDeleteDialogOpen(true);
      }
    },
    [treeItems],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!itemToDelete) return;
    await performDelete({ id: itemToDelete.id, title: itemToDelete.title });
    setDeleteDialogOpen(false);
    setItemToDelete(null);
  }, [itemToDelete, performDelete]);

  // Move state
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [itemToMove, setItemToMove] = useState<MoveItem | null>(null);

  const potentialParents = useMemo(() => flattenTreeForParents(treeItems) as PotentialParent[], [treeItems]);

  const { moveItem: performMove, isMoving } = useWorkItemMove({
    onMoved: () => {
      queryClient.invalidateQueries({ queryKey: workItemKeys.all });
    },
  });

  const handleMoveRequest = useCallback((item: TreeItem) => {
    setItemToMove({
      id: item.id,
      title: item.title,
      kind: item.kind,
      currentParentId: item.parent_id,
    });
    setMoveDialogOpen(true);
  }, []);

  const handleTreeMove = useCallback(
    async (item_id: string, newParentId: string | null) => {
      const item = findTreeItem(treeItems, item_id);
      if (item) {
        await performMove({ id: item.id, title: item.title }, newParentId);
      }
    },
    [treeItems, performMove],
  );

  const handleConfirmMove = useCallback(
    async (newParentId: string | null) => {
      if (!itemToMove) return;
      await performMove({ id: itemToMove.id, title: itemToMove.title }, newParentId);
      setMoveDialogOpen(false);
      setItemToMove(null);
    },
    [itemToMove, performMove],
  );

  const handleTreeTitleChange = useCallback(
    async (id: string, newTitle: string) => {
      try {
        await apiClient.patch(`/api/work-items/${id}`, { title: newTitle });
        queryClient.invalidateQueries({ queryKey: workItemKeys.all });
      } catch {
        // The inline edit component will revert on failure
      }
    },
    [queryClient],
  );

  if (isLoading) {
    return (
      <div data-testid="page-project-list" className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <Skeleton width={200} height={32} />
          <Skeleton width={150} height={36} />
        </div>
        <SkeletonList count={5} variant="row" />
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="page-project-list" className="p-6">
        <ErrorState
          type="generic"
          title="Failed to load work items"
          description={error instanceof Error ? error.message : 'Unknown error'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const items = workItemsData?.items ?? [];

  if (items.length === 0) {
    return (
      <div data-testid="page-project-list" className="p-6">
        <EmptyState
          variant="no-data"
          title="No work items"
          description="Create your first work item to get started"
          actionLabel="Create Work Item"
          onAction={() => {}}
        />
      </div>
    );
  }

  return (
    <>
      <div data-testid="page-project-list" className="flex h-full">
        {/* Project Tree Panel */}
        <div className={`border-r bg-muted/30 transition-all duration-300 ${treePanelOpen ? 'w-64' : 'w-0 overflow-hidden'}`}>
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b p-3">
              <div className="flex items-center gap-2">
                <FolderTree className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">Projects</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setTreePanelOpen(false)} className="size-7 p-0">
                <PanelLeftClose className="size-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-auto">
              {treeLoading ? (
                <div className="p-4">
                  <Skeleton width="100%" height={200} />
                </div>
              ) : (
                <ProjectTree
                  items={treeItems}
                  onSelect={handleTreeSelect}
                  onDelete={handleTreeDelete}
                  onMove={handleTreeMove}
                  onMoveRequest={handleMoveRequest}
                  onTitleChange={handleTreeTitleChange}
                />
              )}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {!treePanelOpen && (
                <Button variant="outline" size="sm" onClick={() => setTreePanelOpen(true)}>
                  <PanelLeft className="mr-2 size-4" />
                  Show Tree
                </Button>
              )}
              <h1 className="text-2xl font-semibold text-foreground">Work Items</h1>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <Link to="/kanban">
                  <LayoutGrid className="mr-2 size-4" />
                  Kanban Board
                </Link>
              </Button>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b bg-muted/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Title</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Status</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Priority</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {items.map((item) => (
                      <tr key={item.id} className="hover:bg-muted/50 transition-colors">
                        <td className="px-4 py-3">
                          <Link to={`/work-items/${encodeURIComponent(item.id)}`} className="font-medium text-foreground hover:text-primary transition-colors">
                            {item.title}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {statusIcons[item.status ?? 'open'] ?? statusIcons.open}
                            <span className="text-sm capitalize">{item.status ?? 'open'}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {item.priority && <Badge className={priorityColors[item.priority] ?? 'bg-gray-500'}>{item.priority}</Badge>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button variant="ghost" size="sm" asChild>
                              <Link to={`/work-items/${encodeURIComponent(item.id)}/timeline`}>
                                <Calendar className="size-4" />
                              </Link>
                            </Button>
                            <Button variant="ghost" size="sm" asChild>
                              <Link to={`/work-items/${encodeURIComponent(item.id)}/graph`}>
                                <Network className="size-4" />
                              </Link>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        item={itemToDelete ?? undefined}
        onConfirm={handleConfirmDelete}
        isDeleting={isDeleting}
      />
      <MoveToDialog
        open={moveDialogOpen}
        onOpenChange={setMoveDialogOpen}
        item={itemToMove ?? undefined}
        potentialParents={potentialParents}
        onMove={handleConfirmMove}
        isMoving={isMoving}
      />
      {undoState && <UndoToast visible={!!undoState} itemTitle={undoState.itemTitle} onUndo={undoState.onUndo} onDismiss={dismissUndo} />}
    </>
  );
}
