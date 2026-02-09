import * as React from 'react';
import { cn } from '@/ui/lib/utils';
import { ScrollArea } from '@/ui/components/ui/scroll-area';
import { Separator } from '@/ui/components/ui/separator';
import { Card, CardContent } from '@/ui/components/ui/card';
import { ItemHeader } from './item-header';
import { MetadataGrid } from './metadata-grid';
import { DescriptionEditor } from './description-editor';
import { TodoList } from './todo-list';
import { AttachmentsSection } from './attachments-section';
import { DependenciesSection } from './dependencies-section';
import type { WorkItemDetail, WorkItemStatus, WorkItemPriority, WorkItemTodo, WorkItemAttachment, WorkItemDependency } from './types';

export interface ItemDetailProps {
  item: WorkItemDetail;
  onTitleChange?: (title: string) => void;
  onDescriptionChange?: (description: string) => void;
  onStatusChange?: (status: WorkItemStatus) => void;
  onPriorityChange?: (priority: WorkItemPriority) => void;
  onAssigneeChange?: (assignee: string) => void;
  onDueDateChange?: (date: string) => void;
  onStartDateChange?: (date: string) => void;
  onEstimateChange?: (minutes: string) => void;
  onActualChange?: (minutes: string) => void;
  onTodoAdd?: (text: string) => void;
  onTodoToggle?: (id: string, completed: boolean) => void;
  onTodoDelete?: (id: string) => void;
  onAttachmentClick?: (attachment: WorkItemAttachment) => void;
  onLinkAttachment?: () => void;
  onDependencyClick?: (dependency: WorkItemDependency) => void;
  onAddDependency?: (direction: 'blocks' | 'blocked_by') => void;
  onParentClick?: () => void;
  onDelete?: () => void;
  className?: string;
}

export function ItemDetail({
  item,
  onTitleChange,
  onDescriptionChange,
  onStatusChange,
  onPriorityChange,
  onAssigneeChange,
  onDueDateChange,
  onStartDateChange,
  onEstimateChange,
  onActualChange,
  onTodoAdd,
  onTodoToggle,
  onTodoDelete,
  onAttachmentClick,
  onLinkAttachment,
  onDependencyClick,
  onAddDependency,
  onParentClick,
  onDelete,
  className,
}: ItemDetailProps) {
  return (
    <div className={cn('flex h-full flex-col', className)}>
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-4xl space-y-6 p-6">
          {/* Header */}
          <ItemHeader
            title={item.title}
            kind={item.kind}
            status={item.status}
            parentTitle={item.parentTitle}
            onTitleChange={onTitleChange}
            onParentClick={onParentClick}
            onDelete={onDelete}
          />

          {/* Main content grid */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Left column - main content */}
            <div className="space-y-6 lg:col-span-2">
              {/* Metadata */}
              <Card>
                <CardContent className="pt-4">
                  <MetadataGrid
                    status={item.status}
                    priority={item.priority}
                    assignee={item.assignee}
                    dueDate={item.dueDate}
                    startDate={item.startDate}
                    estimateMinutes={item.estimateMinutes}
                    actualMinutes={item.actualMinutes}
                    onStatusChange={onStatusChange}
                    onPriorityChange={onPriorityChange}
                    onAssigneeChange={onAssigneeChange}
                    onDueDateChange={onDueDateChange}
                    onStartDateChange={onStartDateChange}
                    onEstimateChange={onEstimateChange}
                    onActualChange={onActualChange}
                  />
                </CardContent>
              </Card>

              {/* Description */}
              <Card>
                <CardContent className="pt-4">
                  <DescriptionEditor description={item.description} onDescriptionChange={onDescriptionChange} />
                </CardContent>
              </Card>

              {/* Checklist */}
              <Card>
                <CardContent className="pt-4">
                  <TodoList todos={item.todos} onAdd={onTodoAdd} onToggle={onTodoToggle} onDelete={onTodoDelete} />
                </CardContent>
              </Card>
            </div>

            {/* Right column - sidebar */}
            <div className="space-y-6">
              {/* Attachments */}
              <Card>
                <CardContent className="pt-4">
                  <AttachmentsSection attachments={item.attachments} onAttachmentClick={onAttachmentClick} onLinkNew={onLinkAttachment} />
                </CardContent>
              </Card>

              {/* Dependencies */}
              <Card>
                <CardContent className="pt-4">
                  <DependenciesSection dependencies={item.dependencies} onDependencyClick={onDependencyClick} onAddDependency={onAddDependency} />
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
