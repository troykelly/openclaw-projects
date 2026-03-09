/**
 * Work item detail slide-over panel.
 *
 * #2300: Renders a simplified work item detail view inside a Sheet,
 * showing essential tabs (Details, Checklist) and a link to the full page.
 */
import * as React from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileText, CheckSquare } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '@/ui/lib/api-client';
import { useWorkItem } from '@/ui/hooks/queries/use-work-items';
import { useTodos } from '@/ui/hooks/queries/use-todos';
import { Badge } from '@/ui/components/ui/badge';
import { Button } from '@/ui/components/ui/button';
import { Checkbox } from '@/ui/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/ui/components/ui/tabs';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/ui/components/ui/sheet';
import { cn } from '@/ui/lib/utils';

export interface WorkItemPanelProps {
  workItemId: string;
  open: boolean;
  onClose: () => void;
}

/** Format status string for display. */
function formatStatus(status: string): string {
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function WorkItemPanel({ workItemId, open, onClose }: WorkItemPanelProps) {
  const queryClient = useQueryClient();
  const { data: item, isLoading, isError } = useWorkItem(workItemId);
  const { data: todosData } = useTodos(workItemId);
  const todos = todosData?.todos ?? [];

  const handleToggleTodo = async (todoId: string, currentCompleted: boolean) => {
    try {
      await apiClient.patch(`/work-items/${workItemId}/todos/${todoId}`, {
        completed: !currentCompleted,
      });
      queryClient.invalidateQueries({ queryKey: ['todos', workItemId] });
    } catch {
      toast.error('Failed to update todo');
    }
  };

  return (
    <Sheet open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg"
        data-testid="work-item-panel"
      >
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        )}
        {!isLoading && item && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2">
                <SheetTitle className="flex-1 truncate">{item.title}</SheetTitle>
                <Badge variant="outline" className="text-xs shrink-0">
                  {formatStatus(item.status)}
                </Badge>
              </div>
              <SheetDescription className="sr-only">
                Work item detail panel
              </SheetDescription>
              <Link
                to={`/work-items/${workItemId}`}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                aria-label="Open full page"
              >
                <ExternalLink className="size-3" />
                Open full page
              </Link>
            </SheetHeader>

            <Tabs defaultValue="details" className="flex-1 overflow-auto">
              <TabsList className="w-full justify-start">
                <TabsTrigger value="details" className="gap-1">
                  <FileText className="size-3" />
                  Details
                </TabsTrigger>
                <TabsTrigger value="checklist" className="gap-1">
                  <CheckSquare className="size-3" />
                  Checklist
                </TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="p-4 space-y-3">
                {item.description && (
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                )}
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Kind</span>
                    <p className="capitalize">{item.kind}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Priority</span>
                    <p>{item.priority ?? '--'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Status</span>
                    <p>{formatStatus(item.status)}</p>
                  </div>
                  {item.parent && (
                    <div>
                      <span className="text-muted-foreground">Parent</span>
                      <p className="truncate">{item.parent.title}</p>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="checklist" className="p-4 space-y-2">
                {todos.length === 0 && (
                  <p className="text-sm text-muted-foreground">No checklist items</p>
                )}
                {todos.map((todo) => (
                  <div key={todo.id} className="flex items-center gap-2">
                    <Checkbox
                      checked={todo.completed}
                      onCheckedChange={() => handleToggleTodo(todo.id, todo.completed)}
                      aria-label={`Mark "${todo.text}" as ${todo.completed ? 'incomplete' : 'complete'}`}
                    />
                    <span className={cn('text-sm', todo.completed && 'text-muted-foreground line-through')}>
                      {todo.text}
                    </span>
                  </div>
                ))}
              </TabsContent>
            </Tabs>
          </>
        )}
        {!isLoading && isError && (
          <div className="py-12 text-center text-destructive">
            <p>Failed to load work item. Please try again.</p>
          </div>
        )}
        {!isLoading && !isError && !item && (
          <div className="py-12 text-center text-muted-foreground">
            <p>Work item not found.</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
