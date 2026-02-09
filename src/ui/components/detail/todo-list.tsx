import * as React from 'react';
import { useState } from 'react';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { cn } from '@/ui/lib/utils';
import { Button } from '@/ui/components/ui/button';
import { Input } from '@/ui/components/ui/input';
import { Checkbox } from '@/ui/components/ui/checkbox';
import type { WorkItemTodo } from './types';

export interface TodoListProps {
  todos: WorkItemTodo[];
  onAdd?: (text: string) => void;
  onToggle?: (id: string, completed: boolean) => void;
  onDelete?: (id: string) => void;
  onReorder?: (todos: WorkItemTodo[]) => void;
  className?: string;
}

export function TodoList({ todos, onAdd, onToggle, onDelete, className }: TodoListProps) {
  const [newTodoText, setNewTodoText] = useState('');

  const handleAdd = () => {
    if (newTodoText.trim() && onAdd) {
      onAdd(newTodoText.trim());
      setNewTodoText('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAdd();
    }
  };

  const completedCount = todos.filter((t) => t.completed).length;

  return (
    <div className={cn('space-y-3', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Checklist</h3>
        {todos.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {completedCount}/{todos.length} completed
          </span>
        )}
      </div>

      {/* Progress bar */}
      {todos.length > 0 && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${(completedCount / todos.length) * 100}%` }} />
        </div>
      )}

      {/* Todo items */}
      <div className="space-y-1">
        {todos.map((todo) => (
          <div key={todo.id} data-testid="todo-item" className={cn('group flex items-center gap-2 rounded-md px-2 py-1.5', 'hover:bg-muted/50')}>
            <GripVertical className="size-4 cursor-grab text-muted-foreground opacity-0 group-hover:opacity-100" />
            <Checkbox
              checked={todo.completed}
              onCheckedChange={(checked) => onToggle?.(todo.id, checked === true)}
              aria-label={`Mark "${todo.text}" as ${todo.completed ? 'incomplete' : 'complete'}`}
            />
            <span className={cn('flex-1 text-sm', todo.completed && 'text-muted-foreground line-through')}>{todo.text}</span>
            {onDelete && (
              <Button variant="ghost" size="icon" className="size-6 opacity-0 group-hover:opacity-100" onClick={() => onDelete(todo.id)}>
                <Trash2 className="size-3" />
                <span className="sr-only">Delete</span>
              </Button>
            )}
          </div>
        ))}
      </div>

      {/* Add new todo */}
      {onAdd && (
        <div className="flex items-center gap-2">
          <Plus className="size-4 text-muted-foreground" />
          <Input
            value={newTodoText}
            onChange={(e) => setNewTodoText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a task..."
            className="h-8 flex-1"
          />
          <Button variant="ghost" size="sm" onClick={handleAdd} disabled={!newTodoText.trim()}>
            Add
          </Button>
        </div>
      )}

      {/* Empty state */}
      {todos.length === 0 && !onAdd && <p className="py-4 text-center text-sm text-muted-foreground">No tasks yet</p>}
    </div>
  );
}
