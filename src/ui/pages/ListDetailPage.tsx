/**
 * List detail page — displays a todo-based list work item.
 *
 * #2298: Inline add, check/uncheck, progress bar, completed section,
 * delete, and keyboard interaction.
 */
import * as React from 'react';
import { useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '@/ui/lib/api-client';
import { useWorkItem, workItemKeys } from '@/ui/hooks/queries/use-work-items';
import { useTodos } from '@/ui/hooks/queries/use-todos';
import { Checkbox } from '@/ui/components/ui/checkbox';
import { Button } from '@/ui/components/ui/button';
import { Progress } from '@/ui/components/ui/progress';
import { cn } from '@/ui/lib/utils';

export function ListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const workItemId = id ?? '';
  const queryClient = useQueryClient();
  const { data: listData, isLoading: listLoading } = useWorkItem(workItemId);
  const { data: todosData, isLoading: todosLoading } = useTodos(workItemId);

  const [addText, setAddText] = React.useState('');
  const [showCompleted, setShowCompleted] = React.useState(true);

  const todos = todosData?.todos ?? [];
  const uncompleted = todos.filter((t) => !t.completed);
  const completed = todos.filter((t) => t.completed);
  const completedCount = completed.length;
  const totalCount = todos.length;

  const invalidateTodos = () => {
    queryClient.invalidateQueries({ queryKey: ['todos', workItemId] });
  };

  const handleAdd = async () => {
    const text = addText.trim();
    if (!text) return;
    try {
      await apiClient.post(`/work-items/${workItemId}/todos`, { text });
      setAddText('');
      invalidateTodos();
      toast.success('Item added');
    } catch {
      toast.error('Failed to add item');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleAdd();
    }
  };

  const handleToggle = async (todoId: string, currentCompleted: boolean) => {
    try {
      await apiClient.patch(`/work-items/${workItemId}/todos/${todoId}`, {
        completed: !currentCompleted,
      });
      invalidateTodos();
    } catch {
      toast.error('Failed to update item');
    }
  };

  const handleDelete = async (todoId: string) => {
    try {
      await apiClient.delete(`/work-items/${workItemId}/todos/${todoId}`);
      invalidateTodos();
      toast.success('Item deleted');
    } catch {
      toast.error('Failed to delete item');
    }
  };

  if (listLoading || todosLoading) {
    return (
      <div data-testid="list-detail-page" className="flex items-center justify-center py-12">
        <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!listData) {
    return (
      <div data-testid="list-detail-page" className="py-12 text-center text-muted-foreground">
        <p>List not found.</p>
      </div>
    );
  }

  return (
    <div data-testid="list-detail-page" className="space-y-4">
      <h1 className="text-2xl font-bold">{listData.title}</h1>
      {listData.description && (
        <p className="text-muted-foreground">{listData.description}</p>
      )}

      {/* Progress */}
      {totalCount > 0 && (
        <>
          <span className="text-sm text-muted-foreground">
            {completedCount}/{totalCount} completed
          </span>
          <Progress value={completedCount} max={totalCount} />
        </>
      )}

      {/* Inline add */}
      <input
        type="text"
        className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        placeholder="Add item..."
        value={addText}
        onChange={(e) => setAddText(e.target.value)}
        onKeyDown={handleKeyDown}
      />

      {/* Empty state */}
      {totalCount === 0 && (
        <div className="py-8 text-center text-muted-foreground">
          <p>No items yet. Add your first item above.</p>
        </div>
      )}

      {/* Uncompleted todos */}
      {uncompleted.length > 0 && (
        <div className="space-y-1">
          {uncompleted.map((todo) => (
            <div
              key={todo.id}
              className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50"
            >
              <Checkbox
                checked={false}
                onCheckedChange={() => handleToggle(todo.id, false)}
                aria-label={`Mark "${todo.text}" as complete`}
              />
              <span className="flex-1 text-sm">{todo.text}</span>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 opacity-0 group-hover:opacity-100"
                onClick={() => handleDelete(todo.id)}
                aria-label={`Delete "${todo.text}"`}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Completed section */}
      {completed.length > 0 && (
        <div className="space-y-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowCompleted(!showCompleted)}
            aria-label={showCompleted ? 'Hide completed' : 'Show completed'}
          >
            {showCompleted ? 'Hide completed' : 'Show completed'} ({completedCount})
          </Button>
          {showCompleted &&
            completed.map((todo) => (
              <div
                key={todo.id}
                className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50"
              >
                <Checkbox
                  checked={true}
                  onCheckedChange={() => handleToggle(todo.id, true)}
                  aria-label={`Mark "${todo.text}" as incomplete`}
                />
                <span className={cn('flex-1 text-sm text-muted-foreground line-through')}>
                  {todo.text}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 opacity-0 group-hover:opacity-100"
                  onClick={() => handleDelete(todo.id)}
                  aria-label={`Delete "${todo.text}"`}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
